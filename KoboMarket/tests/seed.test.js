const db = require('./helpers/db');
const { runSeed } = require('../src/seed/seed');
const { User } = require('../src/modules/users/user.model');
const { VendorProfile } = require('../src/modules/vendors/vendorProfile.model');
const { Product } = require('../src/modules/products/product.model');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(async () => {
  expect((await runAudit(knex)).pass).toBe(true);
  await db.close();
});

async function snapshot() {
  const [{ count: wallets }] = await knex('accounts').where({ owner_type: 'USER' }).count();
  const [{ count: fundings }] = await knex('transactions').where({ type: 'WALLET_FUNDING' }).count();
  return {
    users: await User.countDocuments(),
    admins: await User.countDocuments({ roles: 'ADMIN' }),
    vendors: await User.countDocuments({ roles: 'VENDOR' }),
    approvedStores: await VendorProfile.countDocuments({ status: 'APPROVED' }),
    products: await Product.countDocuments(),
    productsWithVariants: await Product.countDocuments({ 'variants.0': { $exists: true } }),
    wallets: Number(wallets),
    fundings: Number(fundings),
  };
}

describe('seed', () => {
  test('creates the demo data, funds buyers through the ledger, and the audit passes', async () => {
    const result = await runSeed();
    expect(result.alreadySeeded).toBe(false);
    expect(result.counts).toEqual({ admins: 1, vendors: 3, products: 20, buyers: 5 });
    expect(result.auditPass).toBe(true);

    expect(await snapshot()).toEqual({
      users: 9,
      admins: 1,
      vendors: 3,
      approvedStores: 3,
      products: 20,
      productsWithVariants: 4,
      wallets: 9,
      fundings: 5,
    });

    const buyers = result.accounts.filter((a) => a.email.startsWith('buyer'));
    expect(buyers).toHaveLength(5);
    expect(buyers.every((b) => b.balanceKobo === 5000000)).toBe(true);
    expect(await User.countDocuments({ isEmailVerified: false })).toBe(0);

    const categories = await Product.distinct('category');
    expect(categories.sort()).toEqual(['beauty', 'electronics', 'fashion', 'groceries', 'home']);
    // One store has a bank account ending in 0000 (the failed-payout demo).
    expect(await VendorProfile.countDocuments({ 'bankDetails.accountNumber': /0000$/ })).toBe(1);
  });

  test('running it twice does not duplicate anything', async () => {
    await runSeed();
    const first = await snapshot();
    const second = await runSeed();
    expect(second).toEqual({ alreadySeeded: true });
    expect(await snapshot()).toEqual(first);
  });
});
