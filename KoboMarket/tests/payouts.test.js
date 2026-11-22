const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { bearer, newKey, postWebhook } = require('./helpers/funding');
const { fundWallet, getBalance, getSystemBalance } = require('./helpers/wallet');
const { createAdmin, createApprovedVendor } = require('./helpers/marketplace');
const payoutsJob = require('../src/jobs/payouts.job');
const paystackClient = require('../src/integrations/paystack/paystack.client');
const mockService = require('../src/mock-paystack/mock.service');
const MockPaystackTransfer = require('../src/mock-paystack/MockPaystackTransfer');
const { User } = require('../src/modules/users/user.model');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;
const BALANCE = 1000000; // NGN 10,000

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

function requestPayout(user, amountKobo, key = newKey()) {
  return request(app).post('/api/v1/payouts').set(bearer(user.accessToken)).set('Idempotency-Key', key).send({ amountKobo });
}

async function fundedVendor(options = {}) {
  const admin = await createAdmin();
  const vendor = await createApprovedVendor(admin, options);
  await fundWallet(vendor.user.id, BALANCE); // stands in for earnings from sales
  return { admin, vendor };
}

const payoutRow = (id) => knex('payouts').where({ id }).first();

describe('requesting a payout', () => {
  test('201: money moves wallet -> payout clearing at once; bank details are masked', async () => {
    const { vendor } = await fundedVendor();
    const res = await requestPayout(vendor, 300000);
    expect(res.status).toBe(201);
    expect(res.body.data.payout).toMatchObject({ status: 'PENDING', amountKobo: 300000, attempts: 0 });
    expect(res.body.data.payout.bankSnapshot).toEqual({
      bankName: 'Test Bank',
      bankCode: '058',
      accountName: 'Ada Obi',
      accountNumber: '******6789',
    });
    expect(await getBalance(vendor.user.id)).toBe(BALANCE - 300000);
    expect(await getSystemBalance('PLATFORM_PAYOUT_CLEARING')).toBe(300000);
  });

  test('below the minimum -> 400; more than the balance -> 402', async () => {
    const { vendor } = await fundedVendor();
    await requestPayout(vendor, 99999).expect(400);
    const tooMuch = await requestPayout(vendor, BALANCE + 1);
    expect(tooMuch.status).toBe(402);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await getBalance(vendor.user.id)).toBe(BALANCE);
  });

  test('a second request while one is PENDING -> 409 PAYOUT_ALREADY_PENDING', async () => {
    const { vendor } = await fundedVendor();
    await requestPayout(vendor, 100000).expect(201);
    const second = await requestPayout(vendor, 100000);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PAYOUT_ALREADY_PENDING');
    expect(await getBalance(vendor.user.id)).toBe(BALANCE - 100000);
  });

  test('not an approved vendor -> 403; frozen vendor -> 403; buyer -> 403', async () => {
    const notApproved = await registerAndLogin();
    await User.updateOne({ _id: notApproved.user.id }, { $addToSet: { roles: 'VENDOR' } }); // role but no approved profile
    const res = await requestPayout(notApproved, 100000);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VENDOR_NOT_APPROVED');

    const { vendor } = await fundedVendor();
    await User.updateOne({ _id: vendor.user.id }, { status: 'FROZEN' });
    const frozen = await requestPayout(vendor, 100000);
    expect(frozen.status).toBe(403);
    expect(frozen.body.error.code).toBe('ACCOUNT_FROZEN');

    const buyer = await registerAndLogin();
    expect((await requestPayout(buyer, 100000)).body.error.code).toBe('FORBIDDEN');
  });

  test('the same Idempotency-Key twice -> one payout', async () => {
    const { vendor } = await fundedVendor();
    const key = newKey();
    const first = await requestPayout(vendor, 200000, key).expect(201);
    const second = await requestPayout(vendor, 200000, key).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.payout.id).toBe(first.body.data.payout.id);
    const [{ count }] = await knex('payouts').count();
    expect(Number(count)).toBe(1);
  });

  test('two requests at the same moment that together exceed the balance: exactly one 201', async () => {
    const { vendor } = await fundedVendor();
    const [a, b] = await Promise.all([requestPayout(vendor, 600000), requestPayout(vendor, 600000)]);
    const statuses = [a.status, b.status];
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 402 || s === 409)).toHaveLength(1);
    expect(await getBalance(vendor.user.id)).toBe(BALANCE - 600000); // never negative
    const [{ count }] = await knex('payouts').count();
    expect(Number(count)).toBe(1);
  });
});

