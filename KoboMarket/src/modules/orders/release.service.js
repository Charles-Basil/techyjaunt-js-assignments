// Releasing escrow: the moment a vendor actually gets paid.
// Used by buyer confirm and by the auto-complete job. Everything in ONE transaction:
//
//   DEBIT  PLATFORM_ESCROW    subtotal
//   CREDIT vendor wallet      subtotal - commission
//   CREDIT PLATFORM_REVENUE   commission           (skipped when 0)
//
// The ledger reference ORDER_RELEASE:<subOrderId> is UNIQUE, so even if every
// other check failed, the same sub-order could never be paid out twice.
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const { toKoboNumber } = require('../../utils/money');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const orderRepository = require('./order.repository');
const { transition, allowedFrom } = require('./orderStateMachine');
const { splitCommission } = require('./commission');

/**
 * @param subOrderId
 * @param options.actorId / actorRole  who triggers it (buyer, or 'SYSTEM' for the job)
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
      reference: `ORDER_RELEASE:${subOrderId}`,
      type: 'ORDER_RELEASE',
      // allowFrozen: the vendor earned this; a freeze blocks spending and payouts, not earnings.
      metadata: { orderId: subOrder.order_id, subOrderId, commissionRateBps: subOrder.commission_rate_bps, allowFrozen: true },
      entries,
    });

    const updated = await transition(trx, subOrderId, 'COMPLETED', {
      actorId,
      actorRole,
      note,
      extraFields: { commission_kobo: commissionKobo.toString(), completed_at: trx.fn.now() },
    });
    return { subOrder: updated, commissionKobo, vendorAmountKobo };
  });

  if (result) {
    emitEvent('funds.released', {
      subOrderId,
      orderId: result.subOrder.order_id,
      vendorId: result.subOrder.vendor_id,
      vendorAmountKobo: toKoboNumber(result.vendorAmountKobo),
      commissionKobo: toKoboNumber(result.commissionKobo),
    });
  }
  return result;
}

module.exports = { releaseSubOrder };
