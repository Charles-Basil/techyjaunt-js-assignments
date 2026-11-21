const db = require('./helpers/db');
const { getBalance, getSystemBalance } = require('./helpers/wallet');
const { setupShop, createBuyer, buyNow, subOrderAction, setShippedHoursAgo } = require('./helpers/orders');
const autoComplete = require('../src/jobs/autoComplete.job');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;
const PRICE = 100000;

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

describe('auto-complete job (escrow timeout = 72h)', () => {
  let vendor;
  let buyer;
  let product;

  beforeEach(async () => {
    const shop = await setupShop({ priceKobo: PRICE, stock: 20 });
    [vendor] = shop.vendors;
    [product] = shop.products;
    buyer = await createBuyer(PRICE * 5);
  });

  async function shippedSubOrder(hoursAgo) {
    const { order } = (await buyNow(buyer, product, 1).expect(201)).body.data;
    const subOrderId = order.subOrders[0].id;
    await subOrderAction(vendor, subOrderId, 'ship').expect(200);
    await setShippedHoursAgo(subOrderId, hoursAgo);
    return subOrderId;
  }

  test('completes old ones only; skips recent, DISPUTED, and ones with an OPEN dispute', async () => {
    const old = await shippedSubOrder(73);
    const recent = await shippedSubOrder(1);

    const disputed = await shippedSubOrder(100);
    await knex('sub_orders').where({ id: disputed }).update({ status: 'DISPUTED' });

    const withOpenDispute = await shippedSubOrder(100);
    await knex('disputes').insert({ sub_order_id: withOpenDispute, buyer_id: buyer.user.id, reason: 'Item damaged', status: 'OPEN' });

    const result = await autoComplete.runOnce();
    expect(result).toEqual({ completed: 1, skipped: 0, failed: 0 });

    const statusOf = async (id) => (await knex('sub_orders').where({ id }).first()).status;
    expect(await statusOf(old)).toBe('COMPLETED');
    expect(await statusOf(recent)).toBe('SHIPPED');
    expect(await statusOf(disputed)).toBe('DISPUTED');
    expect(await statusOf(withOpenDispute)).toBe('SHIPPED');

    // Released exactly once: vendor got 95%, revenue 5%, by the SYSTEM actor.
    expect(await getBalance(vendor.user.id)).toBe(95000);
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(5000);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(PRICE * 3);
    const event = await knex('sub_order_events').where({ sub_order_id: old, to_status: 'COMPLETED' }).first();
    expect(event).toMatchObject({ actor_id: 'SYSTEM', actor_role: 'SYSTEM' });

    // A second run finds nothing new.
    expect(await autoComplete.runOnce()).toEqual({ completed: 0, skipped: 0, failed: 0 });
    expect(await getBalance(vendor.user.id)).toBe(95000);
  });

  test('DELIVERED sub-orders past the timeout are completed too', async () => {
    const id = await shippedSubOrder(80);
    await subOrderAction(vendor, id, 'deliver').expect(200);
    expect(await autoComplete.runOnce()).toMatchObject({ completed: 1 });
  });

  test('a buyer confirming at the same time as the job: paid out once', async () => {
    const id = await shippedSubOrder(80);
    const [jobResult, confirm] = await Promise.all([autoComplete.runOnce(), subOrderAction(buyer, id, 'confirm')]);
    // Whoever came second saw COMPLETED (409 for the buyer, or skipped by the job).
    expect(jobResult.completed + (confirm.status === 200 ? 1 : 0)).toBe(1);
    expect(await getBalance(vendor.user.id)).toBe(95000);
  });

  test('overlapping runs are prevented', async () => {
    await shippedSubOrder(80);
    const [a, b] = await Promise.all([autoComplete.runOnce(), autoComplete.runOnce()]);
    expect([a.alreadyRunning, b.alreadyRunning].filter(Boolean)).toHaveLength(1);
    expect(a.completed + b.completed).toBe(1);
  });
});
