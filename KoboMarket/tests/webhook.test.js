const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { getBalance, getSystemBalance } = require('./helpers/wallet');
const { bearer, startFunding, markMockPaid, signedWebhookFor, postWebhook } = require('./helpers/funding');
const paystackClient = require('../src/integrations/paystack/paystack.client');
const mockService = require('../src/mock-paystack/mock.service');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;
const AMOUNT = 250000; // NGN 2,500

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => jest.restoreAllMocks());
// The spec: after all the funding tests, the books must still balance.
afterAll(async () => {
  const audit = await runAudit(knex);
  expect(audit.pass).toBe(true);
  await db.close();
});

async function fundingRow(reference) {
  return knex('wallet_fundings').where({ reference }).first();
}

async function webhookResults(reference) {
  const rows = await knex('webhook_events').where({ reference }).orderBy('received_at');
  return rows.map((r) => r.processing_result);
}

describe('Paystack webhook', () => {
  let buyer;
  let reference;

  beforeEach(async () => {
    buyer = await registerAndLogin();
    const res = await startFunding(buyer.accessToken, AMOUNT).expect(201);
    reference = res.body.data.reference;
  });

  test('POST /wallet/fund creates a PENDING funding and a mock checkout', async () => {
    const funding = await fundingRow(reference);
    expect(funding).toMatchObject({ status: 'PENDING', amount_kobo: String(AMOUNT), user_id: buyer.user.id });
    expect(reference).toMatch(/^FUND_[0-9a-f-]{36}$/);
    const checkout = await request(app).get(`/mock-paystack/checkout/${reference}`).expect(200);
    expect(checkout.body.data).toMatchObject({ amountKobo: AMOUNT, status: 'pending' });
  });

  test('the same charge.success sent twice credits the wallet exactly once', async () => {
    await markMockPaid(reference);
    const { rawBody, signature } = await signedWebhookFor(reference);

    const first = await postWebhook(rawBody, signature);
    const second = await postWebhook(rawBody, signature);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true });
    expect(second.status).toBe(200);

    expect(await getBalance(buyer.user.id)).toBe(AMOUNT);
    expect(await getSystemBalance('PLATFORM_EXTERNAL_SETTLEMENT')).toBe(-AMOUNT);
    const funding = await fundingRow(reference);
    expect(funding.status).toBe('SUCCESS');
    expect(funding.transaction_id).not.toBeNull();
    expect(await webhookResults(reference)).toEqual(['CREDITED', 'ALREADY_PROCESSED']);
  });

  test('two identical webhooks at the same time still credit exactly once', async () => {
    await markMockPaid(reference);
    const { rawBody, signature } = await signedWebhookFor(reference);

    const responses = await Promise.all([postWebhook(rawBody, signature), postWebhook(rawBody, signature)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);

    expect(await getBalance(buyer.user.id)).toBe(AMOUNT);
    const [{ count }] = await knex('transactions').where({ type: 'WALLET_FUNDING' }).count();
    expect(Number(count)).toBe(1);
    expect((await webhookResults(reference)).sort()).toEqual(['ALREADY_PROCESSED', 'CREDITED']);
  });

  test('an invalid signature returns 401 and credits nothing', async () => {
    await markMockPaid(reference);
    const { rawBody } = await signedWebhookFor(reference);
    const forged = mockService.sign(rawBody).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));

    const res = await postWebhook(rawBody, forged);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await getBalance(buyer.user.id)).toBe(0);
    expect((await fundingRow(reference)).status).toBe('PENDING');

    const event = await knex('webhook_events').where({ reference }).first();
    expect(event).toMatchObject({ signature_valid: false, processing_result: 'INVALID_SIGNATURE' });
  });

  test('a body changed after signing is rejected (signature covers the raw bytes)', async () => {
    await markMockPaid(reference);
    const { rawBody, signature } = await signedWebhookFor(reference);
    const tampered = rawBody.replace(`"amount":${AMOUNT}`, `"amount":${AMOUNT * 100}`);
    await postWebhook(tampered, signature).expect(401);
    expect(await getBalance(buyer.user.id)).toBe(0);
  });

  test('a missing signature returns 401', async () => {
    await markMockPaid(reference);
    const { rawBody } = await signedWebhookFor(reference);
    const res = await postWebhook(rawBody, undefined);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await getBalance(buyer.user.id)).toBe(0);
  });

  test('an amount mismatch from verify does not credit (and does not mark FAILED)', async () => {
    await markMockPaid(reference);
    const { rawBody, signature } = await signedWebhookFor(reference);
    jest.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      status: true,
      data: { reference, amount: AMOUNT - 1, currency: 'NGN', status: 'success', paid_at: new Date().toISOString() },
    });

    await postWebhook(rawBody, signature).expect(200);
    expect(await getBalance(buyer.user.id)).toBe(0);
    expect((await fundingRow(reference)).status).toBe('PENDING');
    const event = await knex('webhook_events').where({ reference }).first();
    expect(event.processing_result).toBe('VERIFY_FAILED');
    expect(event.processing_note).toMatch(/Amount mismatch/);
  });

  test('a webhook claiming success is not trusted if the provider says the payment is still pending', async () => {
    // The mock transaction is still "pending": nobody actually paid.
    const tx = await markMockPaid(reference, 'pending');
    const { rawBody, signature } = mockService.buildWebhook({ ...tx.toObject(), status: 'success' });
    await postWebhook(rawBody, signature).expect(200);
    expect(await getBalance(buyer.user.id)).toBe(0);
    expect((await fundingRow(reference)).status).toBe('PENDING');
  });

  test('when the provider says the payment failed, the funding becomes FAILED', async () => {
    await markMockPaid(reference, 'failed');
    const { rawBody, signature } = await signedWebhookFor(reference); // charge.failed
    await postWebhook(rawBody, signature).expect(200);
    const funding = await fundingRow(reference);
    expect(funding.status).toBe('FAILED');
    expect(await getBalance(buyer.user.id)).toBe(0);
  });

  test('if the provider cannot be reached, respond 500 so Paystack retries later', async () => {
    await markMockPaid(reference);
    const { rawBody, signature } = await signedWebhookFor(reference);
    jest.spyOn(paystackClient, 'verifyTransaction').mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await postWebhook(rawBody, signature).expect(500);
    expect(await getBalance(buyer.user.id)).toBe(0);

    // Paystack's retry arrives once the provider is reachable again:
    await postWebhook(rawBody, signature).expect(200);
    expect(await getBalance(buyer.user.id)).toBe(AMOUNT);
  });

  test('unknown references and unhandled events are recorded and answered 200', async () => {
    const unknown = JSON.stringify({ event: 'charge.success', data: { reference: 'FUND_does-not-exist', amount: 1 } });
    await postWebhook(unknown, mockService.sign(unknown)).expect(200);

    const other = JSON.stringify({ event: 'transfer.success', data: { reference } });
    await postWebhook(other, mockService.sign(other)).expect(200);

    const results = await knex('webhook_events').select('reference', 'processing_result').orderBy('received_at');
    expect(results).toEqual([
      { reference: 'FUND_does-not-exist', processing_result: 'UNKNOWN_REFERENCE' },
      { reference, processing_result: 'IGNORED' },
    ]);
    expect(await getBalance(buyer.user.id)).toBe(0);
  });
});

