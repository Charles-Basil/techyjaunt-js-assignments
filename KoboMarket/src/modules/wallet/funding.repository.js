// PostgreSQL access for wallet_fundings (one row per "add money" attempt).
// `db` is either the global knex or a transaction (trx), so these functions can
// take part in a caller's transaction.
const { knex } = require('../../config/knex');

function create({ userId, accountId, reference, amountKobo }) {
  return knex('wallet_fundings')
    .insert({
      user_id: String(userId),
      account_id: accountId,
      reference,
      amount_kobo: amountKobo.toString(), // BigInt -> exact string
      status: 'PENDING',
    })
    .returning('*')
    .then((rows) => rows[0]);
}

function findByReference(reference, db = knex) {
  return db('wallet_fundings').where({ reference }).first();
}

// Locks the row until the transaction ends: a second webhook for the same
// reference waits here until the first one has committed.
function findByReferenceForUpdate(trx, reference) {
  return trx('wallet_fundings').where({ reference }).forUpdate().first();
}

// The owner filter makes another user's reference look like "not found".
function findForUser(userId, reference) {
  return knex('wallet_fundings').where({ reference, user_id: String(userId) }).first();
}

function markSuccess(trx, id, { transactionId, paidAt }) {
  return trx('wallet_fundings')
    .where({ id })
    .update({ status: 'SUCCESS', transaction_id: transactionId, paid_at: paidAt, updated_at: trx.fn.now() });
}

// Only a PENDING funding can become FAILED (a SUCCESS is never overwritten).
function markFailedIfPending(reference, reason, db = knex) {
  return db('wallet_fundings')
    .where({ reference, status: 'PENDING' })
    .update({ status: 'FAILED', failure_reason: reason, updated_at: db.fn.now() });
}

module.exports = { create, findByReference, findByReferenceForUpdate, findForUser, markSuccess, markFailedIfPending };
