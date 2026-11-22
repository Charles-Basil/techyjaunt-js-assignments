// Ledger audit: proves the books are consistent. Every check is one SQL
// aggregate (Postgres does the maths on BIGINT; no JS loops over rows).
// Used by scripts/audit-ledger.js and by tests.
//
// Reminder of the sign convention: balance = SUM(credits) - SUM(debits).

const MAX_LISTED = 50; // how many problem rows to show per failed check

// SQL pieces reused below
const DEBITS = "COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount_kobo END), 0)";
const CREDITS = "COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount_kobo END), 0)";

async function checkTransactionsBalanced(knex) {
  // a) every transaction: debits = credits (and it has at least 2 entries)
  const { rows } = await knex.raw(`
    SELECT t.id, t.reference, t.type,
           ${DEBITS} AS debits, ${CREDITS} AS credits, COUNT(le.id) AS entry_count
    FROM transactions t
    LEFT JOIN ledger_entries le ON le.transaction_id = t.id
    GROUP BY t.id
    HAVING ${DEBITS} <> ${CREDITS} OR COUNT(le.id) < 2
    LIMIT ${MAX_LISTED}
  `);
  return { name: 'Every transaction is balanced (debits = credits)', pass: rows.length === 0, problems: rows };
}

// Accounts whose cached balance_kobo differs from what their entries add up to.
// Also used by the admin reconciliation report. Should always be empty.
async function findAccountMismatches(knex, limit = MAX_LISTED) {
  const { rows } = await knex.raw(
    `
    SELECT a.id, a.owner_type, a.owner_id, a.code,
           a.balance_kobo AS stored_balance,
           ${CREDITS} - ${DEBITS} AS ledger_balance
    FROM accounts a
    LEFT JOIN ledger_entries le ON le.account_id = a.id
    GROUP BY a.id
    HAVING a.balance_kobo <> ${CREDITS} - ${DEBITS}
    ORDER BY a.id
    LIMIT ?
  `,
    [limit]
  );
  return rows;
}

async function checkAccountBalances(knex) {
  // b) every account: stored balance = credits - debits of its entries
  const rows = await findAccountMismatches(knex);
  return { name: 'Every account balance matches its ledger entries', pass: rows.length === 0, problems: rows };
}

async function checkSumIsZero(knex) {
  // c) double entry => all balances together are exactly zero
  const { rows } = await knex.raw('SELECT COALESCE(SUM(balance_kobo), 0) AS total FROM accounts');
  const total = BigInt(rows[0].total);
  return { name: 'Sum of all account balances is 0', pass: total === 0n, total: total.toString() };
}

async function checkMoneyIdentity(knex) {
  // d) money inside the platform = money that came in - money that went out
  const { rows } = await knex.raw(`
    SELECT
      (SELECT COALESCE(SUM(balance_kobo), 0) FROM accounts
        WHERE owner_type = 'USER'
           OR code IN ('PLATFORM_ESCROW', 'PLATFORM_REVENUE', 'PLATFORM_PAYOUT_CLEARING')) AS inside,
      (SELECT COALESCE(SUM(le.amount_kobo), 0) FROM ledger_entries le
         JOIN transactions t ON t.id = le.transaction_id
        WHERE t.type = 'WALLET_FUNDING' AND le.direction = 'CREDIT') AS funded,
      (SELECT COALESCE(SUM(le.amount_kobo), 0) FROM ledger_entries le
         JOIN transactions t ON t.id = le.transaction_id
        WHERE t.type = 'PAYOUT_SETTLED' AND le.direction = 'DEBIT') AS paid_out
  `);
  const inside = BigInt(rows[0].inside);
  const funded = BigInt(rows[0].funded);
  const paidOut = BigInt(rows[0].paid_out);
  return {
    name: 'Wallets + escrow + revenue + payout clearing = funded - paid out',
    pass: inside === funded - paidOut,
    inside: inside.toString(),
    funded: funded.toString(),
    paidOut: paidOut.toString(),
  };
}

async function runAudit(knex) {
  const checks = [
    await checkTransactionsBalanced(knex),
    await checkAccountBalances(knex),
    await checkSumIsZero(knex),
    await checkMoneyIdentity(knex),
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

module.exports = { runAudit, findAccountMismatches };
