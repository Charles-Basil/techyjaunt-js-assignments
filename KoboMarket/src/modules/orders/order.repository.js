// PostgreSQL access for orders. (The order flow itself comes in a later block.)
const { knex } = require('../../config/knex');

// Has this buyer received (COMPLETED sub-order) this product at least once?
//
//   SELECT 1 FROM order_items oi
//   JOIN sub_orders so ON so.id = oi.sub_order_id
//   JOIN orders o      ON o.id  = so.order_id
//   WHERE oi.product_id = ? AND so.status = 'COMPLETED' AND o.buyer_id = ?
//   LIMIT 1
async function hasCompletedPurchase(buyerId, productId) {
  const row = await knex('order_items as oi')
    .join('sub_orders as so', 'so.id', 'oi.sub_order_id')
    .join('orders as o', 'o.id', 'so.order_id')
    .where({ 'oi.product_id': String(productId), 'so.status': 'COMPLETED', 'o.buyer_id': String(buyerId) })
    .first(knex.raw('1 as found'));
  return Boolean(row);
}

module.exports = { hasCompletedPurchase };
