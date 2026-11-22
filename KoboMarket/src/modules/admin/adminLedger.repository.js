// Read-only admin views of the ledger.
const { knex } = require('../../config/knex');

// All transactions, newest first. `from`/`to` are calendar days in Africa/Lagos.
function listTransactions({ type, from, to, after, limit }) {
  return knex('transactions as t')
    .modify((q) => {
      if (type) q.where('t.type', type);
      if (from) q.whereRaw("t.created_at >= (?::date)::timestamp AT TIME ZONE 'Africa/Lagos'", [from]);
      if (to) q.whereRaw("t.created_at < (?::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'", [to]);
      if (after) q.whereRaw('(t.created_at, t.id) < (?::timestamptz, ?::uuid)', [after.sortValue, after.id]);
    })
    .orderBy([{ column: 't.created_at', order: 'desc' }, { column: 't.id', order: 'desc' }])
    .limit(limit)
    .select('t.*', knex.raw('t.created_at::text AS cursor_created_at'));
}

// Entries (with their account) for a page of transactions, in one query.
function findEntriesForTransactions(transactionIds) {
  if (transactionIds.length === 0) return [];
  return knex('ledger_entries as le')
    .join('accounts as a', 'a.id', 'le.account_id')
    .whereIn('le.transaction_id', transactionIds)
    .orderBy('le.id')
    .select('le.id', 'le.transaction_id', 'le.account_id', 'a.code', 'a.owner_type', 'a.owner_id', 'le.direction', 'le.amount_kobo');
}

module.exports = { listTransactions, findEntriesForTransactions };
