const request = require('supertest');
const db = require('./helpers/db');
const { app } = require('./helpers/auth');
const { bearer } = require('./helpers/funding');
const { setupShop, createBuyer, buyNow, checkout, subOrderAction } = require('./helpers/orders');
const { createProduct } = require('./helpers/marketplace');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

const get = (admin, url) => request(app).get(url).set(bearer(admin.accessToken));

/**
 * TEST-ONLY: puts a balanced revenue posting (DEBIT escrow, CREDIT revenue) at a
 * chosen time in the past. postTransaction always uses now(), and backdating is
 * the only way to test "revenue per day". Balances are updated to match the
 * entries, so the ledger audit still passes. Production code never does this.
 */
async function postRevenueAt(amountKobo, createdAt, { direction = 'CREDIT' } = {}) {
  const escrow = await knex('accounts').where({ code: 'PLATFORM_ESCROW' }).first();
  const revenue = await knex('accounts').where({ code: 'PLATFORM_REVENUE' }).first();
  const [tx] = await knex('transactions')
    .insert({ reference: `TEST_REVENUE:${Math.random()}`, type: 'TEST_REVENUE', status: 'POSTED', metadata: {}, created_at: createdAt })
    .returning('id');
  const other = direction === 'CREDIT' ? 'DEBIT' : 'CREDIT';
  await knex('ledger_entries').insert([
    { transaction_id: tx.id, account_id: escrow.id, direction: other, amount_kobo: amountKobo, created_at: createdAt },
    { transaction_id: tx.id, account_id: revenue.id, direction, amount_kobo: amountKobo, created_at: createdAt },
  ]);
  const sign = direction === 'CREDIT' ? 1 : -1;
  await knex('accounts').where({ id: revenue.id }).increment('balance_kobo', sign * amountKobo);
  await knex('accounts').where({ id: escrow.id }).increment('balance_kobo', -sign * amountKobo);
}

describe('revenue report', () => {
  test('sums per Lagos day, includes zero days, and respects the Lagos midnight', async () => {
    const { admin } = await setupShop();
    await postRevenueAt(5000, '2026-03-01T09:00:00Z'); // 10:00 Lagos, Mar 1
    await postRevenueAt(2000, '2026-03-01T23:30:00Z'); // 00:30 Lagos, Mar 2
    await postRevenueAt(1500, '2026-03-04T12:00:00Z');
    await postRevenueAt(500, '2026-03-04T13:00:00Z', { direction: 'DEBIT' }); // e.g. a correction
    await postRevenueAt(9999, '2026-02-28T12:00:00Z'); // outside the range

    const res = await get(admin, '/api/v1/admin/reports/revenue?from=2026-03-01&to=2026-03-05').expect(200);
    expect(res.body.data).toEqual({
      from: '2026-03-01',
      to: '2026-03-05',
      totalKobo: 8000,
      days: [
        { date: '2026-03-01', revenueKobo: 5000 },
        { date: '2026-03-02', revenueKobo: 2000 },
        { date: '2026-03-03', revenueKobo: 0 },
        { date: '2026-03-04', revenueKobo: 1000 },
        { date: '2026-03-05', revenueKobo: 0 },
      ],
    });
  });

  test('validates dates: to >= from, at most 366 days, real dates only', async () => {
    const { admin } = await setupShop();
    await get(admin, '/api/v1/admin/reports/revenue?from=2026-03-05&to=2026-03-01').expect(400);
    await get(admin, '/api/v1/admin/reports/revenue?from=2025-01-01&to=2026-01-02').expect(400);
    await get(admin, '/api/v1/admin/reports/revenue?from=2025-01-01&to=2026-01-01').expect(200); // 366 days
    await get(admin, '/api/v1/admin/reports/revenue?from=2026-02-30&to=2026-03-01').expect(400);
    await get(admin, '/api/v1/admin/reports/revenue').expect(400);
  });
});

