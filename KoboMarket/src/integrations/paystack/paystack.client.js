// One interface, two implementations, picked by PAYSTACK_MODE:
//   mock (default) -> src/mock-paystack (no network, for dev and tests)
//   live           -> real https://api.paystack.co (use a TEST secret key)
//
// initializeTransaction({ email, amountKobo: bigint, reference, callbackUrl })
//   -> { authorizationUrl, accessCode, reference }
// verifyTransaction(reference)
//   -> Paystack's own shape: { status: true, data: { reference, amount, currency, status, paid_at } }
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
};

const provider = env.PAYSTACK_MODE === 'live' ? liveProvider : mockProvider;

// Exported as an object with methods (not destructured) so tests can
// jest.spyOn(paystackClient, 'verifyTransaction').
module.exports = {
  initializeTransaction: (args) => provider.initializeTransaction(args),
  verifyTransaction: (reference) => provider.verifyTransaction(reference),
};
