// Disputes: a buyer says "something is wrong" with a shipped sub-order. The
// escrow stays frozen (the auto-complete job skips it) until an admin resolves it.
//
// Lock order is the same as everywhere else:
//   order row -> sub-order row -> dispute row -> accounts (ledger.lockAccounts, id order)
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const { toKoboNumber } = require('../../utils/money');
const pagination = require('../../utils/pagination');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const orderPolicy = require('../../policies/orderPolicy');
const disputePolicy = require('../../policies/disputePolicy');
const orderRepository = require('../orders/order.repository');
const { transition, allowedFrom } = require('../orders/orderStateMachine');
const { splitCommission } = require('../orders/commission');
const { releaseInTransaction, emitReleased, escrowSettlementKey } = require('../orders/release.service');
const disputeRepository = require('./dispute.repository');
const adminAuditRepository = require('../admin/adminAudit.repository');

function disputeDto(d) {
  return {
    id: d.id,
    subOrderId: d.sub_order_id,
    orderId: d.order_id,
    buyerId: d.buyer_id,
    vendorId: d.vendor_id,
    subtotalKobo: d.subtotal_kobo === undefined ? undefined : toKoboNumber(d.subtotal_kobo),
    reason: d.reason,
    evidence: d.evidence,
    status: d.status,
    resolution: d.resolution,
    refundKobo: d.refund_kobo === null ? null : toKoboNumber(d.refund_kobo),
    resolvedBy: d.resolved_by,
    resolutionNote: d.resolution_note,
    createdAt: d.created_at,
    resolvedAt: d.resolved_at,
  };
}

// Locks the parent order then the sub-order (the global lock order).
async function lockSubOrderWithParent(trx, subOrderId) {
  const peek = await orderRepository.findSubOrder(subOrderId, trx);
  if (!peek) return null;
  await orderRepository.lockOrder(trx, peek.order_id);
  return orderRepository.lockSubOrder(trx, subOrderId);
}

// ---------- open ----------

async function openDispute(user, subOrderId, { reason, evidence }) {
  const dispute = await knex.transaction(async (trx) => {
    const subOrder = await lockSubOrderWithParent(trx, subOrderId);
    orderPolicy.assertIsBuyer(user, subOrder); // not your sub-order -> 404

    if (subOrder.status === 'DISPUTED') {
      throw new AppError('DISPUTE_ALREADY_OPEN', 'There is already an open dispute for this sub-order', 409);
    }
    if (!['SHIPPED', 'DELIVERED'].includes(subOrder.status)) {
      throw new AppError('INVALID_STATE_TRANSITION', `Cannot dispute a sub-order that is ${subOrder.status}`, 409, {
        from: subOrder.status,
        to: 'DISPUTED',
        allowed: allowedFrom(subOrder.status),
      });
    }

    let created;
    try {
      created = await disputeRepository.insert(trx, { subOrderId, buyerId: user._id, reason, evidence });
    } catch (err) {
      // The partial unique index (one OPEN dispute per sub-order) is the database backstop.
      if (err.code === '23505' && err.constraint === 'disputes_one_open_per_sub_order') {
        throw new AppError('DISPUTE_ALREADY_OPEN', 'There is already an open dispute for this sub-order', 409);
      }
      throw err;
    }
    await transition(trx, subOrderId, 'DISPUTED', {
      actorId: user._id,
      actorRole: 'BUYER',
      note: `Dispute opened: ${reason.slice(0, 200)}`,
    });
    return created;
  });

  const saved = await disputeRepository.findById(dispute.id);
  emitEvent('dispute.opened', {
    disputeId: dispute.id,
    subOrderId,
    orderId: saved.order_id,
    buyerId: String(user._id),
    vendorId: saved.vendor_id,
  });
  return disputeDto(saved);
}

// ---------- read ----------

