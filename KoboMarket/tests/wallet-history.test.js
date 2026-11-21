const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { fundWallet } = require('./helpers/wallet');
const { bearer } = require('./helpers/funding');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

describe('GET /wallet and /wallet/transactions', () => {
  test('a new user sees a 0 balance wallet', async () => {
    const buyer = await registerAndLogin();
    const res = await request(app).get('/api/v1/wallet').set(bearer(buyer.accessToken)).expect(200);
    expect(res.body.data).toMatchObject({ balanceKobo: 0, currency: 'NGN', status: 'ACTIVE' });
    expect(res.body.data.accountId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('history pages newest first with no duplicates or gaps', async () => {
    const buyer = await registerAndLogin();
    const amounts = [10000, 20000, 30000, 40000, 50000, 60000, 70000];
    for (const amount of amounts) await fundWallet(buyer.user.id, amount);

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await request(app)
        .get(`/api/v1/wallet/transactions?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      seen.push(...res.body.data);
      cursor = res.body.pagination.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3); // 3 + 3 + 1
    expect(new Set(seen.map((e) => e.id)).size).toBe(amounts.length);
    expect(seen.map((e) => e.amountKobo)).toEqual([...amounts].reverse()); // newest first
    expect(seen.every((e) => e.direction === 'CREDIT' && e.type === 'WALLET_FUNDING')).toBe(true);

    const balance = await request(app).get('/api/v1/wallet').set(bearer(buyer.accessToken)).expect(200);
    expect(balance.body.data.balanceKobo).toBe(amounts.reduce((a, b) => a + b, 0));
  });

  test('a user only sees their own entries', async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    await fundWallet(a.user.id, 10000);
    const res = await request(app).get('/api/v1/wallet/transactions').set(bearer(b.accessToken)).expect(200);
    expect(res.body.data).toEqual([]);
  });

  test('a bad cursor is 400 INVALID_CURSOR', async () => {
    const buyer = await registerAndLogin();
    const res = await request(app)
      .get('/api/v1/wallet/transactions?cursor=garbage')
      .set(bearer(buyer.accessToken))
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });
});
