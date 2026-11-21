// Helpers for checkout / escrow tests.
const request = require('supertest');
const { app, registerAndLogin } = require('./auth');
const { knex } = require('./db');
const { createAdmin, createApprovedVendor, createProduct } = require('./marketplace');
const { fundWallet } = require('./wallet');
const { bearer, newKey } = require('./funding');
const { Product } = require('../../src/modules/products/product.model');

// An admin, N approved vendors and one product per vendor.
async function setupShop({ vendors = 1, priceKobo = 100000, stock = 10 } = {}) {
  const admin = await createAdmin();
  const shop = { admin, vendors: [], products: [] };
  for (let i = 0; i < vendors; i += 1) {
    const vendor = await createApprovedVendor(admin);
    shop.vendors.push(vendor);
    shop.products.push(await createProduct(vendor, { name: `Product ${i + 1}`, priceKobo, stock }));
  }
  return shop;
}

// A logged-in buyer with `balanceKobo` in their wallet (0 = no funding).
async function createBuyer(balanceKobo = 0) {
  const buyer = await registerAndLogin();
  if (balanceKobo > 0) await fundWallet(buyer.user.id, balanceKobo);
  return buyer;
}

function checkout(user, body = {}, key = newKey()) {
  return request(app)
    .post('/api/v1/orders/checkout')
    .set(bearer(user.accessToken))
    .set('Idempotency-Key', key)
    .send(body);
}

function buyNow(user, product, quantity = 1, key = newKey()) {
  return checkout(user, { items: [{ productId: product.id, quantity }] }, key);
}

function subOrderAction(user, subOrderId, action, body = {}) {
  return request(app).patch(`/api/v1/sub-orders/${subOrderId}/${action}`).set(bearer(user.accessToken)).send(body);
}

async function stockOf(productId) {
  return (await Product.findById(productId)).stock;
}

async function counts() {
  const tables = ['orders', 'sub_orders', 'order_items', 'ledger_entries', 'transactions'];
  const result = {};
  for (const table of tables) {
    const [{ count }] = await knex(table).count();
    result[table] = Number(count);
  }
  return result;
}

// Pretend a sub-order was shipped `hours` ago (for the escrow timeout).
function setShippedHoursAgo(subOrderId, hours) {
  return knex('sub_orders')
    .where({ id: subOrderId })
    .update({ shipped_at: knex.raw('now() - make_interval(hours => ?)', [hours]) });
}

module.exports = { setupShop, createBuyer, checkout, buyNow, subOrderAction, stockOf, counts, setShippedHoursAgo };
