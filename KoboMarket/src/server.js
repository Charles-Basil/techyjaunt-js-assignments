// Entry point: connect both databases, start HTTP, shut down cleanly.
const env = require('./config/env');
const logger = require('./config/logger');
const app = require('./app');
const { connectMongo, disconnectMongo } = require('./config/mongo');
const { connectPostgres, disconnectPostgres } = require('./config/knex');
const walletReconciler = require('./jobs/walletReconciler.job');

let server;
let shuttingDown = false;

async function start() {
  await connectMongo();
  await connectPostgres();
  server = app.listen(env.PORT, () => {
    logger.info(`KoboMarket API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
  // Background jobs start only after both databases are connected.
  walletReconciler.start();
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down...');

  // If cleanup hangs, force-exit after 10s. unref() so this timer alone
  // doesn't keep the process alive.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();

  try {
    walletReconciler.stop(); // no new job runs during shutdown
    // Stop accepting new requests and wait for in-flight ones to finish.
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectMongo();
    await disconnectPostgres();
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // docker stop
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  shutdown('startupFailure', 1);
});
