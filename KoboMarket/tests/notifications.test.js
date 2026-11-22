const request = require('supertest');
const db = require('./helpers/db');
const { app } = require('./helpers/auth');
const { bearer } = require('./helpers/funding');
const { waitFor, settle } = require('./helpers/wait');
const { setupShop, createBuyer, buyNow, subOrderAction } = require('./helpers/orders');
const { Notification } = require('../src/modules/notifications/notification.model');
const notificationsService = require('../src/modules/notifications/notifications.service');
const notificationRepository = require('../src/modules/notifications/notification.repository');
const { handlers } = require('../src/events/listeners/notification.listener');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;
const PRICE = 100000;

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

const notificationsOf = (userId, type) => Notification.find({ userId, ...(type ? { type } : {}) }).lean();

describe('notifications from events', () => {
  test('checkout creates ORDER_PLACED for the buyer and the vendor', async () => {
    const { vendors, products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(PRICE);
    const { order } = (await buyNow(buyer, products[0], 1).expect(201)).body.data;

    const [forBuyer] = await waitFor(async () => {
      const found = await notificationsOf(buyer.user.id, 'ORDER_PLACED');
      return found.length ? found : null;
    });
    expect(forBuyer).toMatchObject({ title: 'Order placed', data: { orderId: order.id, amountKobo: PRICE }, readAt: null });
    expect(forBuyer.message).toContain('NGN 1,000.00');

    const [forVendor] = await waitFor(async () => {
      const found = await notificationsOf(vendors[0].user.id, 'ORDER_PLACED');
      return found.length ? found : null;
    });
    expect(forVendor.data).toMatchObject({ orderId: order.id, subOrderId: order.subOrders[0].id });
  });

  test('a listener that throws does not break the checkout request', async () => {
    const { products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(PRICE);
    const spy = jest.spyOn(notificationsService, 'notify').mockRejectedValue(new Error('notifications are down'));

    const res = await buyNow(buyer, products[0], 1);
    expect(res.status).toBe(201); // the money side is unaffected
    await waitFor(() => spy.mock.calls.length > 0); // the listener did run (and failed)
    await settle();
    expect(await Notification.countDocuments()).toBe(0);
  });

  test('ship -> ORDER_SHIPPED for the buyer; confirm -> FUNDS_RELEASED for the vendor', async () => {
    const { vendors, products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(PRICE);
    const { order } = (await buyNow(buyer, products[0], 1).expect(201)).body.data;
    const subOrderId = order.subOrders[0].id;

    await subOrderAction(vendors[0], subOrderId, 'ship', { trackingNumber: 'GIG-77' }).expect(200);
    const [shipped] = await waitFor(async () => {
      const found = await notificationsOf(buyer.user.id, 'ORDER_SHIPPED');
      return found.length ? found : null;
    });
    expect(shipped.message).toContain('GIG-77');

    await subOrderAction(buyer, subOrderId, 'confirm').expect(200);
    const [released] = await waitFor(async () => {
      const found = await notificationsOf(vendors[0].user.id, 'FUNDS_RELEASED');
      return found.length ? found : null;
    });
    expect(released.data).toMatchObject({ subOrderId, amountKobo: 95000 });
  });

  test('the same event twice creates only one notification (dedupeKey)', async () => {
    const { vendors } = await setupShop();
    const payload = { payoutId: '3f1c2b8e-0a4d-4c55-9f1e-1c2d3e4f5a6b', vendorId: vendors[0].user.id, amountKobo: '150000' };
    await handlers['payout.success'](payload);
    await handlers['payout.success'](payload);
    const found = await notificationsOf(vendors[0].user.id, 'PAYOUT_SUCCESS');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('NGN 1,500.00');
  });
});

describe('notification endpoints', () => {
  let buyer;
  beforeEach(async () => {
    buyer = await createBuyer();
    // 25 notifications for this buyer, created directly.
    await notificationRepository.createMany(
      Array.from({ length: 25 }, (_, i) => ({
        userId: buyer.user.id,
        type: 'ORDER_SHIPPED',
        title: `Shipped ${i}`,
        message: 'On its way',
        data: {},
        dedupeKey: `TEST:${i}`,
      }))
    );
  });

  test('list is paginated with a cursor (no duplicates, no gaps)', async () => {
    const seen = [];
    let cursor = null;
    do {
      const res = await request(app)
        .get(`/api/v1/notifications?limit=10${cursor ? `&cursor=${cursor}` : ''}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      seen.push(...res.body.data);
      cursor = res.body.pagination.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(25);
    expect(new Set(seen.map((n) => n.id)).size).toBe(25);
    expect(seen[0]).not.toHaveProperty('dedupeKey');
  });

  test('unread-count, mark one read (own only), unread filter, read-all', async () => {
    const count = () => request(app).get('/api/v1/notifications/unread-count').set(bearer(buyer.accessToken)).expect(200);
    expect((await count()).body.data.unread).toBe(25);

    const [first] = (await request(app).get('/api/v1/notifications?limit=1').set(bearer(buyer.accessToken))).body.data;
    const read = await request(app).patch(`/api/v1/notifications/${first.id}/read`).set(bearer(buyer.accessToken)).expect(200);
    expect(read.body.data.notification.readAt).not.toBeNull();
    expect((await count()).body.data.unread).toBe(24);

    // Someone else's notification id -> 404, and nothing changes.
    const stranger = await createBuyer();
    const [another] = (await request(app).get('/api/v1/notifications?limit=1&unread=true').set(bearer(buyer.accessToken))).body.data;
    await request(app).patch(`/api/v1/notifications/${another.id}/read`).set(bearer(stranger.accessToken)).expect(404);
    expect((await count()).body.data.unread).toBe(24);

    const unreadList = await request(app).get('/api/v1/notifications?unread=true&limit=50').set(bearer(buyer.accessToken)).expect(200);
    expect(unreadList.body.data).toHaveLength(24);

    const all = await request(app).patch('/api/v1/notifications/read-all').set(bearer(buyer.accessToken)).expect(200);
    expect(all.body.data.modified).toBe(24);
    expect((await count()).body.data.unread).toBe(0);
  });
});