describe('top vendors report', () => {
  test('orders vendors by completed sales and adds store names', async () => {
    const { admin, vendors, products } = await setupShop({ vendors: 2, priceKobo: 100000, stock: 10 });
    const bigProduct = await createProduct(vendors[1], { name: 'Big item', priceKobo: 150000, stock: 5 });
    const buyer = await createBuyer(1000000);

    const complete = async (product, vendor) => {
      const { order } = (await buyNow(buyer, product, 1).expect(201)).body.data;
      await subOrderAction(vendor, order.subOrders[0].id, 'ship').expect(200);
      await subOrderAction(buyer, order.subOrders[0].id, 'confirm').expect(200);
    };
    await complete(products[0], vendors[0]); // vendor A: 2 x 100000 = 200000
    await complete(products[0], vendors[0]);
    await complete(bigProduct, vendors[1]); // vendor B: 150000
    await buyNow(buyer, products[1], 1).expect(201); // not completed: doesn't count

    const res = await get(admin, '/api/v1/admin/reports/top-vendors').expect(200);
    expect(res.body.data.month).toMatch(/^\d{4}-\d{2}$/);
    expect(res.body.data.vendors).toEqual([
      expect.objectContaining({ rank: 1, vendorId: vendors[0].user.id, completedCount: 2, grossKobo: 200000, commissionKobo: 10000, refundedKobo: 0, netKobo: 190000 }),
      expect.objectContaining({ rank: 2, vendorId: vendors[1].user.id, completedCount: 1, grossKobo: 150000, commissionKobo: 7500, netKobo: 142500 }),
    ]);
    expect(res.body.data.vendors[0].storeName).toMatch(/^Store /);

    const otherMonth = await get(admin, '/api/v1/admin/reports/top-vendors?month=2020-01').expect(200);
    expect(otherMonth.body.data.vendors).toEqual([]);
    await get(admin, '/api/v1/admin/reports/top-vendors?month=2026-13').expect(400);
  });
});

describe('escrow report', () => {
  test('the escrow balance matches the open sub-orders, per status', async () => {
    const { admin, vendors, products } = await setupShop({ vendors: 2, priceKobo: 100000, stock: 10 });
    const buyer = await createBuyer(1000000);
    const items = products.map((p) => ({ productId: p.id, quantity: 1 }));
    const { order } = (await checkout(buyer, { items }).expect(201)).body.data; // 2 PAID sub-orders
    const sub = order.subOrders.find((s) => s.vendorId === vendors[0].user.id);
    await subOrderAction(vendors[0], sub.id, 'ship').expect(200); // 1 PAID, 1 SHIPPED
    await buyNow(buyer, products[1], 2).expect(201); // +1 PAID (200000)

    const res = await get(admin, '/api/v1/admin/reports/escrow').expect(200);
    expect(res.body.data).toEqual({
      escrowBalanceKobo: 400000,
      openSubOrdersTotalKobo: 400000,
      matches: true,
      breakdown: [
        { status: 'PAID', count: 2, totalKobo: 300000 },
        { status: 'SHIPPED', count: 1, totalKobo: 100000 },
        { status: 'DELIVERED', count: 0, totalKobo: 0 },
        { status: 'DISPUTED', count: 0, totalKobo: 0 },
      ],
    });
  });
});

describe('reconciliation report', () => {
  test('is empty, then lists a wallet whose cached balance was tampered with', async () => {
    const { admin } = await setupShop();
    const buyer = await createBuyer(50000);
    expect((await get(admin, '/api/v1/admin/reports/reconciliation').expect(200)).body.data).toEqual({ ok: true, mismatches: [] });

    await knex('accounts').where({ owner_id: buyer.user.id }).update({ balance_kobo: '99999' });
    const res = await get(admin, '/api/v1/admin/reports/reconciliation').expect(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.mismatches).toEqual([
      expect.objectContaining({ ownerType: 'USER', ownerId: buyer.user.id, storedBalanceKobo: 99999, ledgerBalanceKobo: 50000, differenceKobo: 49999 }),
    ]);

    await knex('accounts').where({ owner_id: buyer.user.id }).update({ balance_kobo: '50000' }); // undo for the audit
  });
});
