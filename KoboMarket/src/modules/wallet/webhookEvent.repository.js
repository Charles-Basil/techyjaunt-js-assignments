// webhook_events: an append-only log of EVERY webhook we receive, valid or not.
// Insert only (a database trigger rejects UPDATE and DELETE).
const { knex } = require('../../config/knex');

function record({ provider, event, reference, signatureValid, result, note = null, payload }) {
  return knex('webhook_events').insert({
    provider,
    event: typeof event === 'string' ? event : null,
    reference: typeof reference === 'string' ? reference : null,
    signature_valid: signatureValid,
    processing_result: result,
    processing_note: note,
    // Stored as JSON text; payload may be anything a caller sent (or nothing).
    payload: payload === undefined ? null : JSON.stringify(payload),
  });
}

module.exports = { record };
