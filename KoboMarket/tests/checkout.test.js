const request = require('supertest');
const db = require('./helpers/db');
const { app } = require('./helpers/auth');
const { bearer, newKey } = require('./helpers/funding');
const { getBalance, getSystemBalance } = require('./helpers/wallet');
const { setupShop, createBuyer, checkout, buyNow, stockOf, counts } = require('./helpers/orders');
const productRepository = require('../src/modules/products/product.repository');
const stockRecovery = require('../src/jobs/stockRecovery.job');
const { User } = require('../src/modules/users/user.model');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;
const PRICE = 100000; // NGN 1,000

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

describe('checkout basics', () => {
  test('buy now: 201, money moves wallet -> escrow, stock goes down', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 5 });
    const buyer = await createBuyer(250000);

    const res = await buyNow(buyer, products[0], 2);
    expect(res.status).toBe(201);
    const { order } = res.body.data;
    expect(order).toMatchObject({ status: 'IN_PROGRESS', totalKobo: 200000, stockStatus: 'DEDUCTED' });
    expect(order.subOrders).toHaveLength(1);
    expect(order.subOrders[0]).toMatchObject({ status: 'PAID', subtotalKobo: 200000, commissionRateBps: 500 });
    expect(order.subOrders[0].items[0]).toMatchObject({ quantity: 2, unitPriceKobo: PRICE, lineTotalKobo: 200000 });
    expect(order.subOrders[0].events.map((e) => [e.fromStatus, e.toStatus])).toEqual([['PENDING_PAYMENT', 'PAID']]);

    expect(await getBalance(buyer.user.id)).toBe(50000);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(200000);
    expect(await stockOf(products[0].id)).toBe(3);
  });

  test('insufficient balance: 402, and NO order, sub-orders, items or ledger entries; stock unchanged', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 5 });
    const buyer = await createBuyer(PRICE - 1);
    const before = await counts();

    const res = await buyNow(buyer, products[0], 1);
    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', details: { balanceKobo: PRICE - 1, requiredKobo: PRICE } });

    expect(await counts()).toEqual(before);
    expect(await getBalance(buyer.user.id)).toBe(PRICE - 1);
    expect(await stockOf(products[0].id)).toBe(5);
  });

  test('a cart with items from 3 vendors -> 1 order, 3 sub-orders, escrow holds the total; cart emptied', async () => {
    const { products } = await setupShop({ vendors: 3, priceKobo: PRICE, stock: 5 });
    const buyer = await createBuyer(1000000);
    for (const [i, product] of products.entries()) {
      await request(app)
        .post('/api/v1/cart/items')
        .set(bearer(buyer.accessToken))
        .send({ productId: product.id, quantity: i + 1 })
        .expect(201);
    }

    const res = await checkout(buyer, {});
    expect(res.status).toBe(201);
    const { order } = res.body.data;
    expect(order.totalKobo).toBe(PRICE * (1 + 2 + 3));
    expect(order.subOrders).toHaveLength(3);
    expect(new Set(order.subOrders.map((s) => s.vendorId)).size).toBe(3);
    expect(order.subOrders.map((s) => s.subtotalKobo).sort()).toEqual([PRICE, PRICE * 2, PRICE * 3]);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(PRICE * 6);
    expect(await getBalance(buyer.user.id)).toBe(1000000 - PRICE * 6);

    const cart = await request(app).get('/api/v1/cart').set(bearer(buyer.accessToken)).expect(200);
    expect(cart.body.data.items).toHaveLength(0);
  });

  test('buy now does not touch the cart; an empty cart is 400 CART_EMPTY', async () => {
    const { products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(500000);
    const empty = await checkout(buyer, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('CART_EMPTY');

    await request(app).post('/api/v1/cart/items').set(bearer(buyer.accessToken)).send({ productId: products[0].id, quantity: 1 });
    await buyNow(buyer, products[0], 1).expect(201);
    const cart = await request(app).get('/api/v1/cart').set(bearer(buyer.accessToken)).expect(200);
    expect(cart.body.data.items).toHaveLength(1);
  });

  test('uses the CURRENT price, not the one in the cart', async () => {
    const { vendors, products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(500000);
    await request(app).post('/api/v1/cart/items').set(bearer(buyer.accessToken)).send({ productId: products[0].id, quantity: 1 });
    await request(app).patch(`/api/v1/products/${products[0].id}`).set(bearer(vendors[0].accessToken)).send({ priceKobo: 150000 });

    const res = await checkout(buyer, {}).expect(201);
    expect(res.body.data.order.totalKobo).toBe(150000);
  });

  test('problems are listed: 409 CART_INVALID; own product is 400; frozen user is 403', async () => {
    const { vendors, products } = await setupShop({ priceKobo: PRICE, stock: 1 });
    const buyer = await createBuyer(500000);

    const tooMany = await buyNow(buyer, products[0], 2);
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toMatchObject({
      code: 'CART_INVALID',
      details: [expect.objectContaining({ reason: 'INSUFFICIENT_STOCK', requested: 2, available: 1 })],
    });

    await require('./helpers/wallet').fundWallet(vendors[0].user.id, 500000);
    const own = await buyNow(vendors[0], products[0], 1);
    expect(own.status).toBe(400);
    expect(own.body.error.code).toBe('CANNOT_BUY_OWN_PRODUCT');

    await User.updateOne({ _id: buyer.user.id }, { status: 'FROZEN' });
    const frozen = await buyNow(buyer, products[0], 1);
    expect(frozen.status).toBe(403);
    expect(frozen.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('the same Idempotency-Key twice -> one order, the second response is replayed', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 5 });
    const buyer = await createBuyer(500000);
    const key = newKey();

    const first = await buyNow(buyer, products[0], 1, key);
    const second = await buyNow(buyer, products[0], 1, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.order.id).toBe(first.body.data.order.id);
    expect((await counts()).orders).toBe(1);
    expect(await getBalance(buyer.user.id)).toBe(500000 - PRICE);
    expect(await stockOf(products[0].id)).toBe(4);
  });
});

describe('concurrency', () => {
  test('10 parallel checkouts on a wallet that can pay for exactly 3 -> 3 x 201, 7 x 402', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 50 });
    const buyer = await createBuyer(PRICE * 3);

    const responses = await Promise.all(Array.from({ length: 10 }, () => buyNow(buyer, products[0], 1)));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 402, 402, 402, 402, 402, 402, 402]);

    expect(await getBalance(buyer.user.id)).toBe(0);
    expect((await counts()).orders).toBe(3);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(PRICE * 3);
    expect(await stockOf(products[0].id)).toBe(47);
    expect((await runAudit(knex)).pass).toBe(true);
  });

  test('2 buyers racing for the last item: 1 wins, the other gets 409 OUT_OF_STOCK and is refunded', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 1 });
    const buyerA = await createBuyer(PRICE);
    const buyerB = await createBuyer(PRICE);

    // Make the race real: hold both requests at the validation step until BOTH
    // have read "stock = 1". Then both pay in Postgres, and only one can win the
    // conditional $inc in MongoDB.
    const realFind = productRepository.findManyByIds;
    let arrived = 0;
    let releaseBoth;
    const bothArrived = new Promise((resolve) => (releaseBoth = resolve));
    jest.spyOn(productRepository, 'findManyByIds').mockImplementation(async (ids) => {
      const result = await realFind(ids);
      arrived += 1;
      if (arrived === 2) releaseBoth();
      await bothArrived;
      return result;
    });

    const [resA, resB] = await Promise.all([buyNow(buyerA, products[0], 1), buyNow(buyerB, products[0], 1)]);
    const results = [
      { buyer: buyerA, res: resA },
      { buyer: buyerB, res: resB },
    ];
    const winners = results.filter((r) => r.res.status === 201);
    const losers = results.filter((r) => r.res.status !== 201);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loser = losers[0];
    expect(loser.res.status).toBe(409);
    expect(loser.res.body.error.code).toBe('OUT_OF_STOCK');
    expect(await getBalance(loser.buyer.user.id)).toBe(PRICE); // money back
    const loserOrder = await knex('orders').where({ id: loser.res.body.error.details.orderId }).first();
    expect(loserOrder).toMatchObject({ status: 'CANCELLED', stock_status: 'RELEASED', cancel_reason: 'OUT_OF_STOCK' });
    const loserSub = await knex('sub_orders').where({ order_id: loserOrder.id }).first();
    expect(loserSub).toMatchObject({ status: 'CANCELLED', cancel_reason: 'OUT_OF_STOCK' });

    expect(await getBalance(winners[0].buyer.user.id)).toBe(0);
    expect(await stockOf(products[0].id)).toBe(0); // not negative
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(PRICE);
    expect((await runAudit(knex)).pass).toBe(true);
  });
});

