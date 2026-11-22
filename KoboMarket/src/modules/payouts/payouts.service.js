// Vendor payouts: "send my wallet money to my bank account".
//
//   request (here)    vendor wallet -> PLATFORM_PAYOUT_CLEARING, payout PENDING
//   job               PENDING -> PROCESSING -> bank transfer
//   settle / fail     clearing -> external (SUCCESS) or clearing -> wallet (FAILED)
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const { toKoboNumber } = require('../../utils/money');
const pagination = require('../../utils/pagination');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const payoutPolicy = require('../../policies/payoutPolicy');
const vendorRepository = require('../vendors/vendor.repository');
const { maskAccountNumber } = require('../vendors/vendorProfile.model');
const payoutRepository = require('./payout.repository');

function payoutDto(p) {
  return {
    id: p.id,
    vendorId: p.vendor_id,
    amountKobo: toKoboNumber(p.amount_kobo),
    status: p.status,
    bankSnapshot: p.bank_snapshot,
    attempts: p.attempts,
    providerReference: p.provider_reference,
    failureReason: p.failure_reason,
    createdAt: p.created_at,
    processedAt: p.processed_at,
  };
}

async function requestPayout(user, amountKobo, idempotencyKey) {
  const vendorId = String(user._id);
  const profile = await vendorRepository.findByUserId(vendorId);
  if (!profile || profile.status !== 'APPROVED' || !profile.bankDetails) {
    throw new AppError('VENDOR_NOT_APPROVED', 'Only approved vendors with bank details can request payouts', 403);
  }
  const amount = BigInt(amountKobo);
  // Kept with the payout for the record. MASKED: the full number stays in the vendor profile.
  const bankSnapshot = {
    bankName: profile.bankDetails.bankName,
    bankCode: profile.bankDetails.bankCode,
    accountName: profile.bankDetails.accountName,
    accountNumber: maskAccountNumber(profile.bankDetails.accountNumber),
  };
  const payoutKey = `${vendorId}:${idempotencyKey}`;

  let payout;
  try {
    payout = await knex.transaction(async (trx) => {
      const wallet = await ledger.getUserAccount(trx, vendorId);
      const clearing = await ledger.getSystemAccount(trx, 'PLATFORM_PAYOUT_CLEARING');

      // The wallet row lock serialises two requests sent in the same millisecond:
      // the second waits here, then sees the reduced balance (402) or the pending payout (409).
      const locked = await ledger.lockAccounts(trx, [wallet.id, clearing.id]);
      const balance = BigInt(locked.find((a) => a.id === wallet.id).balance_kobo);
      if (balance < amount) {
        throw new AppError('INSUFFICIENT_FUNDS', 'Your wallet balance is too low for this payout', 402, {
          balanceKobo: toKoboNumber(balance),
          requestedKobo: toKoboNumber(amount),
        });
      }

      const created = await payoutRepository.insert(trx, {
        vendorId,
        accountId: wallet.id,
        amountKobo: amount,
        bankSnapshot,
        idempotencyKey: payoutKey,
      });

      // Money leaves the wallet NOW, so it can't be spent or withdrawn twice.
      await ledger.postTransaction(trx, {
        reference: `PAYOUT_REQUEST:${created.id}`,
        type: 'PAYOUT_REQUEST',
        metadata: { payoutId: created.id, vendorId },
        entries: [
          { accountId: wallet.id, direction: 'DEBIT', amountKobo: amount },
          { accountId: clearing.id, direction: 'CREDIT', amountKobo: amount },
        ],
      });
      return created;
    });
  } catch (err) {
    // Partial unique index: at most one PENDING/PROCESSING payout per vendor.
    if (err.code === '23505' && err.constraint === 'payouts_one_active_per_vendor') {
      throw new AppError('PAYOUT_ALREADY_PENDING', 'You already have a payout in progress', 409);
    }
    // Database backstop for idempotency: same vendor + key = the same payout.
    if (err.code === '23505' && err.constraint === 'payouts_idempotency_key_unique') {
      return payoutDto(await payoutRepository.findByIdempotencyKey(payoutKey));
    }
    throw err;
  }

  emitEvent('payout.requested', { payoutId: payout.id, vendorId, amountKobo: payout.amount_kobo });
  return payoutDto(payout);
}

async function listMine(vendorId, { status, limit, cursor }) {
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const rows = await payoutRepository.listForVendor(vendorId, { status, after, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(payoutDto),
    pagination: { nextCursor: hasMore ? pagination.encodeCursor(last.cursor_created_at, last.id) : null, hasMore, limit },
  };
}

async function getForUser(user, payoutId) {
  const payout = await payoutRepository.findById(payoutId);
  payoutPolicy.assertCanViewPayout(user, payout);
  return payoutDto(payout);
}

module.exports = { requestPayout, listMine, getForUser, payoutDto };
