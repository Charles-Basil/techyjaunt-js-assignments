// Database rows (snake_case, BIGINT as strings) -> API objects (camelCase, kobo as numbers).
const { toKoboNumber } = require('../../utils/money');

function itemDto(item) {
  return {
    id: item.id,
    productId: item.product_id,
    variantId: item.variant_id,
    name: item.name,
    unitPriceKobo: toKoboNumber(item.unit_price_kobo),
    quantity: item.quantity,
    lineTotalKobo: toKoboNumber(item.line_total_kobo),
  };
}

function eventDto(event) {
  return {
    id: event.id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    actorId: event.actor_id,
    actorRole: event.actor_role,
    note: event.note,
    createdAt: event.created_at,
  };
}

function subOrderDto(subOrder, items = [], events = null) {
  const dto = {
    id: subOrder.id,
    orderId: subOrder.order_id,
    vendorId: subOrder.vendor_id,
    buyerId: subOrder.buyer_id,
    status: subOrder.status,
    subtotalKobo: toKoboNumber(subOrder.subtotal_kobo),
    commissionRateBps: subOrder.commission_rate_bps,
    commissionKobo: subOrder.commission_kobo === null ? null : toKoboNumber(subOrder.commission_kobo),
    trackingNumber: subOrder.tracking_number,
    cancelReason: subOrder.cancel_reason,
    shippedAt: subOrder.shipped_at,
    deliveredAt: subOrder.delivered_at,
    completedAt: subOrder.completed_at,
    createdAt: subOrder.created_at,
    items: items.map(itemDto),
  };
  if (events) dto.events = events.map(eventDto);
  return dto;
}

function orderDto(order, subOrders = []) {
  return {
    id: order.id,
    buyerId: order.buyer_id,
    status: order.status,
    totalKobo: toKoboNumber(order.total_kobo),
    stockStatus: order.stock_status,
    cancelReason: order.cancel_reason,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    subOrders,
  };
}

// Groups child rows by a key, e.g. items by sub_order_id (one query, then group in memory).
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

module.exports = { itemDto, eventDto, subOrderDto, orderDto, groupBy };
