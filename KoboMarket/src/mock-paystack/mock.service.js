// The fake Paystack "checkout page": marks a payment as paid or failed, then
// sends the webhook(s) exactly like Paystack would, including duplicates.
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const MockPaystackTransaction = require('./MockPaystackTransaction');

// Paystack's signature: HMAC-SHA512 of the raw JSON body, keyed with the secret key, as hex.
function sign(rawBody) {
  return crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
}

// Builds the exact bytes we will send, plus their signature.
function buildWebhook(tx) {
  const payload = {
    event: tx.status === 'success' ? 'charge.success' : 'charge.failed',
    data: {
      reference: tx.reference,
      amount: tx.amountKobo,
      currency: 'NGN',
      status: tx.status,
      paid_at: tx.paidAt ? tx.paidAt.toISOString() : null,
      customer: { email: tx.email },
    },
  };
  const rawBody = JSON.stringify(payload);
  return { rawBody, signature: sign(rawBody) };
}

// How a webhook is delivered. An object with a method so tests can replace it
// (jest.spyOn(webhookSender, 'send')) and deliver straight into the app.
const webhookSender = {
  async send(rawBody, signature) {
    const response = await fetch(env.WEBHOOK_TARGET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
      body: rawBody,
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  },
};

async function getCheckout(reference) {
  const tx = await MockPaystackTransaction.findOne({ reference }).lean();
  if (!tx) throw new AppError('MOCK_TRANSACTION_NOT_FOUND', 'Mock transaction not found', 404);
  return {
    reference: tx.reference,
    amountKobo: tx.amountKobo,
    email: tx.email,
    status: tx.status,
    howToPay: `POST /mock-paystack/checkout/${tx.reference}/pay with { "outcome": "success", "duplicates": 2 }`,
  };
}

async function pay(reference, { outcome, duplicates }) {
  const tx = await MockPaystackTransaction.findOne({ reference });
  if (!tx) throw new AppError('MOCK_TRANSACTION_NOT_FOUND', 'Mock transaction not found', 404);

  // A real payment can't change its outcome later. Re-sending the SAME outcome
  // is allowed: that's how you replay duplicate webhooks.
  if (tx.status !== 'pending' && tx.status !== outcome) {
    throw new AppError('MOCK_ALREADY_PAID', `This payment is already ${tx.status}`, 409);
  }
  if (tx.status === 'pending') {
    tx.status = outcome;
    tx.paidAt = outcome === 'success' ? new Date() : null;
    await tx.save();
  }

  const { rawBody, signature } = buildWebhook(tx);
  const deliveries = [];
  for (let attempt = 1; attempt <= duplicates; attempt += 1) {
    try {
      deliveries.push({ attempt, ...(await webhookSender.send(rawBody, signature)) });
    } catch (err) {
      deliveries.push({ attempt, status: null, error: err.message });
    }
  }
  return { reference, outcome, deliveries };
}

module.exports = { sign, buildWebhook, webhookSender, getCheckout, pay };
