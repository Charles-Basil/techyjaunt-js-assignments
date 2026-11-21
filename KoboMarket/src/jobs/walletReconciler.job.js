// Safety net for wallet creation. Every minute: find users whose wallet is
// still PENDING (older than 30s, so we don't race a registration that is
// still running) and retry ensureWallet. ensureWallet is idempotent, so a
// retry can never create a second wallet.
const cron = require('node-cron');
const logger = require('../config/logger');
const userRepository = require('../modules/users/user.repository');
const walletService = require('../modules/wallet/wallet.service');

const BATCH_SIZE = 100;
const MIN_AGE_MS = 30 * 1000;

let running = false; // stops two runs overlapping if one takes over a minute
let task = null;

async function runOnce() {
  if (running) return { skipped: true };
  running = true;
  let fixed = 0;
  let failed = 0;
  try {
    const users = await userRepository.findPendingWallets(new Date(Date.now() - MIN_AGE_MS), BATCH_SIZE);
    // One at a time: simple, and gentle on the databases.
    for (const user of users) {
      try {
        await walletService.ensureWallet(user._id);
        fixed += 1;
      } catch (err) {
        failed += 1;
        logger.error({ err, userId: String(user._id) }, 'Wallet reconciler: retry failed');
      }
    }
    if (users.length > 0) logger.info({ fixed, failed }, 'Wallet reconciler run finished');
    return { fixed, failed };
  } finally {
    running = false;
  }
}

function start() {
  task = cron.schedule('* * * * *', () => {
    runOnce().catch((err) => logger.error({ err }, 'Wallet reconciler crashed'));
  });
  logger.info('Wallet reconciler job scheduled (every minute)');
}

function stop() {
  if (task) task.stop();
}

module.exports = { runOnce, start, stop };
