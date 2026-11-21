const request = require('supertest');
const db = require('./helpers/db');
const { app } = require('./helpers/auth');
const { bearer } = require('./helpers/funding');
const { fundWallet, getBalance, getSystemBalance } = require('./helpers/wallet');
const { setupShop, createBuyer, checkout, buyNow, subOrderAction, stockOf } = require('./helpers/orders');
const settingsRepository = require('../src/modules/settings/settings.repository');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => settingsRepository.setCommissionRateBps(500)); // tests may change it
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

// Buyer buys `quantity` of the shop's first product; returns ids and actors.
async function placeSingleOrder({ priceKobo = 100000, quantity = 1, stock = 5 } = {}) {
  const shop = await setupShop({ priceKobo, stock });
  const buyer = await createBuyer(priceKobo * quantity);
  const res = await buyNow(buyer, shop.products[0], quantity).expect(201);
  const { order } = res.body.data;
  return { ...shop, vendor: shop.vendors[0], product: shop.products[0], buyer, order, subOrderId: order.subOrders[0].id };
}

describe('state transitions over HTTP', () => {
  test('confirm on a PAID sub-order -> 409 INVALID_STATE_TRANSITION', async () => {
    const { buyer, subOrderId } = await placeSingleOrder();
    const res = await subOrderAction(buyer, subOrderId, 'confirm');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { from: 'PAID', to: 'COMPLETED', allowed: ['SHIPPED', 'CANCELLED'] },
    });
  });

  test('ship -> deliver -> confirm, with a full event history', async () => {
    const { buyer, vendor, order, subOrderId } = await placeSingleOrder();
    const shipped = await subOrderAction(vendor, subOrderId, 'ship', { trackingNumber: 'GIG-123' }).expect(200);
    expect(shipped.body.data.subOrder).toMatchObject({ status: 'SHIPPED', trackingNumber: 'GIG-123' });
    expect(shipped.body.data.subOrder.shippedAt).not.toBeNull();

    await subOrderAction(vendor, subOrderId, 'ship').expect(409); // can't ship twice
    await subOrderAction(vendor, subOrderId, 'deliver').expect(200);
    await subOrderAction(buyer, subOrderId, 'confirm').expect(200);

    const details = await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(buyer.accessToken)).expect(200);
    expect(details.body.data.order.status).toBe('COMPLETED');
    expect(details.body.data.order.subOrders[0].events.map((e) => `${e.fromStatus}>${e.toStatus}:${e.actorRole}`)).toEqual([
      'PENDING_PAYMENT>PAID:BUYER',
      'PAID>SHIPPED:VENDOR',
      'SHIPPED>DELIVERED:VENDOR',
      'DELIVERED>COMPLETED:BUYER',
    ]);
  });

  test('only the owning vendor can ship; a buyer cannot ship; only the buyer can confirm', async () => {
    const { admin, buyer, vendor, subOrderId } = await placeSingleOrder();
    const { createApprovedVendor } = require('./helpers/marketplace');
    const otherVendor = await createApprovedVendor(admin);

    const byOther = await subOrderAction(otherVendor, subOrderId, 'ship');
    expect(byOther.status).toBe(403);
    expect(byOther.body.error.code).toBe('NOT_SUB_ORDER_OWNER');
    const byBuyer = await subOrderAction(buyer, subOrderId, 'ship');
    expect(byBuyer.status).toBe(403);
    expect(byBuyer.body.error.code).toBe('FORBIDDEN');

    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    await subOrderAction(vendor, subOrderId, 'confirm').expect(404); // the vendor is not the buyer
  });
});

