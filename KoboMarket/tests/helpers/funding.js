// Helpers for funding/webhook tests: start a funding through the API, pretend
// the buyer paid on (mock) Paystack, and deliver signed webhooks to the app.
const crypto = require('crypto');
const request = require('supertest');
const { app } = require('./auth');
const MockPaystackTransaction = require('../../src/mock-paystack/MockPaystackTransaction');
const mockService = require('../../src/mock-paystack/mock.service');

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function newKey() {
  return `key_${crypto.randomUUID()}`;
}

function startFunding(accessToken, amountKobo, key = newKey()) {
  return request(app)
    .post('/api/v1/wallet/fund')
    .set(bearer(accessToken))
    .set('Idempotency-Key', key)
    .send({ amountKobo });
}

// What happens on Paystack's side when the buyer pays (or the card fails).
async function markMockPaid(reference, status = 'success') {
  await MockPaystackTransaction.updateOne(
    { reference },
    { $set: { status, paidAt: status === 'success' ? new Date() : null } }
  );
  return MockPaystackTransaction.findOne({ reference });
}

// The exact signed webhook the mock Paystack would send for this reference.
async function signedWebhookFor(reference) {
  const tx = await MockPaystackTransaction.findOne({ reference });
  return mockService.buildWebhook(tx);
}

// Sends raw bytes (not an object) so the body is byte-for-byte what was signed.
function postWebhook(rawBody, signature) {
  const req = request(app).post('/api/v1/webhooks/paystack').set('Content-Type', 'application/json');
  if (signature !== undefined) req.set('x-paystack-signature', signature);
  return req.send(rawBody);
}

module.exports = { bearer, newKey, startFunding, markMockPaid, signedWebhookFor, postWebhook };
