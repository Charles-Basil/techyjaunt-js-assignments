// Runs ONE background job once and prints its result (handy for demos and support).
//   npm run job -- payouts          (on your machine, against the .env databases)
//   docker compose exec api node scripts/run-job.js payouts
// Jobs: payouts, auto-complete, stock-recovery, wallet-reconciler
const { connectMongo, disconnectMongo } = require('../src/config/mongo');
const { connectPostgres, disconnectPostgres } = require('../src/config/knex');

const JOBS = {
  payouts: '../src/jobs/payouts.job',
  'auto-complete': '../src/jobs/autoComplete.job',
  'stock-recovery': '../src/jobs/stockRecovery.job',
  'wallet-reconciler': '../src/jobs/walletReconciler.job',
};

async function main() {
  const name = process.argv[2];
  if (!JOBS[name]) {
    console.error(`Usage: node scripts/run-job.js <${Object.keys(JOBS).join('|')}>`);
    process.exitCode = 1;
    return;
  }
  await connectMongo();
  await connectPostgres();
  try {
    const result = await require(JOBS[name]).runOnce();
    console.log(`${name}:`, JSON.stringify(result));
  } finally {
    await disconnectMongo();
    await disconnectPostgres();
  }
}

main().catch((err) => {
  console.error('Job failed:', err.message);
  process.exitCode = 1;
});
