// Sends PENDING payouts to the bank, every minute (PAYOUT_JOB_CRON).
//
// 1. Recovery first: payouts stuck in PROCESSING for 15+ minutes (the job
//    crashed mid-run) are checked with verifyTransfer.
// 2. Claim up to 10 PENDING payouts atomically (-> PROCESSING, attempts + 1).
// 3. For each: initiateTransfer (reference = payout id, so the provider never
//    sends the same payout twice), then:
//      success        -> settle()   (clearing -> external)
//      failed         -> fail()     (clearing -> vendor wallet: money back)
//      pending        -> stays PROCESSING (settled later by verify / webhook)
//      provider threw -> outcome UNKNOWN: back to PENDING to retry; after
//                        MAX_ATTEMPTS, check verifyTransfer once more, then fail().
const cron = require('node-cron');
const env = require('../config/env');
const logger = require('../config/logger');
const paystack = require('../integrations/paystack/paystack.client');
const vendorRepository = require('../modules/vendors/vendor.repository');
const payoutRepository = require('../modules/payouts/payout.repository');
const { settle, fail } = require('../modules/payouts/payout.settlement');

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const STUCK_AFTER_MINUTES = 15;

let running = false;
let task = null;

// Acts on a provider result. Returns the counter to increase.
async function applyResult(payoutId, result) {
  if (result.status === 'success') {
    await settle(payoutId, { providerReference: result.providerReference });
    return 'settled';
  }
  if (result.status === 'failed') {
    await fail(payoutId, result.reason || 'Transfer failed');
    return 'failed';
  }
  if (result.providerReference) await payoutRepository.setProviderReference(payoutId, result.providerReference);
  return 'processing'; // 'pending': wait for the webhook or the recovery check
}

async function onProviderError(payout, err) {
  if (payout.attempts < MAX_ATTEMPTS) {
    await payoutRepository.releaseClaim(payout.id, err.message);
    return 'retried';
  }
  // Out of attempts. Before giving the money back, ask the provider whether the
  // transfer happened after all (we must never refund money that really left).
  let check = null;
  try {
    check = await paystack.verifyTransfer(payout.id);
  } catch (verifyErr) {
    logger.error({ err: verifyErr, payoutId: payout.id }, 'verifyTransfer failed too');
  }
  if (check && check.status === 'success') return applyResult(payout.id, check);
  if (check && check.status === 'pending') return applyResult(payout.id, check);
  await fail(payout.id, `Provider error after ${payout.attempts} attempts: ${err.message}`);
  return 'failed';
}

async function processPayout(payout) {
  // The FULL account number lives only in the vendor profile (the payout keeps a masked copy).
  const profile = await vendorRepository.findByUserId(payout.vendor_id);
  if (!profile || !profile.bankDetails) {
    await fail(payout.id, 'Vendor bank details are missing');
    return 'failed';
  }
  let result;
  try {
    result = await paystack.initiateTransfer({
      reference: payout.id,
      amountKobo: BigInt(payout.amount_kobo),
      bank: profile.bankDetails,
    });
  } catch (err) {
    return onProviderError(payout, err);
  }
  return applyResult(payout.id, result);
}

async function recoverStuck(counters) {
  const ids = await payoutRepository.findStuckProcessingIds({ olderThanMinutes: STUCK_AFTER_MINUTES, limit: BATCH_SIZE });
  for (const id of ids) {
    try {
      const check = await paystack.verifyTransfer(id);
      if (check.status === 'not_found') {
        // The provider never received it: safe to send again.
        await payoutRepository.releaseClaim(id, 'Recovered: transfer was never started');
        counters.retried += 1;
      } else {
        counters[await applyResult(id, check)] += 1;
      }
    } catch (err) {
      logger.error({ err, payoutId: id }, 'Payout recovery: outcome still unknown, will check again later');
    }
  }
}

async function runOnce() {
  if (running) return { settled: 0, failed: 0, retried: 0, processing: 0, alreadyRunning: true };
  running = true;
  const counters = { settled: 0, failed: 0, retried: 0, processing: 0 };
  try {
    await recoverStuck(counters);
    const claimed = await payoutRepository.claimPending(BATCH_SIZE);
    for (const payout of claimed) {
      try {
        counters[await processPayout(payout)] += 1;
      } catch (err) {
        // e.g. the database failed while settling: it stays PROCESSING and the
        // recovery step picks it up after 15 minutes.
        logger.error({ err, payoutId: payout.id }, 'Payout processing failed');
      }
    }
    if (claimed.length > 0) logger.info(counters, 'Payout job run finished');
    return counters;
  } finally {
    running = false;
  }
}

function start() {
  task = cron.schedule(env.PAYOUT_JOB_CRON, () => {
    runOnce().catch((err) => logger.error({ err }, 'Payout job crashed'));
  });
  logger.info(`Payout job scheduled (${env.PAYOUT_JOB_CRON})`);
}

function stop() {
  if (task) task.stop();
}

module.exports = { runOnce, start, stop, MAX_ATTEMPTS };
