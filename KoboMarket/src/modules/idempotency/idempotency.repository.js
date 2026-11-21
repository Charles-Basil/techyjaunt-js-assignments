// idempotency_keys: remembers the response of a request sent with an
// Idempotency-Key header. (This is NOT the ledger, so updates/deletes are fine.)
const { knex } = require('../../config/knex');

// Returns the new row, or null if (user_id, endpoint, key) already existed.
// ON CONFLICT DO NOTHING makes "check + insert" one atomic step: if two identical
// requests arrive together, exactly one of them gets the row.
async function tryInsert({ userId, endpoint, key, requestHash }) {
  const rows = await knex('idempotency_keys')
    .insert({ user_id: userId, endpoint, key, request_hash: requestHash })
    .onConflict(['user_id', 'endpoint', 'key'])
    .ignore()
    .returning('*');
  return rows[0] || null;
}

function find({ userId, endpoint, key }) {
  return knex('idempotency_keys').where({ user_id: userId, endpoint, key }).first();
}

function saveResponse({ userId, endpoint, key }, status, body) {
  return knex('idempotency_keys')
    .where({ user_id: userId, endpoint, key })
    .update({ response_status: status, response_body: JSON.stringify(body) });
}

function remove({ userId, endpoint, key }) {
  return knex('idempotency_keys').where({ user_id: userId, endpoint, key }).del();
}

module.exports = { tryInsert, find, saveResponse, remove };
