// Shared database helpers for test files.
const mongoose = require('mongoose');
const env = require('../../src/config/env');
const { knex } = require('../../src/config/knex');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refreshToken.model');
const { VendorProfile } = require('../../src/modules/vendors/vendorProfile.model');
const { Product } = require('../../src/modules/products/product.model');
const { Review } = require('../../src/modules/reviews/review.model');
const { Cart } = require('../../src/modules/cart/cart.model');
const MockPaystackTransaction = require('../../src/mock-paystack/MockPaystackTransaction');
const MockPaystackTransfer = require('../../src/mock-paystack/MockPaystackTransfer');
const { Notification } = require('../../src/modules/notifications/notification.model');

const MODELS = [
  User,
  RefreshToken,
  VendorProfile,
  Product,
  Review,
  Cart,
  MockPaystackTransaction,
  MockPaystackTransfer,
  Notification,
];

async function connect() {
  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    // Jest-only workaround: the MongoDB driver (v7.8) loads Node's "os" module
    // with a dynamic import(), which Jest's CommonJS sandbox can't do. The
    // handshake then goes out empty and MongoDB rejects it ("Missing required
    // sub-document 'driver'"). Handing the driver "os" ourselves avoids that.
    // The real app (plain Node) doesn't need this.
    runtimeAdapters: { os: require('os') },
  });
  // Build indexes (unique email, text index, ...) before tests rely on them.
  await Promise.all(MODELS.map((Model) => Model.init()));
}

// Wipe everything a test could have created. System accounts (from migrations) stay.
//
// !!! TEST-ONLY. Never do this outside tests. !!!
// ledger_entries and webhook_events are append-only (a trigger rejects UPDATE and
// DELETE). TRUNCATE is a different command that does not fire row-level triggers,
// so it can empty them. Then every balance is reset to 0 so it matches the (now
// empty) ledger, and the audit stays valid. globalSetup already refuses to run
// unless the database name ends in _test.
async function clean() {
  await Promise.all(MODELS.map((Model) => Model.deleteMany({})));
  await knex.raw(`
    TRUNCATE TABLE ledger_entries, transactions, wallet_fundings, webhook_events,
                   idempotency_keys, payouts, disputes, order_items, sub_orders,
                   orders, outbox, admin_audit_log
    CASCADE
  `);
  await knex('accounts').update({ balance_kobo: '0', status: 'ACTIVE' });
  await knex('accounts').where({ owner_type: 'USER' }).del();
}

async function close() {
  await mongoose.disconnect();
  await knex.destroy();
}

module.exports = { connect, clean, close, knex };
