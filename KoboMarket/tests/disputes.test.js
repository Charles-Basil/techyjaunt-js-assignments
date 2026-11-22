const request = require('supertest');
const db = require('./helpers/db');
const { app } = require('./helpers/auth');
const { bearer } = require('./helpers/funding');
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

const REASON = 'The sandals arrived with a broken strap';

function openDispute(user, subOrderId, body = { reason: REASON }) {
  return request(app).post(`/api/v1/sub-orders/${subOrderId}/disputes`).set(bearer(user.accessToken)).send(body);
}

function resolve(user, disputeId, body) {
  return request(app).patch(`/api/v1/disputes/${disputeId}/resolve`).set(bearer(user.accessToken)).send(body);
}

// Buyer pays PRICE for one item; the vendor ships it.
async function shippedOrder() {
  const shop = await setupShop({ priceKobo: PRICE, stock: 5 });
  const buyer = await createBuyer(PRICE);
  const { order } = (await buyNow(buyer, shop.products[0], 1).expect(201)).body.data;
  const subOrderId = order.subOrders[0].id;
  const vendor = shop.vendors[0];
  await subOrderAction(vendor, subOrderId, 'ship').expect(200);
  return { ...shop, vendor, buyer, order, subOrderId };
}

async function disputedOrder() {
  const ctx = await shippedOrder();
  const res = await openDispute(ctx.buyer, ctx.subOrderId).expect(201);
  return { ...ctx, disputeId: res.body.data.dispute.id };
}

