// Seeds a demo marketplace. Used by scripts/seed.js (npm run seed) and by tests.
//
// - Idempotent: if the seed admin exists, it does nothing ("already seeded").
// - reset: true wipes the Mongo collections and the Postgres data first, then
//   re-creates the system accounts and settings (clean demo).
// - Buyers get money the REAL way: a WALLET_FUNDING ledger transaction
//   (DEBIT PLATFORM_EXTERNAL_SETTLEMENT, CREDIT wallet), so the audit passes.
const bcrypt = require('bcrypt');
const env = require('../config/env');
const { knex } = require('../config/knex');
const ledger = require('../ledger/ledger.service');
const { runAudit } = require('../ledger/audit');
const { slugWithSuffix } = require('../utils/slug');
const { toKoboNumber } = require('../utils/money');
const walletService = require('../modules/wallet/wallet.service');
const accountRepository = require('../modules/wallet/account.repository');
const { User } = require('../modules/users/user.model');
const { VendorProfile } = require('../modules/vendors/vendorProfile.model');
const { Product } = require('../modules/products/product.model');
const data = require('./seedData');

// Every Mongo collection the app uses (for --reset).
const MONGO_MODELS = [
  User,
  VendorProfile,
  Product,
  require('../modules/auth/refreshToken.model').RefreshToken,
  require('../modules/reviews/review.model').Review,
  require('../modules/cart/cart.model').Cart,
  require('../modules/notifications/notification.model').Notification,
  require('../mock-paystack/MockPaystackTransaction'),
  require('../mock-paystack/MockPaystackTransfer'),
];

const SYSTEM_ACCOUNTS = [
  'PLATFORM_ESCROW',
  'PLATFORM_REVENUE',
  'PLATFORM_PAYOUT_CLEARING',
  'PLATFORM_EXTERNAL_SETTLEMENT',
];

async function reset() {
  await Promise.all(MONGO_MODELS.map((Model) => Model.deleteMany({})));
  // TRUNCATE skips the append-only row triggers; CASCADE follows foreign keys.
  // knex_migrations is NOT touched, so the schema stays as it is.
  await knex.raw(`
    TRUNCATE TABLE ledger_entries, transactions, wallet_fundings, webhook_events, idempotency_keys,
                   payouts, disputes, sub_order_events, order_items, sub_orders, orders, outbox,
                   admin_audit_log, accounts, settings
    CASCADE
  `);
  await knex('accounts').insert(SYSTEM_ACCOUNTS.map((code) => ({ owner_type: 'SYSTEM', owner_id: code, code })));
  await knex('settings').insert({ key: 'commission_rate_bps', value: JSON.stringify(env.COMMISSION_RATE_BPS) });
}

async function createUser(passwordHash, { email, firstName, lastName }, roles) {
  const user = await User.create({ email, passwordHash, firstName, lastName, roles, isEmailVerified: true });
  await walletService.ensureWallet(user._id);
  return user;
}

async function fundBuyer(user) {
  const amount = BigInt(data.BUYER_FUNDING_KOBO);
  await knex.transaction(async (trx) => {
    const wallet = await ledger.getUserAccount(trx, user._id);
    const external = await ledger.getSystemAccount(trx, 'PLATFORM_EXTERNAL_SETTLEMENT');
    await ledger.postTransaction(trx, {
      reference: `SEED_FUNDING:${user.email}`, // unique: a buyer is never funded twice
      type: 'WALLET_FUNDING',
      metadata: { source: 'seed' },
      entries: [
        { accountId: external.id, direction: 'DEBIT', amountKobo: amount },
        { accountId: wallet.id, direction: 'CREDIT', amountKobo: amount },
      ],
    });
  });
}

/**
 * @param options.reset  wipe everything first
 * @param options.log    function(message) for progress output (default: silent)
 * @returns { alreadySeeded, counts, accounts, auditPass }
 */
async function runSeed({ reset: doReset = false, log = () => {} } = {}) {
  if (env.isProduction) throw new Error('Refusing to seed: NODE_ENV is production');

  if (doReset) {
    log('Resetting MongoDB collections and PostgreSQL data...');
    await reset();
  } else if (await User.exists({ email: data.admin.email })) {
    return { alreadySeeded: true };
  }

  const passwordHash = await bcrypt.hash(data.PASSWORD, env.BCRYPT_COST);

  log('Creating admin...');
  const admin = await createUser(passwordHash, data.admin, ['BUYER', 'ADMIN']);

  log('Creating vendors and their stores...');
  const vendorUsers = [];
  for (const v of data.vendors) {
    const user = await createUser(passwordHash, v, ['BUYER', 'VENDOR']);
    await VendorProfile.create({
      userId: user._id,
      storeName: v.storeName,
      storeSlug: v.storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description: v.description,
      bankDetails: v.bank,
      status: 'APPROVED',
      reviewedBy: admin._id,
      reviewedAt: new Date(),
    });
    vendorUsers.push(user);
  }

  log('Creating products...');
  for (const p of data.products) {
    const { vendor, ...fields } = p;
    await Product.create({ ...fields, vendorId: vendorUsers[vendor]._id, slug: slugWithSuffix(p.name) });
  }

  log('Creating and funding buyers...');
  const buyerUsers = [];
  for (const b of data.buyers) {
    const user = await createUser(passwordHash, b, ['BUYER']);
    await fundBuyer(user);
    buyerUsers.push(user);
  }

  const accounts = [];
  for (const user of [admin, ...vendorUsers, ...buyerUsers]) {
    const wallet = await accountRepository.findUserAccount(String(user._id));
    accounts.push({ email: user.email, roles: user.roles.join(','), balanceKobo: toKoboNumber(wallet.balance_kobo) });
  }

  const audit = await runAudit(knex);
  return {
    alreadySeeded: false,
    counts: {
      admins: 1,
      vendors: vendorUsers.length,
      products: data.products.length,
      buyers: buyerUsers.length,
    },
    accounts,
    auditPass: audit.pass,
  };
}

module.exports = { runSeed, PASSWORD: data.PASSWORD };