describe('payout job', () => {
  test('success: payout SUCCESS, clearing back to 0, external credited, audit counts it as paid out', async () => {
    const { vendor } = await fundedVendor();
    const { payout } = (await requestPayout(vendor, 400000).expect(201)).body.data;
    const externalBefore = await getSystemBalance('PLATFORM_EXTERNAL_SETTLEMENT');

    expect(await payoutsJob.runOnce()).toEqual({ settled: 1, failed: 0, retried: 0, processing: 0 });

    const row = await payoutRow(payout.id);
    expect(row).toMatchObject({ status: 'SUCCESS', attempts: 1 });
    expect(row.provider_reference).toMatch(/^TRF_mock_/);
    expect(row.processed_at).not.toBeNull();
    expect(await getSystemBalance('PLATFORM_PAYOUT_CLEARING')).toBe(0);
    expect(await getSystemBalance('PLATFORM_EXTERNAL_SETTLEMENT')).toBe(externalBefore + 400000);
    expect(await getBalance(vendor.user.id)).toBe(BALANCE - 400000);

    const audit = await runAudit(knex);
    expect(audit.pass).toBe(true);
    expect(audit.checks[3]).toMatchObject({ paidOut: '400000', funded: String(BALANCE), inside: String(BALANCE - 400000) });

    // Nothing left to do; a second run doesn't pay again.
    expect(await payoutsJob.runOnce()).toEqual({ settled: 0, failed: 0, retried: 0, processing: 0 });
  });

  test('a failed transfer returns the money: payout FAILED, wallet restored, clearing 0', async () => {
    const { vendor } = await fundedVendor({ accountNumber: '0123450000' }); // mock: always fails
    const { payout } = (await requestPayout(vendor, 400000).expect(201)).body.data;
    expect(await getBalance(vendor.user.id)).toBe(BALANCE - 400000);

    expect(await payoutsJob.runOnce()).toMatchObject({ settled: 0, failed: 1 });
    const row = await payoutRow(payout.id);
    expect(row.status).toBe('FAILED');
    expect(row.failure_reason).toMatch(/could not be credited/);
    expect(await getBalance(vendor.user.id)).toBe(BALANCE);
    expect(await getSystemBalance('PLATFORM_PAYOUT_CLEARING')).toBe(0);
    expect((await runAudit(knex)).pass).toBe(true);

    // After a FAILED payout the vendor may request again.
    await requestPayout(vendor, 100000).expect(201);
  });

  test('provider errors: back to PENDING with attempts + 1; after 5 attempts FAILED and refunded', async () => {
    const { vendor } = await fundedVendor();
    const { payout } = (await requestPayout(vendor, 400000).expect(201)).body.data;
    jest.spyOn(paystackClient, 'initiateTransfer').mockRejectedValue(new Error('ECONNRESET'));

    for (let attempt = 1; attempt < payoutsJob.MAX_ATTEMPTS; attempt += 1) {
      expect(await payoutsJob.runOnce()).toMatchObject({ retried: 1 });
      expect(await payoutRow(payout.id)).toMatchObject({ status: 'PENDING', attempts: attempt, last_error: 'ECONNRESET' });
      expect(await getBalance(vendor.user.id)).toBe(BALANCE - 400000);
    }

    expect(await payoutsJob.runOnce()).toMatchObject({ failed: 1 });
    const row = await payoutRow(payout.id);
    expect(row).toMatchObject({ status: 'FAILED', attempts: payoutsJob.MAX_ATTEMPTS });
    expect(row.failure_reason).toMatch(/after 5 attempts/);
    expect(await getBalance(vendor.user.id)).toBe(BALANCE);
  });

  test('a payout stuck in PROCESSING (crash) is reconciled with verifyTransfer', async () => {
    const { vendor } = await fundedVendor();
    const { payout } = (await requestPayout(vendor, 400000).expect(201)).body.data;
    // Simulate: claimed, transfer sent and succeeded, then the job crashed before settling.
    await knex('payouts').where({ id: payout.id }).update({
      status: 'PROCESSING',
      attempts: 1,
      updated_at: knex.raw("now() - interval '20 minutes'"),
    });
    await MockPaystackTransfer.create({ reference: payout.id, transferCode: 'TRF_crash', amountKobo: 400000, status: 'success' });

    expect(await payoutsJob.runOnce()).toMatchObject({ settled: 1 });
    expect(await payoutRow(payout.id)).toMatchObject({ status: 'SUCCESS', provider_reference: 'TRF_crash' });
  });

  test('pending at the provider, then a transfer.success webhook settles it', async () => {
    const { vendor } = await fundedVendor();
    const { payout } = (await requestPayout(vendor, 400000).expect(201)).body.data;
    jest.spyOn(paystackClient, 'initiateTransfer').mockResolvedValue({ status: 'pending', providerReference: 'TRF_live', amountKobo: 400000, reason: null });

    expect(await payoutsJob.runOnce()).toMatchObject({ processing: 1 });
    expect(await payoutRow(payout.id)).toMatchObject({ status: 'PROCESSING', provider_reference: 'TRF_live' });

    jest.spyOn(paystackClient, 'verifyTransfer').mockResolvedValue({ status: 'success', providerReference: 'TRF_live', amountKobo: 400000, reason: null });
    const body = JSON.stringify({ event: 'transfer.success', data: { reference: payout.id, amount: 400000, transfer_code: 'TRF_live' } });
    await postWebhook(body, mockService.sign(body)).expect(200);
    await postWebhook(body, mockService.sign(body)).expect(200); // duplicate: no double settle

    expect((await payoutRow(payout.id)).status).toBe('SUCCESS');
    expect(await getSystemBalance('PLATFORM_PAYOUT_CLEARING')).toBe(0);
    const results = (await knex('webhook_events').where({ reference: payout.id }).orderBy('received_at')).map((e) => e.processing_result);
    expect(results).toEqual(['PAYOUT_SETTLED', 'ALREADY_PROCESSED']);
  });
});

describe('reading payouts', () => {
  test('vendor list and detail; admin can view; a stranger gets 404', async () => {
    const { admin, vendor } = await fundedVendor();
    const { payout } = (await requestPayout(vendor, 100000).expect(201)).body.data;
    const stranger = await registerAndLogin();

    const list = await request(app).get('/api/v1/payouts?status=PENDING').set(bearer(vendor.accessToken)).expect(200);
    expect(list.body.data.map((p) => p.id)).toEqual([payout.id]);
    await request(app).get(`/api/v1/payouts/${payout.id}`).set(bearer(vendor.accessToken)).expect(200);
    await request(app).get(`/api/v1/payouts/${payout.id}`).set(bearer(admin.accessToken)).expect(200);
    await request(app).get(`/api/v1/payouts/${payout.id}`).set(bearer(stranger.accessToken)).expect(404);
  });
});
