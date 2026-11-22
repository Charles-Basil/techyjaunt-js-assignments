const request = require('supertest');
const db = require('./helpers/db');
const { app } = require('./helpers/auth');
const { bearer, newKey, startFunding } = require('./helpers/funding');
const { fundWallet } = require('./helpers/wallet');
const { createAdmin, createApprovedVendor } = require('./helpers/marketplace');
const { setupShop, createBuyer, buyNow } = require('./helpers/orders');
const accountRepository = require('../src/modules/wallet/account.repository');
const settingsRepository = require('../src/modules/settings/settings.repository');
const { User } = require('../src/modules/users/user.model');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;
const PRICE = 100000;
const UUID = '3f1c2b8e-0a4d-4c55-9f1e-1c2d3e4f5a6b';
const OBJECT_ID = '674a1f0c2b9e4c0012ab34cd';

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(async () => {
  jest.restoreAllMocks();
  await settingsRepository.setCommissionRateBps(500);
});
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

const auditRows = (action) => knex('admin_audit_log').where({ action }).orderBy('created_at');

describe('RBAC', () => {
  test('a buyer gets 403 on every /admin route', async () => {
    const buyer = await createBuyer();
    const routes = [
      ['get', '/api/v1/admin/ping'],
      ['get', '/api/v1/admin/vendors'],
      ['patch', `/api/v1/admin/vendors/${OBJECT_ID}/approve`],
      ['get', '/api/v1/admin/users'],
      ['patch', `/api/v1/admin/users/${OBJECT_ID}/freeze`],
      ['get', `/api/v1/admin/wallets/${UUID}/ledger`],
      ['get', '/api/v1/admin/transactions'],
      ['patch', '/api/v1/admin/settings/commission'],
      ['get', '/api/v1/admin/audit-log'],
      ['get', '/api/v1/admin/reports/revenue?from=2026-01-01&to=2026-01-31'],
      ['get', '/api/v1/admin/reports/top-vendors'],
      ['get', '/api/v1/admin/reports/escrow'],
      ['get', '/api/v1/admin/reports/reconciliation'],
    ];
    for (const [method, url] of routes) {
      const res = await request(app)[method](url).set(bearer(buyer.accessToken)).send({});
      expect({ method, url, status: res.status, code: res.body.error && res.body.error.code }).toEqual({
        method,
        url,
        status: 403,
        code: 'FORBIDDEN',
      });
    }
  });
});

