// PostgreSQL access for orders, sub_orders, order_items and sub_order_events.
// Functions that take `trx` run inside the caller's transaction; `db` defaults
// to the global knex but may also be a transaction.
const { knex } = require('../../config/knex');

// ---------- inserts (checkout) ----------

async function insertOrder(trx, { buyerId, totalKobo, idempotencyKey }) {
  const [order] = await trx('orders')
    .insert({
      buyer_id: String(buyerId),
      status: 'IN_PROGRESS',
      total_kobo: totalKobo.toString(),
      stock_status: 'PENDING',
      idempotency_key: idempotencyKey,
    })
    .returning('*');
  return order;
}

async function insertSubOrder(trx, { orderId, vendorId, buyerId, subtotalKobo, commissionRateBps }) {
  const [subOrder] = await trx('sub_orders')
    .insert({
      order_id: orderId,
      vendor_id: String(vendorId),
      buyer_id: String(buyerId),
      status: 'PAID',
      subtotal_kobo: subtotalKobo.toString(),
      commission_rate_bps: commissionRateBps,
    })
    .returning('*');
  return subOrder;
}

function insertItems(trx, rows) {
  return trx('order_items').insert(rows).returning('*');
}

function insertEvent(trx, { subOrderId, from, to, actorId, actorRole, note = null }) {
  return trx('sub_order_events').insert({
    sub_order_id: subOrderId,
    from_status: from,
    to_status: to,
    actor_id: String(actorId),
    actor_role: actorRole,
    note,
  });
}

// ---------- single reads / locks ----------

function findOrderById(id, db = knex) {
  return db('orders').where({ id }).first();
}

function findOrderByIdempotencyKey(idempotencyKey, db = knex) {
  return db('orders').where({ idempotency_key: idempotencyKey }).first();
}

// SKIP LOCKED (jobs): if another worker holds the row, return nothing instead of waiting.
function lockOrder(trx, id, { skipLocked = false } = {}) {
  const query = trx('orders').where({ id }).forUpdate();
  if (skipLocked) query.skipLocked();
  return query.first();
}

function findSubOrder(id, db = knex) {
  return db('sub_orders').where({ id }).first();
}

function lockSubOrder(trx, id, { skipLocked = false } = {}) {
  const query = trx('sub_orders').where({ id }).forUpdate();
  if (skipLocked) query.skipLocked();
  return query.first();
}

function lockSubOrdersOfOrder(trx, orderId) {
  return trx('sub_orders').where({ order_id: orderId }).orderBy('id').forUpdate();
}

// ---------- batch reads (one query per table, never one per row) ----------

function findSubOrdersByOrderIds(orderIds, db = knex) {
  if (orderIds.length === 0) return [];
  return db('sub_orders').whereIn('order_id', orderIds).orderBy([{ column: 'created_at' }, { column: 'id' }]);
}

function findItemsBySubOrderIds(subOrderIds, db = knex) {
  if (subOrderIds.length === 0) return [];
  return db('order_items').whereIn('sub_order_id', subOrderIds).orderBy('id');
}

function findEventsBySubOrderIds(subOrderIds, db = knex) {
  if (subOrderIds.length === 0) return [];
  return db('sub_order_events').whereIn('sub_order_id', subOrderIds).orderBy([{ column: 'created_at' }, { column: 'id' }]);
}

// ---------- updates ----------

// Only moves PENDING -> DEDUCTED. Returns 0 if the recovery job got there first.
function markStockDeducted(orderId) {
  return knex('orders')
    .where({ id: orderId, stock_status: 'PENDING' })
    .update({ stock_status: 'DEDUCTED', updated_at: knex.fn.now() });
}

function markOrderReleased(trx, orderId, cancelReason) {
  return trx('orders')
    .where({ id: orderId })
    .update({ stock_status: 'RELEASED', cancel_reason: cancelReason, updated_at: trx.fn.now() });
}

function setOrderCancelReason(trx, orderId, cancelReason) {
  return trx('orders').where({ id: orderId }).update({ cancel_reason: cancelReason, updated_at: trx.fn.now() });
}