describe('releasing escrow', () => {
  test('completing splits the money: 100000 at 500 bps -> vendor +95000, revenue +5000, escrow -100000', async () => {
    const { buyer, vendor, subOrderId } = await placeSingleOrder({ priceKobo: 100000 });
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(100000);

    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    const res = await subOrderAction(buyer, subOrderId, 'confirm').expect(200);
    expect(res.body.data.subOrder).toMatchObject({ status: 'COMPLETED', commissionKobo: 5000 });

    expect(await getBalance(vendor.user.id)).toBe(95000);
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(5000);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(0);
  });

  test('rounding: subtotal 333 -> commission 16, vendor 317', async () => {
    const { buyer, vendor, subOrderId } = await placeSingleOrder({ priceKobo: 333 });
    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    await subOrderAction(buyer, subOrderId, 'confirm').expect(200);
    expect(await getBalance(vendor.user.id)).toBe(317);
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(16);
  });

  test('releasing twice is impossible (state check AND the unique ledger reference)', async () => {
    const { buyer, vendor, subOrderId } = await placeSingleOrder();
    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    await subOrderAction(buyer, subOrderId, 'confirm').expect(200);

    // 1. Normal second attempt: the state machine says no.
    const again = await subOrderAction(buyer, subOrderId, 'confirm');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');

    // 2. Simulate a bug that puts the sub-order back to SHIPPED: the unique
    //    reference ORDER_RELEASE:<id> still blocks a second payout.
    await knex('sub_orders').where({ id: subOrderId }).update({ status: 'SHIPPED' });
    const buggy = await subOrderAction(buyer, subOrderId, 'confirm');
    expect(buggy.status).toBe(409);
    expect(buggy.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(await getBalance(vendor.user.id)).toBe(95000);
    const [{ count }] = await knex('transactions').where({ type: 'ORDER_RELEASE' }).count();
    expect(Number(count)).toBe(1);
    await knex('sub_orders').where({ id: subOrderId }).update({ status: 'COMPLETED' }); // undo the simulated bug
  });

  test('changing the commission setting after checkout does not change that order', async () => {
    const { buyer, vendor, subOrderId } = await placeSingleOrder({ priceKobo: 100000 });
    await settingsRepository.setCommissionRateBps(2000); // 20% for NEW orders

    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    await subOrderAction(buyer, subOrderId, 'confirm').expect(200);
    expect(await getBalance(vendor.user.id)).toBe(95000); // still 5%
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(5000);
  });

  test('two vendors in one order: the order is COMPLETED only when both sub-orders are', async () => {
    const { vendors, products } = await setupShop({ vendors: 2, priceKobo: 100000 });
    const buyer = await createBuyer(200000);
    const items = products.map((p) => ({ productId: p.id, quantity: 1 }));
    const { order } = (await checkout(buyer, { items }).expect(201)).body.data;

    const subFor = (vendor) => order.subOrders.find((s) => s.vendorId === vendor.user.id).id;
    for (const vendor of vendors) await subOrderAction(vendor, subFor(vendor), 'ship').expect(200);

    await subOrderAction(buyer, subFor(vendors[0]), 'confirm').expect(200);
    expect((await knex('orders').where({ id: order.id }).first()).status).toBe('IN_PROGRESS');
    await subOrderAction(buyer, subFor(vendors[1]), 'confirm').expect(200);
    expect((await knex('orders').where({ id: order.id }).first()).status).toBe('COMPLETED');
  });

  test('a user who is both buyer and vendor (different shops) works without deadlocks', async () => {
    const { admin, vendor, product, buyer, subOrderId } = await placeSingleOrder();
    // The vendor also buys something from another shop at the same time as being paid.
    const { createApprovedVendor, createProduct } = require('./helpers/marketplace');
    const otherVendor = await createApprovedVendor(admin);
    const otherProduct = await createProduct(otherVendor, { priceKobo: 50000, stock: 5 });
    await fundWallet(vendor.user.id, 50000);
    await subOrderAction(vendor, subOrderId, 'ship').expect(200);

    const [confirmed, bought] = await Promise.all([
      subOrderAction(buyer, subOrderId, 'confirm'),
      buyNow(vendor, otherProduct, 1),
    ]);
    expect(confirmed.status).toBe(200);
    expect(bought.status).toBe(201);
    expect(await getBalance(vendor.user.id)).toBe(95000); // +95000 earned, -50000 spent, +50000 funded
    expect(product.id).toBeDefined();
  });
});

describe('cancel', () => {
  test('before shipping: buyer refunded, stock restored, order CANCELLED', async () => {
    const { buyer, product, order } = await placeSingleOrder({ priceKobo: 100000, quantity: 2, stock: 5 });
    expect(await stockOf(product.id)).toBe(3);

    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(buyer.accessToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.order).toMatchObject({ status: 'CANCELLED', stockStatus: 'RELEASED', cancelReason: 'BUYER_CANCELLED' });
    expect(res.body.data.order.subOrders[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'BUYER_CANCELLED' });

    expect(await getBalance(buyer.user.id)).toBe(200000);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(0);
    expect(await stockOf(product.id)).toBe(5);

    // Cancelling again is refused (and refunds nothing twice).
    await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(buyer.accessToken)).send({}).expect(409);
    expect(await getBalance(buyer.user.id)).toBe(200000);
  });

  test('after shipping -> 409 ORDER_NOT_CANCELLABLE', async () => {
    const { buyer, vendor, order, subOrderId } = await placeSingleOrder();
    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(buyer.accessToken)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(100000);
  });

  test('someone else cannot cancel (404)', async () => {
    const { order } = await placeSingleOrder();
    const stranger = await createBuyer();
    await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(stranger.accessToken)).send({}).expect(404);
  });
});

describe('reading orders', () => {
  test('GET /orders/:id: the buyer and an ADMIN can see it, a stranger gets 404', async () => {
    const { admin, buyer, order } = await placeSingleOrder();
    const stranger = await createBuyer();
    await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(buyer.accessToken)).expect(200);
    await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(admin.accessToken)).expect(200);
    await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(stranger.accessToken)).expect(404);
    await request(app).get('/api/v1/orders/not-a-uuid').set(bearer(buyer.accessToken)).expect(400);
  });

  test('GET /orders is paginated and filtered; GET /vendor/sub-orders shows only my sub-orders', async () => {
    const { vendors, products } = await setupShop({ vendors: 2, priceKobo: 10000, stock: 20 });
    const buyer = await createBuyer(100000);
    for (let i = 0; i < 3; i += 1) await buyNow(buyer, products[0], 1).expect(201);
    await buyNow(buyer, products[1], 1).expect(201);

    const page1 = await request(app).get('/api/v1/orders?limit=3').set(bearer(buyer.accessToken)).expect(200);
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.pagination.hasMore).toBe(true);
    const page2 = await request(app)
      .get(`/api/v1/orders?limit=3&cursor=${page1.body.pagination.nextCursor}`)
      .set(bearer(buyer.accessToken))
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    const ids = [...page1.body.data, ...page2.body.data].map((o) => o.id);
    expect(new Set(ids).size).toBe(4);

    const none = await request(app).get('/api/v1/orders?status=COMPLETED').set(bearer(buyer.accessToken)).expect(200);
    expect(none.body.data).toHaveLength(0);

    const mine = await request(app).get('/api/v1/vendor/sub-orders').set(bearer(vendors[0].accessToken)).expect(200);
    expect(mine.body.data).toHaveLength(3);
    expect(mine.body.data.every((s) => s.vendorId === vendors[0].user.id && s.items.length === 1)).toBe(true);
    await request(app).get('/api/v1/vendor/sub-orders').set(bearer(buyer.accessToken)).expect(403);
  });
});
