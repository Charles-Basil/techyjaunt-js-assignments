// One interface, two implementations, picked by PAYSTACK_MODE:
//   mock (default) -> src/mock-paystack (no network, for dev and tests)
//   live           -> real https://api.paystack.co (use a TEST secret key)
//
// initializeTransaction({ email, amountKobo: bigint, reference, callbackUrl })
//   -> { authorizationUrl, accessCode, reference }
// verifyTransaction(reference)
//   -> Paystack's own shape: { status: true, data: { reference, amount, currency, status, paid_at } }
//
// Transfers (vendor payouts) use OUR normalised shape, the same for mock and live:
// initiateTransfer({ reference, amountKobo: bigint, bank: { bankCode, accountNumber, accountName } })
// verifyTransfer(reference)
//   -> { status: 'success' | 'failed' | 'pending' | 'not_found', providerReference, amountKobo, reason }
//   'pending' = still in progress (e.g. Paystack's "otp"); settled later by verify or a webhook.
//   Throws only when the outcome is UNKNOWN (network error, Paystack 5xx).
const env = require('../../config/env');
const { toKoboNumber } = require('../../utils/money');
const mockProvider = require('../../mock-paystack/mock.provider');

const TIMEOUT_MS = 10000; // never hang a request on a slow provider

async function callPaystack(path, options = {}) {
  const response = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 5xx = Paystack itself is having trouble: throw so the caller can retry.
  if (response.status >= 500) throw new Error(`Paystack responded ${response.status}`);
  return response.json();
}

const liveProvider = {
  async initializeTransaction({ email, amountKobo, reference, callbackUrl }) {
    const body = await callPaystack('/transaction/initialize', {
      method: 'POST',
      // Paystack's "amount" is in kobo already.
      body: JSON.stringify({ email, amount: toKoboNumber(amountKobo), reference, callback_url: callbackUrl }),
    });
    if (!body.status) throw new Error(body.message || 'Paystack could not initialize the transaction');
    return {
      authorizationUrl: body.data.authorization_url,
      accessCode: body.data.access_code,
      reference: body.data.reference,
    };
  },

  async verifyTransaction(reference) {
    // A 4xx (e.g. unknown reference) comes back as { status: false, ... }.
    return callPaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  },

  // Paystack needs a "transfer recipient" (the bank account) before a transfer.
  async initiateTransfer({ reference, amountKobo, bank }) {
    const recipient = await callPaystack('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name: bank.accountName,
        account_number: bank.accountNumber,
        bank_code: bank.bankCode,
        currency: 'NGN',
      }),
    });
    if (!recipient.status) {
      // Paystack rejected the bank details: a definite failure, not an unknown one.
      return { status: 'failed', providerReference: null, amountKobo: null, reason: recipient.message || 'Invalid bank details' };
    }
    const body = await callPaystack('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: toKoboNumber(amountKobo),
        recipient: recipient.data.recipient_code,
        reference, // our payout id: Paystack refuses a second transfer with the same reference
        reason: 'KoboMarket vendor payout',
      }),
    });
    if (!body.status) return { status: 'failed', providerReference: null, amountKobo: null, reason: body.message };
    return normaliseTransfer(body.data);
  },

  async verifyTransfer(reference) {
    const body = await callPaystack(`/transfer/verify/${encodeURIComponent(reference)}`);
    if (!body.status) return { status: 'not_found', providerReference: null, amountKobo: null, reason: body.message };
    return normaliseTransfer(body.data);
  },
};

// Paystack transfer statuses -> ours.
function normaliseTransfer(data) {
  let status = 'pending'; // 'pending', 'otp', 'received', 'queued' ... : not final yet
  if (data.status === 'success') status = 'success';
  if (data.status === 'failed' || data.status === 'reversed') status = 'failed';
  return {
    status,
    providerReference: data.transfer_code || null,
    amountKobo: Number.isSafeInteger(data.amount) ? data.amount : null,
    reason: status === 'failed' ? data.reason || `Transfer ${data.status}` : null,
  };
}

const provider = env.PAYSTACK_MODE === 'live' ? liveProvider : mockProvider;

// Exported as an object with methods (not destructured) so tests can
// jest.spyOn(paystackClient, 'verifyTransaction').
module.exports = {
  initializeTransaction: (args) => provider.initializeTransaction(args),
  verifyTransaction: (reference) => provider.verifyTransaction(reference),
  initiateTransfer: (args) => provider.initiateTransfer(args),
  verifyTransfer: (reference) => provider.verifyTransfer(reference),
};
