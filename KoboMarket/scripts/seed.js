// npm run seed               -> seed the .env databases (does nothing if already seeded)
// npm run seed -- --reset    -> wipe dev data first, then seed (clean demo)
// Inside Docker:  docker compose exec api npm run seed -- --reset
const env = require('../src/config/env');
const { connectMongo, disconnectMongo } = require('../src/config/mongo');
const { connectPostgres, disconnectPostgres } = require('../src/config/knex');
const { runSeed, PASSWORD } = require('../src/seed/seed');

async function main() {
  if (env.isProduction) {
    console.error('Refusing to seed: NODE_ENV is production.');
    process.exitCode = 1;
    return;
  }
  const reset = process.argv.includes('--reset');

  await connectMongo();
  await connectPostgres();
  try {
    console.log(`Seeding "${env.PG_DATABASE}"${reset ? ' (with --reset)' : ''}...`);
    const result = await runSeed({ reset, log: (message) => console.log(`  ${message}`) });

    if (result.alreadySeeded) {
      console.log('Already seeded (admin@kobomarket.test exists). Use `npm run seed -- --reset` for a clean demo.');
      return;
    }

    // Kobo -> naira with BigInt (no float maths on money, even for display).
    const naira = (kobo) => `${(BigInt(kobo) / 100n).toLocaleString('en-NG')}.${(BigInt(kobo) % 100n).toString().padStart(2, '0')}`;
    console.table(result.accounts.map((a) => ({ email: a.email, roles: a.roles, 'balance (NGN)': naira(a.balanceKobo) })));
    console.log(`Created: ${JSON.stringify(result.counts)}`);
    console.log(`Password for every account: ${PASSWORD}`);
    console.log(`Ledger audit: ${result.auditPass ? 'PASS' : 'FAIL'}`);
    if (!result.auditPass) process.exitCode = 1;
  } finally {
    await disconnectMongo();
    await disconnectPostgres();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exitCode = 1;
});