describe('cross-database failures', () => {
  test('MongoDB failing during the stock step: refunded, cancelled, 503, stock untouched', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 5 });
    const buyer = await createBuyer(PRICE);
    jest.spyOn(productRepository, 'decrementStock').mockRejectedValueOnce(new Error('mongo down'));

    const res = await buyNow(buyer, products[0], 1);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STOCK_UPDATE_FAILED');
    expect(await getBalance(buyer.user.id)).toBe(PRICE);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(0);
    expect(await stockOf(products[0].id)).toBe(5);
    expect(await knex('orders').first()).toMatchObject({ status: 'CANCELLED', stock_status: 'RELEASED' });
  });

  test('stock recovery job: an order stuck in stock_status PENDING is refunded and cancelled', async () => {
    const { products } = await setupShop({ priceKobo: PRICE, stock: 5 });
    const buyer = await createBuyer(PRICE * 2);
    const stuck = (await buyNow(buyer, products[0], 1).expect(201)).body.data.order;
    const fresh = (await buyNow(buyer, products[0], 1).expect(201)).body.data.order;

    // Simulate "the process crashed after Postgres committed, before the stock step":
    await knex('orders').where({ id: stuck.id }).update({ stock_status: 'PENDING', created_at: knex.raw("now() - interval '10 minutes'") });
    // A recent PENDING order (a checkout that may still be running) must be left alone:
    await knex('orders').where({ id: fresh.id }).update({ stock_status: 'PENDING' });

    const result = await stockRecovery.runOnce();
    expect(result).toEqual({ compensated: 1, skipped: 0, failed: 0 });

    expect(await knex('orders').where({ id: stuck.id }).first()).toMatchObject({
      status: 'CANCELLED',
      stock_status: 'RELEASED',
      cancel_reason: 'CHECKOUT_INTERRUPTED',
    });
    expect((await knex('orders').where({ id: fresh.id }).first()).stock_status).toBe('PENDING');
    expect(await getBalance(buyer.user.id)).toBe(PRICE); // one order refunded, one still paid
    const event = await knex('sub_order_events').where({ to_status: 'CANCELLED' }).first();
    expect(event).toMatchObject({ actor_id: 'SYSTEM', actor_role: 'SYSTEM' });

    // Running again does nothing more (no double refund).
    expect(await stockRecovery.runOnce()).toEqual({ compensated: 0, skipped: 0, failed: 0 });
    expect(await getBalance(buyer.user.id)).toBe(PRICE);
  });
});
