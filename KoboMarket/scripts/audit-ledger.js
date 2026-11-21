// npm run audit:ledger
//   against the .env database (dev). For the test database:
//   $env:NODE_ENV='test'; npm run audit:ledger
// Exit code 0 = PASS, 1 = FAIL (so it can be used in CI).
const env = require('../src/config/env');
const { knex } = require('../src/config/knex');
const { runAudit } = require('../src/ledger/audit');

async function main() {
  console.log(`Ledger audit on database "${env.PG_DATABASE}"\n`);
  try {
    const { pass, checks } = await runAudit(knex);
    for (const check of checks) {
      const { name, pass: ok, ...details } = check;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      // Show the numbers / problem rows only when a check fails.
      if (!ok) console.log(JSON.stringify(details, null, 2));
    }
    console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error('Ledger audit could not run:', err.message);
    process.exitCode = 1;
  } finally {
    await knex.destroy();
  }
}

main();
