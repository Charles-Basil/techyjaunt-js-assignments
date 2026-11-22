// PostgreSQL access for payouts. (A payout row tracks the bank transfer; the
// money itself moves in ledger_entries.)
const { knex } = require('../../config/knex');

async function insert(trx, { vendorId, accountId, amountKobo, bankSnapshot, idempotencyKey }) {
  const [payout] = await trx('payouts')
    .insert({
      vendor_id: String(vendorId),
      account_id: accountId,
      amount_kobo: amountKobo.toString(),
      status: 'PENDING',
      bank_snapshot: JSON.stringify(bankSnapshot),
      idempotency_key: idempotencyKey,
    })
    .returning('*');
  return payout;
}

function findById(id, db = knex) {
  return db('payouts').where({ id }).first();
}

function findByIdempotencyKey(idempotencyKey) {
  return knex('payouts').where({ idempotency_key: idempotencyKey }).first();
}

function lockById(trx, id) {
  return trx('payouts').where({ id }).forUpdate().first();
}

function listForVendor(vendorId, { status, after, limit }) {
  return knex('payouts as p')
    .where('p.vendor_id', String(vendorId))
    .modify((q) => {
      if (status) q.where('p.status', status);
      if (after) q.whereRaw('(p.created_at, p.id) < (?::timestamptz, ?::uuid)', [after.sortValue, after.id]);
    })
    .orderBy([{ column: 'p.created_at', order: 'desc' }, { column: 'p.id', order: 'desc' }])
    .limit(limit)
    .select('p.*', knex.raw('p.created_at::text AS cursor_created_at'));
}

// ---------- job ----------

// Claims up to `limit` PENDING payouts in ONE atomic statement. FOR UPDATE SKIP
// LOCKED means two job runs (or two servers) never claim the same payout: rows
// another worker has locked are simply skipped.
async function claimPending(limit) {
  const { rows } = await knex.raw(
    `UPDATE payouts
        SET status = 'PROCESSING', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM payouts
         WHERE status = 'PENDING'
         ORDER BY created_at
         LIMIT ?
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [limit]
  );
  return rows;
}

// The provider call failed with an unknown outcome: put it back in the queue.
function releaseClaim(id, lastError) {
  return knex('payouts')
    .where({ id, status: 'PROCESSING' })
    .update({ status: 'PENDING', last_error: lastError, updated_at: knex.fn.now() });
}

function setProviderReference(id, providerReference) {
  return knex('payouts')
    .where({ id, status: 'PROCESSING' })
    .update({ provider_reference: providerReference, updated_at: knex.fn.now() });
}

// PROCESSING for a long time = the job probably crashed mid-run.
function findStuckProcessingIds({ olderThanMinutes, limit }) {
  return knex('payouts')
    .where({ status: 'PROCESSING' })
    .whereRaw('updated_at < now() - make_interval(mins => ?)', [olderThanMinutes])
    .orderBy('updated_at')
    .limit(limit)
    .pluck('id');
}

function markSuccess(trx, id, providerReference) {
  return trx('payouts').where({ id }).update({
    status: 'SUCCESS',
    provider_reference: providerReference,
    processed_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
}

function markFailed(trx, id, reason) {
  return trx('payouts').where({ id }).update({
    status: 'FAILED',
    failure_reason: reason,
    processed_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
}

module.exports = {
  insert,
  findById,
  findByIdempotencyKey,
  lockById,
  listForVendor,
  claimPending,
  releaseClaim,
  setProviderReference,
  findStuckProcessingIds,
  markSuccess,
  markFailed,
};
