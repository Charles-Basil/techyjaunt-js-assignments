// PostgreSQL READS for wallet accounts and their history.
// (Writes to balances only ever happen in src/ledger/ledger.service.js.)
const { knex } = require('../../config/knex');

// Idempotent: if the wallet already exists, the unique constraint
// (owner_type, owner_id, currency) makes Postgres skip the insert silently.
// Calling this 1 time or 100 times ends with exactly one row.
function insertUserAccountIfMissing(userId, currency = 'NGN') {
  return knex('accounts')
    .insert({ owner_type: 'USER', owner_id: userId, currency })
    .onConflict(['owner_type', 'owner_id', 'currency'])
    .ignore();
}

function findUserAccount(userId, currency = 'NGN') {
  return knex('accounts')
    .where({ owner_type: 'USER', owner_id: userId, currency })
    .first();
}

// One page of an account's ledger entries, newest first.
// `after` = { sortValue: created_at as text, id: entry id } from the cursor.
// The row comparison (created_at, id) < (x, y) means "older than the last item,
// or the same time but a smaller id": the same keyset idea as the product list.
function listEntries(accountId, { after, limit }) {
  return knex('ledger_entries as le')
    .join('transactions as t', 't.id', 'le.transaction_id')
    .where('le.account_id', accountId)
    .modify((query) => {
      if (after) {
        query.whereRaw('(le.created_at, le.id) < (?::timestamptz, ?::uuid)', [after.sortValue, after.id]);
      }
    })
    .orderBy([
      { column: 'le.created_at', order: 'desc' },
      { column: 'le.id', order: 'desc' },
    ])
    .limit(limit)
    .select(
      'le.id',
      'le.direction',
      'le.amount_kobo',
      'le.created_at',
      knex.raw('le.created_at::text AS cursor_created_at'), // full microsecond precision
      't.id as transaction_id',
      't.reference',
      't.type',
      't.metadata'
    );
}

module.exports = { insertUserAccountIfMissing, findUserAccount, listEntries };
