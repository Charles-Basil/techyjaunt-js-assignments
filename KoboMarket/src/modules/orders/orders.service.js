// Reading orders, and buyer cancellation.
const { knex } = require('../../config/knex');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const pagination = require('../../utils/pagination');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const orderPolicy = require('../../policies/orderPolicy');
const productRepository = require('../products/product.repository');
const orderRepository = require('./order.repository');
const { transition } = require('./orderStateMachine');
const { orderDto, subOrderDto, groupBy } = require('./order.mapper');

// Order + sub-orders + items (+ events). 3-4 queries in total, whatever the size.
async function loadOrders(orders, { withEvents = false } = {}) {
  const subOrders = await orderRepository.findSubOrdersByOrderIds(orders.map((o) => o.id));
  const subIds = subOrders.map((s) => s.id);
  const items = groupBy(await orderRepository.findItemsBySubOrderIds(subIds), 'sub_order_id');
  const events = withEvents ? groupBy(await orderRepository.findEventsBySubOrderIds(subIds), 'sub_order_id') : null;
  const subsByOrder = groupBy(subOrders, 'order_id');

  return orders.map((order) =>
    orderDto(
      order,
      (subsByOrder.get(order.id) || []).map((s) =>
        subOrderDto(s, items.get(s.id) || [], events ? events.get(s.id) || [] : null)
      )
    )
  );
}

async function getOrderDetails(orderId) {
  const order = await orderRepository.findOrderById(orderId);
  if (!order) throw new AppError('NOT_FOUND', 'Order not found', 404);
  const [details] = await loadOrders([order], { withEvents: true });
  return details;
}

async function getOrderForUser(user, orderId) {
  orderPolicy.assertCanViewOrder(user, await orderRepository.findOrderById(orderId));
  return getOrderDetails(orderId);
}

async function listMyOrders(buyerId, { status, limit, cursor }) {
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const rows = await orderRepository.listOrdersForBuyer(buyerId, { status, after, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: await loadOrders(page),
    pagination: { nextCursor: hasMore ? pagination.encodeCursor(last.cursor_created_at, last.id) : null, hasMore, limit },
  };
}

/**
 * Buyer cancels BEFORE anything shipped: every non-cancelled sub-order must be PAID.
 * Refund + status changes in one transaction; stock goes back to MongoDB after commit.
 */
async function cancelOrder(user, orderId) {
  const cancelled = await knex.transaction(async (trx) => {
    // Lock order: order -> sub-orders -> accounts.
    const order = await orderRepository.lockOrder(trx, orderId);
    orderPolicy.assertIsBuyer(user, order);
    if (order.stock_status !== 'DEDUCTED') {
      throw new AppError('ORDER_NOT_CANCELLABLE', 'This order cannot be cancelled', 409, { stockStatus: order.stock_status });
    }

    const subOrders = await orderRepository.lockSubOrdersOfOrder(trx, orderId);
    const open = subOrders.filter((s) => s.status !== 'CANCELLED');
    if (open.length === 0 || open.some((s) => s.status !== 'PAID')) {
      throw new AppError('ORDER_NOT_CANCELLABLE', 'Only orders where nothing has shipped yet can be cancelled', 409, {
        statuses: subOrders.map((s) => ({ subOrderId: s.id, status: s.status })),
      });
    }

    const refundKobo = open.reduce((sum, s) => sum + BigInt(s.subtotal_kobo), 0n);
    const wallet = await ledger.getUserAccount(trx, order.buyer_id);
    const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
    await ledger.lockAccounts(trx, [wallet.id, escrow.id]);
    await ledger.postTransaction(trx, {
      reference: `ORDER_REFUND:${orderId}`,
      type: 'ORDER_REFUND',
      metadata: { orderId, reason: 'BUYER_CANCELLED', allowFrozen: true },
      entries: [
        { accountId: escrow.id, direction: 'DEBIT', amountKobo: refundKobo },
        { accountId: wallet.id, direction: 'CREDIT', amountKobo: refundKobo },
      ],
    });

    for (const subOrder of open) {
      await transition(trx, subOrder.id, 'CANCELLED', {
        actorId: user._id,
        actorRole: 'BUYER',
        note: 'Cancelled by buyer before shipping',
        extraFields: { cancel_reason: 'BUYER_CANCELLED' },
      });
    }
    await orderRepository.markOrderReleased(trx, orderId, 'BUYER_CANCELLED');
    return open;
  });

  // After commit: give the stock back. A failure here must not undo the refund,
  // so it is logged (stock under-counted at worst, never oversold).
  const items = await orderRepository.findItemsBySubOrderIds(cancelled.map((s) => s.id));
  for (const item of items) {
    try {
      await productRepository.incrementStock(item.product_id, item.variant_id, item.quantity);
    } catch (err) {
      logger.error({ err, orderId, productId: item.product_id }, 'Could not restore stock after cancel');
    }
  }

  emitEvent('order.cancelled', { orderId, buyerId: String(user._id), reason: 'BUYER_CANCELLED' });
  return getOrderDetails(orderId);
}

module.exports = { getOrderDetails, getOrderForUser, listMyOrders, cancelOrder, loadOrders };