describe('opening a dispute', () => {
  test('on a SHIPPED sub-order: 201, dispute OPEN, sub-order DISPUTED', async () => {
    const { buyer, subOrderId } = await shippedOrder();
    const res = await openDispute(buyer, subOrderId, {
      reason: REASON,
      evidence: [
        { type: 'text', value: 'Strap came off on first use' },
        { type: 'image', value: 'https://images.example.com/strap.jpg' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.dispute).toMatchObject({ status: 'OPEN', resolution: null, subOrderId, buyerId: buyer.user.id });
    expect(res.body.data.dispute.evidence).toHaveLength(2);
    expect((await knex('sub_orders').where({ id: subOrderId }).first()).status).toBe('DISPUTED');
  });

  test('on a PAID sub-order -> 409 INVALID_STATE_TRANSITION', async () => {
    const { products } = await setupShop({ priceKobo: PRICE });
    const buyer = await createBuyer(PRICE);
    const { order } = (await buyNow(buyer, products[0], 1).expect(201)).body.data;
    const res = await openDispute(buyer, order.subOrders[0].id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'PAID', to: 'DISPUTED' } });
  });

  test('a second open dispute -> 409 DISPUTE_ALREADY_OPEN', async () => {
    const { buyer, subOrderId } = await disputedOrder();
    const res = await openDispute(buyer, subOrderId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DISPUTE_ALREADY_OPEN');
  });

  test('another buyer cannot dispute it (404); bad input is 400', async () => {
    const { buyer, subOrderId } = await shippedOrder();
    const stranger = await createBuyer();
    await openDispute(stranger, subOrderId).expect(404);
    await openDispute(buyer, subOrderId, { reason: 'too short' }).expect(400);
    await openDispute(buyer, subOrderId, { reason: REASON, evidence: [{ type: 'image', value: 'ftp://x.com/a.jpg' }] }).expect(400);
    await openDispute(buyer, subOrderId, { reason: REASON, evidence: [{ type: 'video', value: 'x' }] }).expect(400);
  });

  test('a disputed sub-order is skipped by auto-complete even when shipped 100h ago; the buyer cannot confirm it', async () => {
    const { buyer, subOrderId } = await disputedOrder();
    await setShippedHoursAgo(subOrderId, 100);
    expect(await autoComplete.runOnce()).toEqual({ completed: 0, skipped: 0, failed: 0 });
    expect((await knex('sub_orders').where({ id: subOrderId }).first()).status).toBe('DISPUTED');
    await subOrderAction(buyer, subOrderId, 'confirm').expect(409);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(PRICE); // escrow frozen
  });
});

describe('resolving a dispute (ADMIN)', () => {
  test('FULL_REFUND: buyer +subtotal, escrow -subtotal, sub-order REFUNDED, order REFUNDED', async () => {
    const { admin, buyer, vendor, order, subOrderId, disputeId } = await disputedOrder();
    expect(await getBalance(buyer.user.id)).toBe(0);

    const res = await resolve(admin, disputeId, { resolution: 'FULL_REFUND', note: 'Item damaged in transit' });
    expect(res.status).toBe(200);
    expect(res.body.data.dispute).toMatchObject({ status: 'RESOLVED', resolution: 'FULL_REFUND', refundKobo: PRICE });

    expect(await getBalance(buyer.user.id)).toBe(PRICE);
    expect(await getBalance(vendor.user.id)).toBe(0);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(0);
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(0);
    expect((await knex('sub_orders').where({ id: subOrderId }).first()).status).toBe('REFUNDED');
    expect((await knex('orders').where({ id: order.id }).first()).status).toBe('REFUNDED');
    expect((await runAudit(knex)).pass).toBe(true);
  });

  test('PARTIAL_REFUND 40000 of 100000 at 500 bps: buyer +40000, vendor +57000, revenue +3000, escrow -100000', async () => {
    const { admin, buyer, vendor, subOrderId, disputeId } = await disputedOrder();

    const res = await resolve(admin, disputeId, { resolution: 'PARTIAL_REFUND', refundKobo: 40000, note: 'One strap broken' });
    expect(res.status).toBe(200);
    expect(res.body.data.dispute).toMatchObject({ resolution: 'PARTIAL_REFUND', refundKobo: 40000 });

    expect(await getBalance(buyer.user.id)).toBe(40000);
    expect(await getBalance(vendor.user.id)).toBe(57000); // 60000 vendor part - 5% commission
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(3000); // 5% of 60000, not of 100000
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(0);
    expect(await knex('sub_orders').where({ id: subOrderId }).first()).toMatchObject({ status: 'COMPLETED', commission_kobo: '3000' });

    // The one ledger transaction for this resolution is balanced.
    const tx = await knex('transactions').where({ reference: `DISPUTE_RESOLUTION:${disputeId}` }).first();
    const entries = await knex('ledger_entries').where({ transaction_id: tx.id });
    const sum = (dir) => entries.filter((e) => e.direction === dir).reduce((s, e) => s + BigInt(e.amount_kobo), 0n);
    expect(sum('DEBIT')).toBe(100000n);
    expect(sum('CREDIT')).toBe(100000n);
    expect(entries).toHaveLength(4);
    expect((await runAudit(knex)).pass).toBe(true);
  });

  test('REJECTED: released as normal, vendor +95000, revenue +5000, sub-order COMPLETED', async () => {
    const { admin, buyer, vendor, subOrderId, disputeId } = await disputedOrder();
    await resolve(admin, disputeId, { resolution: 'REJECTED', note: 'Photos show normal wear' }).expect(200);

    expect(await getBalance(vendor.user.id)).toBe(95000);
    expect(await getSystemBalance('PLATFORM_REVENUE')).toBe(5000);
    expect(await getBalance(buyer.user.id)).toBe(0);
    expect((await knex('sub_orders').where({ id: subOrderId }).first()).status).toBe('COMPLETED');
    const tx = await knex('transactions').where({ reference: `DISPUTE_RESOLUTION:${disputeId}` }).first();
    expect(tx).toMatchObject({ type: 'DISPUTE_RESOLUTION', idempotency_key: `ESCROW_SETTLEMENT:${subOrderId}` });
  });

  test('stores resolved_by + note, writes a sub_order_events row; resolving twice is 409', async () => {
    const { admin, subOrderId, disputeId } = await disputedOrder();
    await resolve(admin, disputeId, { resolution: 'FULL_REFUND', note: 'Refund approved by support' }).expect(200);

    const row = await knex('disputes').where({ id: disputeId }).first();
    expect(row).toMatchObject({ status: 'RESOLVED', resolved_by: admin.user.id, resolution_note: 'Refund approved by support' });
    expect(row.resolved_at).not.toBeNull();
    const event = await knex('sub_order_events').where({ sub_order_id: subOrderId, to_status: 'REFUNDED' }).first();
    expect(event).toMatchObject({ actor_id: admin.user.id, actor_role: 'ADMIN', from_status: 'DISPUTED' });
    expect(event.note).toContain('Refund approved by support');

    const twice = await resolve(admin, disputeId, { resolution: 'REJECTED', note: 'Changed my mind' });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('DISPUTE_ALREADY_RESOLVED');
  });

  test('two admins resolving at the same moment: exactly one wins', async () => {
    const { admin, buyer, vendor, disputeId } = await disputedOrder();
    const [a, b] = await Promise.all([
      resolve(admin, disputeId, { resolution: 'FULL_REFUND', note: 'Refund it' }),
      resolve(admin, disputeId, { resolution: 'REJECTED', note: 'Reject it' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    // Money moved once, one way or the other, never both.
    expect((await getBalance(buyer.user.id)) + (await getBalance(vendor.user.id)) + (await getSystemBalance('PLATFORM_REVENUE'))).toBe(PRICE);
  });

  test('validation and permissions', async () => {
    const { admin, buyer, disputeId } = await disputedOrder();
    // Not an admin
    const notAdmin = await resolve(buyer, disputeId, { resolution: 'FULL_REFUND', note: 'Please refund' });
    expect(notAdmin.status).toBe(403);
    // Partial refund >= subtotal
    const tooMuch = await resolve(admin, disputeId, { resolution: 'PARTIAL_REFUND', refundKobo: PRICE, note: 'Too much' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('INVALID_REFUND_AMOUNT');
    // Missing note, missing refundKobo, refundKobo where it doesn't belong
    await resolve(admin, disputeId, { resolution: 'FULL_REFUND' }).expect(400);
    await resolve(admin, disputeId, { resolution: 'PARTIAL_REFUND', note: 'Some refund' }).expect(400);
    await resolve(admin, disputeId, { resolution: 'REJECTED', refundKobo: 10, note: 'Rejected' }).expect(400);
    // Nothing changed
    expect((await knex('disputes').where({ id: disputeId }).first()).status).toBe('OPEN');
  });
});

describe('reading disputes', () => {
  test('admin list with filter; buyer, vendor and admin can view one, a stranger gets 404', async () => {
    const { admin, buyer, vendor, disputeId } = await disputedOrder();
    const stranger = await createBuyer();

    const open = await request(app).get('/api/v1/disputes?status=OPEN').set(bearer(admin.accessToken)).expect(200);
    expect(open.body.data.map((d) => d.id)).toEqual([disputeId]);
    const resolved = await request(app).get('/api/v1/disputes?status=RESOLVED').set(bearer(admin.accessToken)).expect(200);
    expect(resolved.body.data).toHaveLength(0);
    await request(app).get('/api/v1/disputes').set(bearer(buyer.accessToken)).expect(403);

    for (const user of [admin, buyer, vendor]) {
      await request(app).get(`/api/v1/disputes/${disputeId}`).set(bearer(user.accessToken)).expect(200);
    }
    await request(app).get(`/api/v1/disputes/${disputeId}`).set(bearer(stranger.accessToken)).expect(404);
  });
});