describe('full mock flow', () => {
  test('fund -> pay on mock Paystack with 3 duplicate webhooks -> credited once', async () => {
    const buyer = await registerAndLogin();
    // Deliver the mock's webhooks straight into the app (no real HTTP server in tests).
    jest.spyOn(mockService.webhookSender, 'send').mockImplementation(async (rawBody, signature) => {
      const res = await postWebhook(rawBody, signature);
      return { status: res.status, body: res.body };
    });

    const started = await startFunding(buyer.accessToken, AMOUNT).expect(201);
    const { reference, authorizationUrl } = started.body.data;
    expect(authorizationUrl).toMatch(new RegExp(`/mock-paystack/checkout/${reference}$`));

    const paid = await request(app)
      .post(`/mock-paystack/checkout/${reference}/pay`)
      .send({ outcome: 'success', duplicates: 3 })
      .expect(200);
    expect(paid.body.data.deliveries.map((d) => d.status)).toEqual([200, 200, 200]);

    const wallet = await request(app).get('/api/v1/wallet').set(bearer(buyer.accessToken)).expect(200);
    expect(wallet.body.data).toMatchObject({ balanceKobo: AMOUNT, currency: 'NGN', status: 'ACTIVE' });

    const funding = await request(app)
      .get(`/api/v1/wallet/fundings/${reference}`)
      .set(bearer(buyer.accessToken))
      .expect(200);
    expect(funding.body.data).toMatchObject({ status: 'SUCCESS', amountKobo: AMOUNT });

    const history = await request(app).get('/api/v1/wallet/transactions').set(bearer(buyer.accessToken)).expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({
      reference: `WALLET_FUNDING:${reference}`,
      type: 'WALLET_FUNDING',
      direction: 'CREDIT',
      amountKobo: AMOUNT,
    });

    // Another user can't see this funding.
    const stranger = await registerAndLogin();
    await request(app).get(`/api/v1/wallet/fundings/${reference}`).set(bearer(stranger.accessToken)).expect(404);
  });
});
