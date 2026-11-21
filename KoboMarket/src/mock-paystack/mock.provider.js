// The fake Paystack API used when PAYSTACK_MODE=mock. Same inputs and outputs
// as the real one, but data lives in our MongoDB.
const env = require('../config/env');
const { toKoboNumber } = require('../utils/money');
const MockPaystackTransaction = require('./MockPaystackTransaction');

async function initializeTransaction({ email, amountKobo, reference }) {
  // upsert + $setOnInsert: calling twice for one reference changes nothing.
  await MockPaystackTransaction.updateOne(
    { reference },
    { $setOnInsert: { reference, amountKobo: toKoboNumber(amountKobo), email, status: 'pending' } },
    { upsert: true }
  );
  return {
    authorizationUrl: `${env.APP_BASE_URL}/mock-paystack/checkout/${reference}`,
    accessCode: `mock_access_${reference}`,
    reference,
  };
}

// Same shape as GET https://api.paystack.co/transaction/verify/:reference
async function verifyTransaction(reference) {
  const tx = await MockPaystackTransaction.findOne({ reference }).lean();
  if (!tx) return { status: false, message: 'Transaction reference not found', data: null };
  return {
    status: true,
    message: 'Verification successful',
    data: {
      reference: tx.reference,
      amount: tx.amountKobo,
      currency: 'NGN',
      status: tx.status,
      paid_at: tx.paidAt ? tx.paidAt.toISOString() : null,
    },
  };
}

module.exports = { initializeTransaction, verifyTransaction };
