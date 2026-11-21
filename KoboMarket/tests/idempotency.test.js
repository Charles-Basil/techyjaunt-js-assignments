const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { bearer, newKey, startFunding } = require('./helpers/funding');
const paystackClient = require('../src/integrations/paystack/paystack.client');

const { knex } = db;

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => jest.restoreAllMocks());
afterAll(db.close);

async function fundingCount() {
  const [{ count }] = await knex('wallet_fundings').count();
  return Number(count);
}

describe('Idempotency-Key on POST /wallet/fund', () => {
  let buyer;
  beforeEach(async () => {
    buyer = await registerAndLogin();
  });

  test('same key + same body returns the same response and creates one funding', async () => {
    const key = newKey();
    const first = await startFunding(buyer.accessToken, 50000, key);
    const second = await startFunding(buyer.accessToken, 50000, key);

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await fundingCount()).toBe(1);
  });

  test('same key + different body is 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = newKey();
    await startFunding(buyer.accessToken, 50000, key).expect(201);
    const res = await startFunding(buyer.accessToken, 60000, key);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await fundingCount()).toBe(1);
  });

  test('a missing key is 400 IDEMPOTENCY_KEY_REQUIRED; a malformed key is 400', async () => {
    const missing = await request(app).post('/api/v1/wallet/fund').set(bearer(buyer.accessToken)).send({ amountKobo: 50000 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const bad = await startFunding(buyer.accessToken, 50000, 'short');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(await fundingCount()).toBe(0);
  });

  test('4xx answers are stored too: the same invalid request gets the same 400, replayed', async () => {
    const key = newKey();
    const first = await startFunding(buyer.accessToken, 50, key); // below the NGN 100 minimum
    const second = await startFunding(buyer.accessToken, 50, key);
    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
  });

  test('keys are per user: another user can use the same key', async () => {
    const key = newKey();
    const other = await registerAndLogin();
    await startFunding(buyer.accessToken, 50000, key).expect(201);
    const res = await startFunding(other.accessToken, 50000, key);
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await fundingCount()).toBe(2);
  });

  test('a 5xx is NOT stored, so retrying with the same key runs the request again', async () => {
    const key = newKey();
    jest.spyOn(paystackClient, 'initializeTransaction').mockRejectedValueOnce(new Error('provider down'));

    const failed = await startFunding(buyer.accessToken, 50000, key);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    // The failed attempt is closed, not left PENDING.
    expect((await knex('wallet_fundings').first()).status).toBe('FAILED');

    const retry = await startFunding(buyer.accessToken, 50000, key);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  test('a frozen user cannot fund', async () => {
    const { User } = require('../src/modules/users/user.model');
    await User.updateOne({ _id: buyer.user.id }, { status: 'FROZEN' });
    const res = await startFunding(buyer.accessToken, 50000);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('amount limits: NGN 100 to NGN 1,000,000, whole kobo only', async () => {
    await startFunding(buyer.accessToken, 9999).expect(400);
    await startFunding(buyer.accessToken, 100000001).expect(400);
    await startFunding(buyer.accessToken, 10000.5).expect(400);
    await startFunding(buyer.accessToken, 10000).expect(201);
    await startFunding(buyer.accessToken, 100000000).expect(201);
  });
});
