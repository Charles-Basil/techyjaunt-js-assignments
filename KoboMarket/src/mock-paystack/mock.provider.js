// The fake Paystack API used when PAYSTACK_MODE=mock. Same inputs and outputs
// as the real one, but data lives in our MongoDB.
const env = require('../config/env');
const { toKoboNumber } = require('../utils/money');
const MockPaystackTransaction = require('./MockPaystackTransaction');
const MockPaystackTransfer = require('./MockPaystackTransfer');

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

// ---------- transfers (vendor payouts) ----------
// Returns a FINAL result immediately (a real transfer can stay "pending" for a while):
//   'failed'  if the account number ends in 0000 (a handy test account) or
//             MOCK_TRANSFER_OUTCOME=failed
//   'success' otherwise
// Same reference twice = the same transfer (like Paystack: references are unique).

function transferResult(t) {
  return { status: t.status, providerReference: t.transferCode, amountKobo: t.amountKobo, reason: t.reason };
}

async function initiateTransfer({ reference, amountKobo, bank }) {
  const existing = await MockPaystackTransfer.findOne({ reference }).lean();
  if (existing) return transferResult(existing);

  const failed = env.MOCK_TRANSFER_OUTCOME === 'failed' || String(bank.accountNumber).endsWith('0000');
  const transfer = await MockPaystackTransfer.create({
    reference,
    transferCode: `TRF_mock_${reference.replace(/-/g, '').slice(0, 16)}`,
    amountKobo: toKoboNumber(amountKobo),
    bankCode: bank.bankCode,
    accountNumberLast4: String(bank.accountNumber).slice(-4),
    status: failed ? 'failed' : 'success',
    reason: failed ? 'Mock: the destination account could not be credited' : null,
  });
  return transferResult(transfer);
}

async function verifyTransfer(reference) {
  const transfer = await MockPaystackTransfer.findOne({ reference }).lean();
  if (!transfer) return { status: 'not_found', providerReference: null, amountKobo: null, reason: null };
  return transferResult(transfer);
}

module.exports = { initializeTransaction, verifyTransaction, initiateTransfer, verifyTransfer };
