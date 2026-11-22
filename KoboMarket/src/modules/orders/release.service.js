// Releasing escrow: the moment a vendor actually gets paid.
//
//   DEBIT  PLATFORM_ESCROW    subtotal
//   CREDIT vendor wallet      subtotal - commission
//   CREDIT PLATFORM_REVENUE   commission           (skipped when 0)
//
// Two ways in:
//   releaseSubOrder()       own transaction + locks: buyer confirm, auto-complete job
//   releaseInTransaction()  inside a caller's transaction: dispute REJECTED
//
// Every settlement of a sub-order's escrow (release, or any dispute resolution)
// uses idempotency_key ESCROW_SETTLEMENT:<subOrderId>, which is UNIQUE in
// transactions. So the escrow of one sub-order can be paid out at most once,
// whichever path tries to do it.
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const { toKoboNumber } = require('../../utils/money');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const orderRepository = require('./order.repository');
const { transition, allowedFrom } = require('./orderStateMachine');
const { splitCommission } = require('./commission');

const escrowSettlementKey = (subOrderId) => `ESCROW_SETTLEMENT:${subOrderId}`;

/**
 * Pays the vendor from escrow and moves the sub-order to COMPLETED.
 * The CALLER must already hold the locks on the parent order and the sub-order row.
 * @returns { subOrder, commissionKobo, vendorAmountKobo }
 */
async function releaseInTransaction(
  trx,
  subOrder,
  { actorId, actorRole, note = null, reference = `ORDER_RELEASE:${subOrder.id}`, type = 'ORDER_RELEASE', metadata = {} }
) {
  // Commission from the rate STORED on the sub-order at checkout time.
  const subtotal = BigInt(subOrder.subtotal_kobo);
  const { commissionKobo, vendorAmountKobo } = splitCommission(subtotal, subOrder.commission_rate_bps);

  const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
  const revenue = await ledger.getSystemAccount(trx, 'PLATFORM_REVENUE');
  const vendorWallet = await ledger.getUserAccount(trx, subOrder.vendor_id);
  await ledger.lockAccounts(trx, [escrow.id, vendorWallet.id, revenue.id]);

  const entries = [{ accountId: escrow.id, direction: 'DEBIT', amountKobo: subtotal }];
  if (vendorAmountKobo > 0n) entries.push({ accountId: vendorWallet.id, direction: 'CREDIT', amountKobo: vendorAmountKobo });
  if (commissionKobo > 0n) entries.push({ accountId: revenue.id, direction: 'CREDIT', amountKobo: commissionKobo });

  await ledger.postTransaction(trx, {
    reference,
    type,
    idempotencyKey: escrowSettlementKey(subOrder.id),
    // allowFrozen: the vendor earned this; a freeze blocks spending and payouts, not earnings.
    metadata: {
      orderId: subOrder.order_id,
      subOrderId: subOrder.id,
      commissionRateBps: subOrder.commission_rate_bps,
      allowFrozen: true,
      ...metadata,
    },
    entries,
  });

  const updated = await transition(trx, subOrder.id, 'COMPLETED', {
    actorId,
    actorRole,
    note,
    extraFields: { commission_kobo: commissionKobo.toString(), completed_at: trx.fn.now() },
  });
  return { subOrder: updated, commissionKobo, vendorAmountKobo };
}

function emitReleased(result) {
  emitEvent('funds.released', {
    subOrderId: result.subOrder.id,
    orderId: result.subOrder.order_id,
    vendorId: result.subOrder.vendor_id,
    vendorAmountKobo: toKoboNumber(result.vendorAmountKobo),
    commissionKobo: toKoboNumber(result.commissionKobo),
  });
}

/**
 * Release in its own transaction (buyer confirm, auto-complete job).
 * @param options.fromStatuses  statuses this caller may complete from
 * @param options.skipLocked    jobs: skip rows another request is working on
 * @param options.stillEligible jobs: re-check the job's conditions under the lock
 * @returns { subOrder, commissionKobo, vendorAmountKobo } or null if skipped
 */
async function releaseSubOrder(
  subOrderId,
  { actorId, actorRole, note = null, fromStatuses = ['SHIPPED', 'DELIVERED'], skipLocked = false, stillEligible = null }
) {
  const result = await knex.transaction(async (trx) => {
    const peek = await orderRepository.findSubOrder(subOrderId, trx);
    if (!peek) throw new AppError('NOT_FOUND', 'Sub-order not found', 404);

    // Lock order: parent order -> sub-order -> accounts.
    const order = await orderRepository.lockOrder(trx, peek.order_id, { skipLocked });
    if (!order) return null;
    const subOrder = await orderRepository.lockSubOrder(trx, subOrderId, { skipLocked });
    if (!subOrder) return null;
    if (stillEligible && !(await stillEligible(trx, subOrder))) return null;

    if (!fromStatuses.includes(subOrder.status)) {
      throw new AppError('INVALID_STATE_TRANSITION', `Cannot complete a sub-order that is ${subOrder.status}`, 409, {
        from: subOrder.status,
        to: 'COMPLETED',
        allowed: allowedFrom(subOrder.status),
      });
    }
    return releaseInTransaction(trx, subOrder, { actorId, actorRole, note });
  });

  if (result) emitReleased(result);
  return result;
}

module.exports = { releaseSubOrder, releaseInTransaction, emitReleased, escrowSettlementKey };