// ---------- lists (keyset pagination on (created_at, id), newest first) ----------

function keysetAfter(query, alias, after) {
  if (after) query.whereRaw(`(${alias}.created_at, ${alias}.id) < (?::timestamptz, ?::uuid)`, [after.sortValue, after.id]);
}

function listOrdersForBuyer(buyerId, { status, after, limit }) {
  return knex('orders as o')
    .where('o.buyer_id', String(buyerId))
    .modify((q) => {
      if (status) q.where('o.status', status);
      keysetAfter(q, 'o', after);
    })
    .orderBy([{ column: 'o.created_at', order: 'desc' }, { column: 'o.id', order: 'desc' }])
    .limit(limit)
    .select('o.*', knex.raw('o.created_at::text AS cursor_created_at'));
}

function listSubOrdersForVendor(vendorId, { status, after, limit }) {
  return knex('sub_orders as so')
    .where('so.vendor_id', String(vendorId))
    .modify((q) => {
      if (status) q.where('so.status', status);
      keysetAfter(q, 'so', after);
    })
    .orderBy([{ column: 'so.created_at', order: 'desc' }, { column: 'so.id', order: 'desc' }])
    .limit(limit)
    .select('so.*', knex.raw('so.created_at::text AS cursor_created_at'));
}

// ---------- job queries ----------

// Orders whose request died between "Postgres committed" and "Mongo stock done".
function findStalePendingStockOrderIds({ olderThanMinutes, limit }) {
  return knex('orders')
    .where({ stock_status: 'PENDING' })
    .whereRaw('created_at < now() - make_interval(mins => ?)', [olderThanMinutes])
    .orderBy('created_at')
    .limit(limit)
    .pluck('id');
}

// SQL shared by the auto-complete candidate query and its re-check under lock.
const AUTO_COMPLETE_CONDITION = `
  so.status IN ('SHIPPED', 'DELIVERED')
  AND so.shipped_at < now() - make_interval(hours => ?)
  AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.sub_order_id = so.id AND d.status = 'OPEN')
`;

function findAutoCompleteCandidateIds({ timeoutHours, limit }) {
  return knex('sub_orders as so')
    .whereRaw(AUTO_COMPLETE_CONDITION, [timeoutHours])
    .orderBy('so.shipped_at')
    .limit(limit)
    .pluck('so.id');
}

// Re-checks the same condition on one row, inside the release transaction.
async function isStillAutoCompletable(trx, subOrderId, timeoutHours) {
  const row = await trx('sub_orders as so')
    .where('so.id', subOrderId)
    .whereRaw(AUTO_COMPLETE_CONDITION, [timeoutHours])
    .first('so.id');
  return Boolean(row);
}

// ---------- reviews (Block 3) ----------

// Has this buyer received (COMPLETED sub-order) this product at least once?
async function hasCompletedPurchase(buyerId, productId) {
  const row = await knex('order_items as oi')
    .join('sub_orders as so', 'so.id', 'oi.sub_order_id')
    .join('orders as o', 'o.id', 'so.order_id')
    .where({ 'oi.product_id': String(productId), 'so.status': 'COMPLETED', 'o.buyer_id': String(buyerId) })
    .first(knex.raw('1 as found'));
  return Boolean(row);
}

module.exports = {
  insertOrder,
  insertSubOrder,
  insertItems,
  insertEvent,
  findOrderById,
  findOrderByIdempotencyKey,
  lockOrder,
  findSubOrder,
  lockSubOrder,
  lockSubOrdersOfOrder,
  findSubOrdersByOrderIds,
  findItemsBySubOrderIds,
  findEventsBySubOrderIds,
  markStockDeducted,
  markOrderReleased,
  setOrderCancelReason,
  listOrdersForBuyer,
  listSubOrdersForVendor,
  findStalePendingStockOrderIds,
  findAutoCompleteCandidateIds,
  isStillAutoCompletable,
  hasCompletedPurchase,
};
