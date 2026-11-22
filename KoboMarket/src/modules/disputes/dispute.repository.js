// PostgreSQL access for disputes. (Disputes are NOT the ledger: a dispute row
// is updated once, when it is resolved. The money side is in ledger_entries.)
const { knex } = require('../../config/knex');

// Dispute + the facts of its sub-order that callers always need.
function withSubOrder(db) {
  return db('disputes as d')
    .join('sub_orders as so', 'so.id', 'd.sub_order_id')
    .select('d.*', 'so.vendor_id', 'so.order_id', 'so.subtotal_kobo', 'so.status as sub_order_status');
}

async function insert(trx, { subOrderId, buyerId, reason, evidence }) {
  const [dispute] = await trx('disputes')
    .insert({
      sub_order_id: subOrderId,
      buyer_id: String(buyerId),
      reason,
      evidence: JSON.stringify(evidence),
      status: 'OPEN',
    })
    .returning('*');
  return dispute;
}

function findById(id, db = knex) {
  return withSubOrder(db).where('d.id', id).first();
}

function lockById(trx, id) {
  return trx('disputes').where({ id }).forUpdate().first();
}

function markResolved(trx, id, { resolution, refundKobo, resolvedBy, note }) {
  return trx('disputes')
    .where({ id, status: 'OPEN' })
    .update({
      status: 'RESOLVED',
      resolution,
      refund_kobo: refundKobo === null ? null : refundKobo.toString(),
      resolved_by: String(resolvedBy),
      resolution_note: note,
      resolved_at: trx.fn.now(),
    });
}

// Admin list, newest first, keyset pagination on (created_at, id).
function list({ status, after, limit }) {
  return withSubOrder(knex)
    .modify((q) => {
      if (status) q.where('d.status', status);
      if (after) q.whereRaw('(d.created_at, d.id) < (?::timestamptz, ?::uuid)', [after.sortValue, after.id]);
    })
    .orderBy([{ column: 'd.created_at', order: 'desc' }, { column: 'd.id', order: 'desc' }])
    .limit(limit)
    .select(knex.raw('d.created_at::text AS cursor_created_at'));
}

module.exports = { insert, findById, lockById, markResolved, list };
