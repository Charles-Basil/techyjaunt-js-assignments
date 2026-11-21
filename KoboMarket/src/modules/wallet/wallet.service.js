// Creates a user's wallet (a row in Postgres "accounts") for a user stored in MongoDB.
// The two databases can't share a transaction, so we make this step safe to
// repeat instead. See README: "Cross-database consistency: user -> wallet".
const accountRepository = require('./account.repository');
const userRepository = require('../users/user.repository');

async function ensureWallet(userId) {
  const id = String(userId);
  // Step 1: create the Postgres row (does nothing if it already exists).
  await accountRepository.insertUserAccountIfMissing(id);
  // Step 2: only after Postgres succeeded, mark the Mongo user as done.
  // If step 2 fails, the reconciler simply runs step 1 again: still one row.
  await userRepository.markWalletCreated(id);
}

module.exports = { ensureWallet };
