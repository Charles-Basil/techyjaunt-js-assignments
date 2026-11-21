// Escrow timeout: a sub-order SHIPPED (or DELIVERED) more than
// ESCROW_TIMEOUT_HOURS ago, with no OPEN dispute, is completed automatically
// and the vendor is paid. The buyer had their chance to confirm or dispute.
// DISPUTED sub-orders are never selected.
const cron = require('node-cron');
const env = require('../config/env');
const logger = require('../config/logger');
const orderRepository = require('../modules/orders/order.repository');
const { releaseSubOrder } = require('../modules/orders/release.service');

const BATCH_SIZE = 50;

let running = false; // stops two runs overlapping if one takes over a minute
let task = null;

/**
 * Why the lock is taken per row, not in the candidate query:
 * each sub-order is released in its OWN transaction. A FOR UPDATE held by a
 * separate "select the batch" transaction would block those release
 * transactions. So the batch query just lists candidates, and each release
 * locks its rows with FOR UPDATE SKIP LOCKED and re-checks the same conditions
 * under the lock (a dispute may have opened a second ago). A row another
 * request is working on right now (e.g. the buyer confirming) is skipped and
 * picked up on a later run if it still qualifies.
 */
async function runOnce() {
  if (running) return { completed: 0, skipped: 0, failed: 0, alreadyRunning: true };
  running = true;
  const result = { completed: 0, skipped: 0, failed: 0 };
  try {
    const timeoutHours = env.ESCROW_TIMEOUT_HOURS;
    const ids = await orderRepository.findAutoCompleteCandidateIds({ timeoutHours, limit: BATCH_SIZE });

    for (const id of ids) {
      try {
        const released = await releaseSubOrder(id, {
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          note: `Auto-completed: no confirmation or dispute within ${timeoutHours}h of shipping`,
          fromStatuses: ['SHIPPED', 'DELIVERED'],
          skipLocked: true,
          stillEligible: (trx) => orderRepository.isStillAutoCompletable(trx, id, timeoutHours),
        });
        if (released) result.completed += 1;
        else result.skipped += 1;
      } catch (err) {
        // Its status changed between our query and the lock: not an error.
        if (err.code === 'INVALID_STATE_TRANSITION') {
          result.skipped += 1;
        } else {
          result.failed += 1;
          logger.error({ err, subOrderId: id }, 'Auto-complete failed for sub-order');
        }
      }
    }
    if (ids.length > 0) logger.info(result, 'Auto-complete run finished');
    return result;
  } finally {
    running = false;
  }
}

function start() {
  task = cron.schedule(env.AUTO_COMPLETE_CRON, () => {
    runOnce().catch((err) => logger.error({ err }, 'Auto-complete job crashed'));
  });
  logger.info(`Auto-complete job scheduled (${env.AUTO_COMPLETE_CRON})`);
}

function stop() {
  if (task) task.stop();
}

module.exports = { runOnce, start, stop };
