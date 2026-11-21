// Paystack webhook processing. Goal: a successful payment credits the wallet
// EXACTLY ONCE, however many times (or how concurrently) Paystack sends it.
// Three layers guarantee that (see README "Wallet funding and webhook idempotency"):
//   1. SELECT ... FOR UPDATE on the wallet_fundings row (duplicates wait in line)
//   2. the status check: a SUCCESS funding is never credited again
//   3. the unique idempotency key paystack:<reference> on transactions
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const { toKoboBigInt } = require('../../utils/money');
const ledger = require('../../ledger/ledger.service');
const paystack = require('../../integrations/paystack/paystack.client');
const fundingRepository = require('./funding.repository');
const webhookEventRepository = require('./webhookEvent.repository');

const PROVIDER = 'paystack';

// Compares OUR HMAC of the exact raw bytes with the header value.
// timingSafeEqual takes the same time whether the first or last character
// differs, so an attacker can't guess the signature byte by byte.
function isValidSignature(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') return false;
  const expected = Buffer.from(crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex'));
  const received = Buffer.from(signature);
  // timingSafeEqual throws on different lengths, so check that first.
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

// Asks the provider directly. Never trust the webhook body alone.
// Returns { ok: true, paidAt } or { ok: false, providerSaysFailed, note }.
async function verifyWithProvider(reference, funding) {
  const result = await paystack.verifyTransaction(reference); // network errors propagate (-> 500 -> retry)
  const data = result && result.status === true ? result.data : null;

  if (!data) return { ok: false, providerSaysFailed: false, note: 'Provider has no such transaction' };
  if (data.status !== 'success') {
    return { ok: false, providerSaysFailed: data.status === 'failed', note: `Provider status is ${data.status}` };
  }
  if (data.reference !== reference) return { ok: false, providerSaysFailed: false, note: 'Reference mismatch' };
  if (data.currency !== 'NGN') return { ok: false, providerSaysFailed: false, note: `Currency is ${data.currency}` };
  // Compare as BigInt. Number.isSafeInteger first: BigInt(10.5) would throw.
  if (!Number.isSafeInteger(data.amount) || BigInt(data.amount) !== toKoboBigInt(funding.amount_kobo)) {
    return { ok: false, providerSaysFailed: false, note: `Amount mismatch: provider ${data.amount}, expected ${funding.amount_kobo}` };
  }

  const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
  return { ok: true, paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt };
}

// The credit itself: ONE database transaction.
async function creditFunding(reference, paidAt) {
  return knex.transaction(async (trx) => {
    // Layer 1: lock the funding row. A concurrent duplicate blocks here until we commit.
    const funding = await fundingRepository.findByReferenceForUpdate(trx, reference);
    if (!funding) return { result: 'UNKNOWN_REFERENCE' };
    // Layer 2: after waiting for the lock, the duplicate sees SUCCESS and stops.
    if (funding.status === 'SUCCESS') return { result: 'ALREADY_PROCESSED' };

    const amount = toKoboBigInt(funding.amount_kobo);
    const external = await ledger.getSystemAccount(trx, 'PLATFORM_EXTERNAL_SETTLEMENT');
    // Layer 3: idempotencyKey is UNIQUE in transactions, a last line of defence.
    const { transaction } = await ledger.postTransaction(trx, {
      reference: `WALLET_FUNDING:${reference}`,
      type: 'WALLET_FUNDING',
      idempotencyKey: `paystack:${reference}`,
      // allowFrozen: the money has really arrived at Paystack, so the books must
      // record it. Freezing stops a user SPENDING, not receiving a payment they made.
      metadata: { provider: PROVIDER, fundingReference: reference, allowFrozen: true },
      entries: [
        { accountId: external.id, direction: 'DEBIT', amountKobo: amount },
        { accountId: funding.account_id, direction: 'CREDIT', amountKobo: amount },
      ],
    });
    await fundingRepository.markSuccess(trx, funding.id, { transactionId: transaction.id, paidAt });
    return { result: 'CREDITED' };
  });
}

async function handleChargeSuccess(reference) {
  // Read (no lock) to get the expected amount for verification.
  const funding = await fundingRepository.findByReference(reference);
  if (!funding) return { result: 'UNKNOWN_REFERENCE' };
  if (funding.status === 'SUCCESS') return { result: 'ALREADY_PROCESSED' }; // fast path, no provider call

  // Step 1: re-verify with the provider.
  const verification = await verifyWithProvider(reference, funding);
  if (!verification.ok) {
    if (verification.providerSaysFailed) await fundingRepository.markFailedIfPending(reference, verification.note);
    return { result: 'VERIFY_FAILED', note: verification.note };
  }

  // Step 2: lock + credit in one transaction.
  try {
    return await creditFunding(reference, verification.paidAt);
  } catch (err) {
    // Layer 3 fired: the ledger already has this payment. Nothing to do.
    if (err.code === 'DUPLICATE_TRANSACTION') {
      logger.error({ reference }, 'Funding already in the ledger but not marked SUCCESS');
      return { result: 'ALREADY_PROCESSED', note: 'Duplicate ledger transaction' };
    }
    throw err;
  }
}

async function handleChargeFailed(reference) {
  // Only a PENDING funding becomes FAILED; a SUCCESS is never undone by a webhook.
  const updated = await fundingRepository.markFailedIfPending(reference, 'Provider reported charge.failed');
  return { result: updated ? 'MARKED_FAILED' : 'IGNORED', note: updated ? null : 'Funding not pending' };
}

/**
 * Entry point used by the controller.
 * Throws 401 INVALID_SIGNATURE for unsigned/badly signed requests.
 * Returns normally (-> 200) for every validly signed event, so Paystack stops retrying.
 * Unexpected errors (e.g. database down) bubble up as 500, and Paystack retries later.
 */
async function handlePaystackWebhook({ rawBody, signature, payload }) {
  const event = payload && payload.event;
  const reference = payload && payload.data && payload.data.reference;

  if (!isValidSignature(rawBody, signature)) {
    await webhookEventRepository.record({
      provider: PROVIDER, event, reference, signatureValid: false, result: 'INVALID_SIGNATURE', payload,
    });
    throw new AppError('INVALID_SIGNATURE', 'Invalid webhook signature', 401);
  }

  let outcome;
  if (typeof reference !== 'string' || reference.length === 0) {
    outcome = { result: 'IGNORED', note: 'No reference in payload' };
  } else if (event === 'charge.success') {
    outcome = await handleChargeSuccess(reference);
  } else if (event === 'charge.failed') {
    outcome = await handleChargeFailed(reference);
  } else {
    outcome = { result: 'IGNORED', note: `Unhandled event ${event}` };
  }

  // Step 3: audit log of what we did.
  await webhookEventRepository.record({
    provider: PROVIDER, event, reference, signatureValid: true, result: outcome.result, note: outcome.note, payload,
  });
  logger.info({ event, reference, result: outcome.result }, 'Paystack webhook processed');
  return outcome;
}

module.exports = { handlePaystackWebhook, isValidSignature };
