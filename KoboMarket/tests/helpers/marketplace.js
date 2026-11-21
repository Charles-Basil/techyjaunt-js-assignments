// Helpers for Block 3 tests: admins, approved vendors, products, completed orders.
const request = require('supertest');
const { app, registerAndLogin } = require('./auth');
const { knex } = require('./db');
const { User } = require('../../src/modules/users/user.model');

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

let storeCounter = 0;

function bankDetails() {
  return { bankName: 'Test Bank', bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Obi' };
}

// A logged-in admin. (Roles are read from Mongo on each request, so promoting
// the user after login is enough.)
async function createAdmin() {
  const admin = await registerAndLogin();
  await User.updateOne({ _id: admin.user.id }, { $addToSet: { roles: 'ADMIN' } });
  return admin;
}

// A logged-in vendor whose application was approved through the real endpoints.
async function createApprovedVendor(admin) {
  const vendor = await registerAndLogin();
  storeCounter += 1;
  const applied = await request(app)
    .post('/api/v1/vendors/apply')
    .set(bearer(vendor.accessToken))
    .send({ storeName: `Store ${Date.now()} ${storeCounter}`, bankDetails: bankDetails() })
    .expect(201);
  await request(app)
    .patch(`/api/v1/admin/vendors/${applied.body.data.application.id}/approve`)
    .set(bearer(admin.accessToken))
    .send({ decision: 'APPROVED' })
    .expect(200);
  return vendor;
}

async function createProduct(vendor, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/products')
    .set(bearer(vendor.accessToken))
    .send({ name: 'Red Sneakers', priceKobo: 1500000, category: 'shoes', stock: 10, ...overrides });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.product;
}

// Inserts orders -> sub_orders -> order_items rows directly in Postgres,
// standing in for a finished purchase until the checkout block exists.
async function insertCompletedPurchase({ buyerId, vendorId, productId, priceKobo = 1500000, quantity = 1 }) {
  const total = priceKobo * quantity;
  const [order] = await knex('orders')
    .insert({ buyer_id: buyerId, status: 'COMPLETED', total_kobo: total })
    .returning('id');
  const [subOrder] = await knex('sub_orders')
    .insert({ order_id: order.id, vendor_id: vendorId, status: 'COMPLETED', subtotal_kobo: total })
    .returning('id');
  await knex('order_items').insert({
    sub_order_id: subOrder.id,
    product_id: productId,
    name: 'Test product',
    unit_price_kobo: priceKobo,
    quantity,
    line_total_kobo: total,
  });
}

module.exports = { bearer, bankDetails, createAdmin, createApprovedVendor, createProduct, insertCompletedPurchase };
