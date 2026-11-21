// Crash safety for checkout (outbox-style recovery).
//
// A checkout first commits in Postgres (money in escrow, stock_status PENDING),
// then takes stock in MongoDB. If the process died in between, the order stays
// PENDING forever. This job finds such orders (older than 5 minutes, far longer
// than any real checkout) and compensates them: refund the buyer, cancel the
// sub-orders, stock_status RELEASED.
//
// It never TAKES stock. If the crash happened halfway through the stock step,
// some items may already have been decremented: they stay decremented, so the
// shop shows slightly LESS stock than it has. That is the safe direction: we
// can under-count, but never sell something we don't have.
const cron = require('node-cron');
const logger = require('../config/logger');
const orderRepository = require('../modules/orders/order.repository');
const { compensateOrder } = require('../modules/orders/checkout.service');

const OLDER_THAN_MINUTES = 5;
const BATCH_SIZE = 50;

let running = false;
let task = null;

async function runOnce({ olderThanMinutes = OLDER_THAN_MINUTES } = {}) {
  if (running) return { compensated: 0, skipped: 0, failed: 0, alreadyRunning: true };
  running = true;
  const result = { compensated: 0, skipped: 0, failed: 0 };
  try {
    const ids = await orderRepository.findStalePendingStockOrderIds({ olderThanMinutes, limit: BATCH_SIZE });
    for (const id of ids) {
      try {
        // skipLocked: if a request is still working on this order, leave it alone.
        const done = await compensateOrder(id, { reason: 'CHECKOUT_INTERRUPTED', skipLocked: true });
        if (done) result.compensated += 1;
        else result.skipped += 1;
      } catch (err) {
        result.failed += 1;
        logger.error({ err, orderId: id }, 'Stock recovery failed for order');
      }
    }
    if (ids.length > 0) logger.warn(result, 'Stock recovery compensated interrupted checkouts');
    return result;
  } finally {
    running = false;
  }
}

function start() {
  task = cron.schedule('* * * * *', () => {
    runOnce().catch((err) => logger.error({ err }, 'Stock recovery job crashed'));
  });
  logger.info('Stock recovery job scheduled (every minute)');
}

function stop() {
  if (task) task.stop();
}

module.exports = { runOnce, start, stop };
