// PostgreSQL access for the accounts table.
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

module.exports = { insertUserAccountIfMissing, findUserAccount };