async function listDisputes({ status, limit, cursor }) {
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const rows = await disputeRepository.list({ status, after, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(disputeDto),
    pagination: { nextCursor: hasMore ? pagination.encodeCursor(last.cursor_created_at, last.id) : null, hasMore, limit },
  };
}

async function getDisputeForUser(user, disputeId) {
  const dispute = await disputeRepository.findById(disputeId);
  disputePolicy.assertCanViewDispute(user, dispute);
  return disputeDto(dispute);
}

// ---------- resolve (ADMIN) ----------

/**
 * One transaction, one ledger transaction (reference DISPUTE_RESOLUTION:<disputeId>,
 * UNIQUE, so a dispute can never be resolved twice):
 *
 *   FULL_REFUND     escrow -> buyer (whole subtotal)                    -> REFUNDED
 *   PARTIAL_REFUND  escrow -> buyer (refund), vendor (rest - commission),
 *                   revenue (commission on the vendor's part only)      -> COMPLETED
 *   REJECTED        normal release: escrow -> vendor + revenue          -> COMPLETED
 *
 * allowFrozen everywhere: an admin's decision must always be able to settle escrow.
 */
async function resolveDispute(admin, disputeId, { resolution, refundKobo, note }) {
  const adminId = String(admin._id);
  const outcome = await knex.transaction(async (trx) => {
    const peek = await disputeRepository.findById(disputeId, trx);
    if (!peek) throw new AppError('NOT_FOUND', 'Dispute not found', 404);

    const subOrder = await lockSubOrderWithParent(trx, peek.sub_order_id);
    const dispute = await disputeRepository.lockById(trx, disputeId);
    if (dispute.status !== 'OPEN') {
      throw new AppError('DISPUTE_ALREADY_RESOLVED', 'This dispute has already been resolved', 409);
    }
    if (subOrder.status !== 'DISPUTED') {
      throw new AppError('INVALID_STATE_TRANSITION', `The sub-order is ${subOrder.status}, not DISPUTED`, 409, {
        from: subOrder.status,
        to: resolution === 'FULL_REFUND' ? 'REFUNDED' : 'COMPLETED',
        allowed: allowedFrom(subOrder.status),
      });
    }

    const subtotal = BigInt(subOrder.subtotal_kobo);
    const reference = `DISPUTE_RESOLUTION:${disputeId}`;
    const eventNote = `Dispute ${resolution}: ${note}`;
    const metadata = { disputeId, subOrderId: subOrder.id, orderId: subOrder.order_id, resolution, allowFrozen: true };
    let refunded = null;
    let released = null;

    if (resolution === 'REJECTED') {
      // The buyer's claim is rejected: pay the vendor exactly as a normal release would.
      released = await releaseInTransaction(trx, subOrder, {
        actorId: adminId,
        actorRole: 'ADMIN',
        note: eventNote,
        reference,
        type: 'DISPUTE_RESOLUTION',
        metadata,
      });
    } else {
      const refund = resolution === 'FULL_REFUND' ? subtotal : BigInt(refundKobo);
      // A partial refund must leave something for the vendor: 0 < refund < subtotal.
      if (resolution === 'PARTIAL_REFUND' && (refund <= 0n || refund >= subtotal)) {
        throw new AppError('INVALID_REFUND_AMOUNT', 'A partial refund must be more than 0 and less than the subtotal', 400, {
          subtotalKobo: toKoboNumber(subtotal),
          refundKobo: toKoboNumber(refund),
        });
      }

      // Commission only on what the vendor keeps (0 for a full refund).
      const vendorPart = subtotal - refund;
      const { commissionKobo, vendorAmountKobo } = splitCommission(vendorPart, subOrder.commission_rate_bps);

      const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
      const revenue = await ledger.getSystemAccount(trx, 'PLATFORM_REVENUE');
      const buyerWallet = await ledger.getUserAccount(trx, subOrder.buyer_id);
      const vendorWallet = await ledger.getUserAccount(trx, subOrder.vendor_id);
      await ledger.lockAccounts(trx, [escrow.id, buyerWallet.id, vendorWallet.id, revenue.id]);

      const entries = [
        { accountId: escrow.id, direction: 'DEBIT', amountKobo: subtotal },
        { accountId: buyerWallet.id, direction: 'CREDIT', amountKobo: refund },
      ];
      if (vendorAmountKobo > 0n) entries.push({ accountId: vendorWallet.id, direction: 'CREDIT', amountKobo: vendorAmountKobo });
      if (commissionKobo > 0n) entries.push({ accountId: revenue.id, direction: 'CREDIT', amountKobo: commissionKobo });

      await ledger.postTransaction(trx, {
        reference,
        type: 'DISPUTE_RESOLUTION',
        idempotencyKey: escrowSettlementKey(subOrder.id), // escrow of a sub-order settles once, by any path
        metadata: { ...metadata, refundKobo: refund.toString() },
        entries,
      });

      await transition(trx, subOrder.id, resolution === 'FULL_REFUND' ? 'REFUNDED' : 'COMPLETED', {
        actorId: adminId,
        actorRole: 'ADMIN',
        note: eventNote,
        extraFields:
          resolution === 'FULL_REFUND'
            ? {}
            : { commission_kobo: commissionKobo.toString(), completed_at: trx.fn.now() },
      });
      refunded = refund;
    }

    await disputeRepository.markResolved(trx, disputeId, { resolution, refundKobo: refunded, resolvedBy: adminId, note });
    // Same transaction: the audit row exists if and only if the resolution happened.
    await adminAuditRepository.record(trx, {
      adminId,
      action: 'DISPUTE_RESOLVED',
      targetType: 'DISPUTE',
      targetId: disputeId,
      before: { status: 'OPEN', subOrderStatus: 'DISPUTED' },
      after: { status: 'RESOLVED', resolution, refundKobo: refunded === null ? null : refunded.toString() },
      note,
    });
    return { released, refunded, subOrder };
  });

  if (outcome.released) emitReleased(outcome.released);
  emitEvent('dispute.resolved', {
    disputeId,
    subOrderId: outcome.subOrder.id,
    buyerId: outcome.subOrder.buyer_id,
    vendorId: outcome.subOrder.vendor_id,
    resolution,
    refundKobo: outcome.refunded === null ? 0 : toKoboNumber(outcome.refunded),
  });
  return disputeDto(await disputeRepository.findById(disputeId));
}

module.exports = { openDispute, listDisputes, getDisputeForUser, resolveDispute };
