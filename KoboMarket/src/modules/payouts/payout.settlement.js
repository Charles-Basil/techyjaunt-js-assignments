// The two ways a payout ends, used by the payout job AND by the transfer webhooks.
// Both lock the payout row first and check its status, so a job run and a
// webhook arriving together can't both act: the second one sees it finished.
//
//   settle: money really left -> DEBIT PLATFORM_PAYOUT_CLEARING, CREDIT PLATFORM_EXTERNAL_SETTLEMENT
//   fail:   transfer failed   -> DEBIT PLATFORM_PAYOUT_CLEARING, CREDIT vendor wallet (money back)
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const payoutRepository = require('./payout.repository');

/** @returns true if this call settled it, false if it was already SUCCESS */
async function settle(payoutId, { providerReference = null } = {}) {
  const payout = await knex.transaction(async (trx) => {
    // Lock order: payout row -> accounts.
    const locked = await payoutRepository.lockById(trx, payoutId);
    if (!locked) throw new AppError('NOT_FOUND', 'Payout not found', 404);
    if (locked.status === 'SUCCESS') return null; // already done: nothing to do
    if (locked.status !== 'PROCESSING') {
      throw new AppError('PAYOUT_NOT_PROCESSING', `Cannot settle a payout that is ${locked.status}`, 409);
    }

    const amount = BigInt(locked.amount_kobo);
    const clearing = await ledger.getSystemAccount(trx, 'PLATFORM_PAYOUT_CLEARING');
    const external = await ledger.getSystemAccount(trx, 'PLATFORM_EXTERNAL_SETTLEMENT');
    await ledger.lockAccounts(trx, [clearing.id, external.id]);
    await ledger.postTransaction(trx, {
      reference: `PAYOUT_SETTLED:${payoutId}`,
      type: 'PAYOUT_SETTLED',
      metadata: { payoutId, vendorId: locked.vendor_id, providerReference },
      entries: [
        { accountId: clearing.id, direction: 'DEBIT', amountKobo: amount },
        { accountId: external.id, direction: 'CREDIT', amountKobo: amount },
      ],
    });
    await payoutRepository.markSuccess(trx, payoutId, providerReference || locked.provider_reference);
    return locked;
  });

  if (payout) emitEvent('payout.success', { payoutId, vendorId: payout.vendor_id, amountKobo: payout.amount_kobo });
  return Boolean(payout);
}

/** @returns true if this call failed (and refunded) it, false if it was already FAILED */
async function fail(payoutId, reason) {
  const payout = await knex.transaction(async (trx) => {
    const locked = await payoutRepository.lockById(trx, payoutId);
    if (!locked) throw new AppError('NOT_FOUND', 'Payout not found', 404);
    if (locked.status === 'FAILED') return null;
    if (locked.status === 'SUCCESS') {
      // The money has left: never "refund" it as well.
      throw new AppError('PAYOUT_ALREADY_SETTLED', 'This payout has already been paid out', 409);
    }

    const amount = BigInt(locked.amount_kobo);
    const clearing = await ledger.getSystemAccount(trx, 'PLATFORM_PAYOUT_CLEARING');
    await ledger.lockAccounts(trx, [clearing.id, locked.account_id]);
    await ledger.postTransaction(trx, {
      reference: `PAYOUT_REVERSAL:${payoutId}`,
      type: 'PAYOUT_REVERSAL',
      // allowFrozen: giving a vendor their own money back is always allowed.
      metadata: { payoutId, vendorId: locked.vendor_id, reason, allowFrozen: true },
      entries: [
        { accountId: clearing.id, direction: 'DEBIT', amountKobo: amount },
        { accountId: locked.account_id, direction: 'CREDIT', amountKobo: amount },
      ],
    });
    await payoutRepository.markFailed(trx, payoutId, reason);
    return locked;
  });

  if (payout) emitEvent('payout.failed', { payoutId, vendorId: payout.vendor_id, reason });
  return Boolean(payout);
}

module.exports = { settle, fail };