describe('freeze / unfreeze', () => {
  function freeze(admin, userId, frozen, reason = 'Suspicious activity') {
    return request(app).patch(`/api/v1/admin/users/${userId}/freeze`).set(bearer(admin.accessToken)).send({ frozen, reason });
  }
  const accountStatus = async (userId) => (await accountRepository.findUserAccount(String(userId))).status;
  const login = (user) =>
    request(app).post('/api/v1/auth/login').send({ email: user.user.email, password: 'Password123' });

  test('freezing blocks login, checkout and funding, freezes the wallet, revokes sessions; unfreeze restores all', async () => {
    const { admin, products } = await setupShop({ priceKobo: PRICE, stock: 10 });
    const buyer = await createBuyer(PRICE * 3);

    const res = await freeze(admin, buyer.user.id, true);
    expect(res.status).toBe(200);
    expect(res.body.data.user.status).toBe('FROZEN');
    expect(await accountStatus(buyer.user.id)).toBe('FROZEN');

    expect((await login(buyer)).body.error.code).toBe('ACCOUNT_FROZEN');
    // The old access token still authenticates, but every money action is refused.
    expect((await buyNow(buyer, products[0], 1)).body.error.code).toBe('ACCOUNT_FROZEN');
    expect((await startFunding(buyer.accessToken, 50000)).body.error.code).toBe('ACCOUNT_FROZEN');
    // Refresh tokens were revoked.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: buyer.refreshToken }).expect(401);

    await freeze(admin, buyer.user.id, false, 'Cleared by support').expect(200);
    expect(await accountStatus(buyer.user.id)).toBe('ACTIVE');
    expect((await login(buyer)).status).toBe(200);
    await buyNow(buyer, products[0], 1).expect(201);

    const rows = await knex('admin_audit_log').where({ target_id: buyer.user.id }).orderBy('created_at');
    expect(rows.map((r) => [r.action, r.before.status, r.after.status, r.admin_id])).toEqual([
      ['USER_FROZEN', 'ACTIVE', 'FROZEN', admin.user.id],
      ['USER_UNFROZEN', 'FROZEN', 'ACTIVE', admin.user.id],
    ]);
    expect(rows[1].note).toBe('Cleared by support');
  });

  test('a frozen vendor cannot request a payout', async () => {
    const admin = await createAdmin();
    const vendor = await createApprovedVendor(admin);
    await fundWallet(vendor.user.id, 500000);
    await freeze(admin, vendor.user.id, true).expect(200);
    const res = await request(app)
      .post('/api/v1/payouts')
      .set(bearer(vendor.accessToken))
      .set('Idempotency-Key', newKey())
      .send({ amountKobo: 200000 });
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('the ledger itself refuses a frozen wallet even if MongoDB says ACTIVE', async () => {
    const { products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(PRICE);
    await knex('accounts').where({ owner_id: buyer.user.id }).update({ status: 'FROZEN' }); // Postgres only
    const res = await buyNow(buyer, products[0], 1);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('if Postgres fails, MongoDB is reverted (the databases never disagree)', async () => {
    const admin = await createAdmin();
    const buyer = await createBuyer();
    jest.spyOn(accountRepository, 'setOwnerStatus').mockRejectedValueOnce(new Error('postgres down'));
    const res = await freeze(admin, buyer.user.id, true);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('FREEZE_FAILED');
    expect((await User.findById(buyer.user.id)).status).toBe('ACTIVE');
    expect(await accountStatus(buyer.user.id)).toBe('ACTIVE');
    expect(await auditRows('USER_FROZEN')).toHaveLength(0);
  });

  test('an admin cannot freeze themselves; bad input is 400', async () => {
    const admin = await createAdmin();
    const self = await freeze(admin, admin.user.id, true);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_FREEZE_SELF');
    await request(app).patch(`/api/v1/admin/users/${OBJECT_ID}/freeze`).set(bearer(admin.accessToken)).send({ frozen: true }).expect(400);
    await freeze(admin, OBJECT_ID, true).expect(404);
  });
});

describe('commission setting', () => {
  test('validates 0-5000, writes the audit log, and only affects NEW checkouts', async () => {
    const { admin, products } = await setupShop({ priceKobo: PRICE, stock: 10 });
    const buyer = await createBuyer(PRICE * 2);
    const setRate = (commissionRateBps) =>
      request(app).patch('/api/v1/admin/settings/commission').set(bearer(admin.accessToken)).send({ commissionRateBps });

    await setRate(5001).expect(400);
    await setRate(-1).expect(400);
    await setRate(2.5).expect(400);

    const before = (await buyNow(buyer, products[0], 1).expect(201)).body.data.order;
    const res = await setRate(1000).expect(200);
    expect(res.body.data).toEqual({ commissionRateBps: 1000, previousCommissionRateBps: 500 });
    const after = (await buyNow(buyer, products[0], 1).expect(201)).body.data.order;

    expect(before.subOrders[0].commissionRateBps).toBe(500);
    expect(after.subOrders[0].commissionRateBps).toBe(1000);
    const [row] = await auditRows('COMMISSION_CHANGED');
    expect(row).toMatchObject({ admin_id: admin.user.id, before: { commissionRateBps: 500 }, after: { commissionRateBps: 1000 } });
  });
});

describe('users, ledger views and audit log', () => {
  test('GET /admin/users: search (regex-safe), role filter, pagination', async () => {
    const admin = await createAdmin();
    const vendor = await createApprovedVendor(admin);
    await createBuyer();
    const list = (qs) => request(app).get(`/api/v1/admin/users?${qs}`).set(bearer(admin.accessToken)).expect(200);

    const vendors = await list('role=VENDOR');
    expect(vendors.body.data.map((u) => u.id)).toEqual([vendor.user.id]);
    expect(vendors.body.data[0]).not.toHaveProperty('passwordHash');

    const byEmail = await list(`q=${encodeURIComponent(vendor.user.email.toUpperCase())}`);
    expect(byEmail.body.data.map((u) => u.id)).toEqual([vendor.user.id]);

    // Regex characters are searched literally: ".*" matches nobody's name.
    expect((await list(`q=${encodeURIComponent('.*')}`)).body.data).toHaveLength(0);

    const page1 = await list('limit=2');
    expect(page1.body.data).toHaveLength(2);
    const page2 = await list(`limit=2&cursor=${page1.body.pagination.nextCursor}`);
    expect(page2.body.data).toHaveLength(1);
  });

  test('GET /admin/wallets/:id/ledger shows history with counter-entries; GET /admin/transactions filters by type', async () => {
    const { admin, products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(PRICE * 2);
    await buyNow(buyer, products[0], 1).expect(201);
    const wallet = await accountRepository.findUserAccount(buyer.user.id);

    const res = await request(app).get(`/api/v1/admin/wallets/${wallet.id}/ledger`).set(bearer(admin.accessToken)).expect(200);
    expect(res.body.data.account).toMatchObject({ id: wallet.id, ownerType: 'USER', balanceKobo: PRICE, status: 'ACTIVE' });
    expect(res.body.data.account.owner.email).toBe(buyer.user.email);
    const [payment, funding] = res.body.data.entries; // newest first
    expect(payment).toMatchObject({ type: 'ORDER_PAYMENT', direction: 'DEBIT', amountKobo: PRICE });
    expect(payment.counterEntries).toEqual([expect.objectContaining({ accountCode: 'PLATFORM_ESCROW', direction: 'CREDIT', amountKobo: PRICE })]);
    expect(funding.counterEntries[0]).toMatchObject({ accountCode: 'PLATFORM_EXTERNAL_SETTLEMENT', direction: 'DEBIT' });
    await request(app).get(`/api/v1/admin/wallets/${UUID}/ledger`).set(bearer(admin.accessToken)).expect(404);

    const tx = await request(app).get('/api/v1/admin/transactions?type=ORDER_PAYMENT').set(bearer(admin.accessToken)).expect(200);
    expect(tx.body.data).toHaveLength(1);
    expect(tx.body.data[0].entries).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    const ranged = await request(app).get(`/api/v1/admin/transactions?from=2000-01-01&to=${today}`).set(bearer(admin.accessToken)).expect(200);
    expect(ranged.body.data.length).toBeGreaterThanOrEqual(2);
    await request(app).get('/api/v1/admin/transactions?from=2026-02-02&to=2026-02-01').set(bearer(admin.accessToken)).expect(400);
  });

  test('vendor approval writes an audit row; GET /admin/audit-log lists newest first', async () => {
    const admin = await createAdmin();
    await createApprovedVendor(admin);
    const res = await request(app).get('/api/v1/admin/audit-log').set(bearer(admin.accessToken)).expect(200);
    expect(res.body.data[0]).toMatchObject({
      action: 'VENDOR_APPROVED',
      adminId: admin.user.id,
      targetType: 'VENDOR_APPLICATION',
      before: { status: 'PENDING' },
      after: { status: 'APPROVED' },
    });
  });

  test('admin_audit_log is append-only', async () => {
    await knex('admin_audit_log').insert({ admin_id: 'x', action: 'TEST', target_type: 'T', target_id: '1' });
    await expect(knex('admin_audit_log').update({ action: 'CHANGED' })).rejects.toThrow(/append-only/);
    await expect(knex('admin_audit_log').del()).rejects.toThrow(/append-only/);
  });
});
