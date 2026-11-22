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

function findById(id) {
  return knex('accounts').where({ id }).first();
}

// Freeze / unfreeze every Postgres account a user owns (inside the caller's transaction).
function setOwnerStatus(trx, userId, status) {
  return trx('accounts').where({ owner_type: 'USER', owner_id: String(userId) }).update({ status });
}

// For each transaction id: its entries on OTHER accounts (the "other side" of the money).
function findCounterEntries(transactionIds, excludeAccountId) {
  if (transactionIds.length === 0) return [];
  return knex('ledger_entries as le')
    .join('accounts as a', 'a.id', 'le.account_id')
    .whereIn('le.transaction_id', transactionIds)
    .whereNot('le.account_id', excludeAccountId)
    .orderBy('le.id')
    .select('le.transaction_id', 'le.account_id', 'a.code', 'a.owner_type', 'a.owner_id', 'le.direction', 'le.amount_kobo');
}

module.exports = { insertUserAccountIfMissing, findUserAccount, findById, setOwnerStatus, listEntries, findCounterEntries };
