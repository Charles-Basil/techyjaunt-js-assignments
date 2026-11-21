// The sub-order state machine. EVERY status change goes through transition(),
// so an illegal jump (e.g. PAID -> COMPLETED without shipping) is impossible.
// The full ASCII diagram is in the README ("Order state machine").
//
// Happy path:   PAID -> SHIPPED -> (DELIVERED) -> COMPLETED   (escrow released)
// Before ship:  PAID -> CANCELLED                             (buyer refunded)
// Problems:     SHIPPED/DELIVERED -> DISPUTED -> COMPLETED or REFUNDED
const AppError = require('../../utils/AppError');

const TRANSITIONS = Object.freeze({
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'COMPLETED', 'DISPUTED'],
  DELIVERED: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['COMPLETED', 'REFUNDED'],
  COMPLETED: [], // final
  CANCELLED: [], // final
  REFUNDED: [], // final
});

const FINAL = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

function allowedFrom(from) {
  return TRANSITIONS[from] || [];
}

function invalidTransition(from, to, message = `Cannot change a sub-order from ${from} to ${to}`) {
  return new AppError('INVALID_STATE_TRANSITION', message, 409, { from, to, allowed: allowedFrom(from) });
}

function assertTransition(from, to) {
  if (!allowedFrom(from).includes(to)) throw invalidTransition(from, to);
}

// The parent order's status, derived from its sub-orders (rules in this order):
//   all CANCELLED                               -> CANCELLED
//   all final, at least one COMPLETED           -> COMPLETED
//   all REFUNDED/CANCELLED, at least one REFUNDED -> REFUNDED
//   anything else                               -> IN_PROGRESS
function deriveOrderStatus(statuses) {
  if (statuses.length > 0 && statuses.every((s) => s === 'CANCELLED')) return 'CANCELLED';
  if (statuses.every((s) => FINAL.includes(s)) && statuses.includes('COMPLETED')) return 'COMPLETED';
  if (statuses.every((s) => s === 'REFUNDED' || s === 'CANCELLED') && statuses.includes('REFUNDED')) return 'REFUNDED';
  return 'IN_PROGRESS';
}

/**
 * Moves one sub-order to `to` inside the caller's transaction.
 *
 * Lock order (the same in every flow, so flows can't deadlock):
 *   parent order row -> sub-order row -> accounts (ledger.lockAccounts)
 * Locking the parent order first also serialises the "recompute order status"
 * step: two vendors' sub-orders completing at the same moment can't both read
 * a stale sibling status and leave the order stuck IN_PROGRESS.
 */
async function transition(trx, subOrderId, to, { actorId, actorRole, note = null, extraFields = {} }) {
  const current = await trx('sub_orders').where({ id: subOrderId }).first();
  if (!current) throw new AppError('NOT_FOUND', 'Sub-order not found', 404);

  await trx('orders').where({ id: current.order_id }).forUpdate().first();
  assertTransition(current.status, to);

  // Optimistic check: only update if the status is still what we just read.
  // 0 rows = someone else changed it first (e.g. a dispute opened during auto-complete).
  const [updated] = await trx('sub_orders')
    .where({ id: subOrderId, status: current.status })
    .update({ ...extraFields, status: to, updated_at: trx.fn.now() })
    .returning('*');
  if (!updated) {
    throw invalidTransition(current.status, to, 'The sub-order was changed by another request; reload and try again');
  }

  await trx('sub_order_events').insert({
    sub_order_id: subOrderId,
    from_status: current.status,
    to_status: to,
    actor_id: String(actorId),
    actor_role: actorRole,
    note,
  });
  await recomputeOrderStatus(trx, current.order_id);
  return updated;
}

async function recomputeOrderStatus(trx, orderId) {
  const rows = await trx('sub_orders').where({ order_id: orderId }).select('status');
  const status = deriveOrderStatus(rows.map((r) => r.status));
  await trx('orders').where({ id: orderId }).update({ status, updated_at: trx.fn.now() });
  return status;
}

module.exports = { TRANSITIONS, FINAL, allowedFrom, assertTransition, deriveOrderStatus, transition, recomputeOrderStatus };
