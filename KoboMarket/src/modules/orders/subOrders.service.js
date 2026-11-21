// Per-vendor fulfilment: list, ship, deliver, and the buyer's confirm.
const { knex } = require('../../config/knex');
const pagination = require('../../utils/pagination');
const { emitEvent } = require('../../events/emitter');
const orderPolicy = require('../../policies/orderPolicy');
const orderRepository = require('./order.repository');
const { transition } = require('./orderStateMachine');
const { releaseSubOrder } = require('./release.service');
const { subOrderDto, groupBy } = require('./order.mapper');

async function listForVendor(vendorId, { status, limit, cursor }) {
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const rows = await orderRepository.listSubOrdersForVendor(vendorId, { status, after, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = groupBy(await orderRepository.findItemsBySubOrderIds(page.map((s) => s.id)), 'sub_order_id');
  const last = page[page.length - 1];
  return {
    items: page.map((s) => subOrderDto(s, items.get(s.id) || [])),
    pagination: { nextCursor: hasMore ? pagination.encodeCursor(last.cursor_created_at, last.id) : null, hasMore, limit },
  };
}

async function withItems(subOrder) {
  return subOrderDto(subOrder, await orderRepository.findItemsBySubOrderIds([subOrder.id]));
}

// Vendor: PAID -> SHIPPED. The escrow timeout clock starts at shipped_at.
async function ship(user, subOrderId, { trackingNumber = null }) {
  const subOrder = await knex.transaction(async (trx) => {
    orderPolicy.assertIsVendorOf(user, await orderRepository.findSubOrder(subOrderId, trx));
    return transition(trx, subOrderId, 'SHIPPED', {
      actorId: user._id,
      actorRole: 'VENDOR',
      note: trackingNumber ? `Tracking: ${trackingNumber}` : null,
      extraFields: { shipped_at: trx.fn.now(), tracking_number: trackingNumber },
    });
  });
  emitEvent('order.shipped', { subOrderId, orderId: subOrder.order_id, buyerId: subOrder.buyer_id, trackingNumber });
  return withItems(subOrder);
}

// Vendor: SHIPPED -> DELIVERED (the courier delivered; the buyer can still dispute).
async function deliver(user, subOrderId) {
  const subOrder = await knex.transaction(async (trx) => {
    orderPolicy.assertIsVendorOf(user, await orderRepository.findSubOrder(subOrderId, trx));
    return transition(trx, subOrderId, 'DELIVERED', {
      actorId: user._id,
      actorRole: 'VENDOR',
      extraFields: { delivered_at: trx.fn.now() },
    });
  });
  return withItems(subOrder);
}

// Buyer: SHIPPED or DELIVERED -> COMPLETED, releasing escrow to the vendor.
async function confirm(user, subOrderId) {
  orderPolicy.assertIsBuyer(user, await orderRepository.findSubOrder(subOrderId));
  const { subOrder } = await releaseSubOrder(subOrderId, {
    actorId: user._id,
    actorRole: 'BUYER',
    note: 'Buyer confirmed receipt',
    fromStatuses: ['SHIPPED', 'DELIVERED'],
  });
  return withItems(subOrder);
}

module.exports = { listForVendor, ship, deliver, confirm };
