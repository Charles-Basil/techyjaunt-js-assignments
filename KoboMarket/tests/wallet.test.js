const db = require('./helpers/db');
const { register } = require('./helpers/auth');
const { User } = require('../src/modules/users/user.model');
const walletService = require('../src/modules/wallet/wallet.service');
const accountRepository = require('../src/modules/wallet/account.repository');
const walletReconciler = require('../src/jobs/walletReconciler.job');

beforeAll(db.connect);
beforeEach(db.clean);
afterEach(() => jest.restoreAllMocks());
afterAll(db.close);

function walletRows(userId) {
  return db.knex('accounts').where({ owner_type: 'USER', owner_id: userId });
}

describe('wallet creation', () => {
  // (d)
  test('registering creates exactly one wallet row in Postgres', async () => {
    const { user } = await register();
    const rows = await walletRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: 'NGN', status: 'ACTIVE', balance_kobo: '0' });
    expect(user.walletStatus).toBe('CREATED');
  });

  test('ensureWallet is idempotent (calling it again adds no rows)', async () => {
    const { user } = await register();
    await walletService.ensureWallet(user.id);
    await walletService.ensureWallet(user.id);
    expect(await walletRows(user.id)).toHaveLength(1);
  });

  test('if Postgres fails, registration still succeeds and the reconciler fixes it', async () => {
    jest
      .spyOn(accountRepository, 'insertUserAccountIfMissing')
      .mockRejectedValueOnce(new Error('postgres is down'));

    const { user } = await register();
    expect(user.walletStatus).toBe('PENDING');
    expect(await walletRows(user.id)).toHaveLength(0);

    // Pretend the user registered a minute ago (the job skips users younger than 30s).
    await User.collection.updateOne(
      { email: user.email },
      { $set: { createdAt: new Date(Date.now() - 60 * 1000) } }
    );

    const result = await walletReconciler.runOnce();
    expect(result).toEqual({ fixed: 1, failed: 0 });
    expect(await walletRows(user.id)).toHaveLength(1);
    const fresh = await User.findById(user.id);
    expect(fresh.walletStatus).toBe('CREATED');
  });
});
