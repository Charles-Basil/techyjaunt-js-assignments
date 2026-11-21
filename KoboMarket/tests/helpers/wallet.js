// Wallet helpers for tests (this block and later ones).
const { v4: uuid } = require('uuid');
const { knex } = require('../../src/config/knex');
const ledger = require('../../src/ledger/ledger.service');
const accountRepository = require('../../src/modules/wallet/account.repository');
const { toKoboNumber } = require('../../src/utils/money');

// Gives a user money WITHOUT going through Paystack: posts a real, balanced
// WALLET_FUNDING transaction through the ledger (DEBIT external, CREDIT wallet),
// so the ledger audit still passes afterwards.
async function fundWallet(userId, amountKobo) {
  const amount = BigInt(amountKobo);
  return knex.transaction(async (trx) => {
    const wallet = await ledger.getUserAccount(trx, userId);
    const external = await ledger.getSystemAccount(trx, 'PLATFORM_EXTERNAL_SETTLEMENT');
    return ledger.postTransaction(trx, {
      reference: `TEST_FUNDING:${uuid()}`,
      type: 'WALLET_FUNDING',
      metadata: { source: 'test-helper' },
      entries: [
        { accountId: external.id, direction: 'DEBIT', amountKobo: amount },
        { accountId: wallet.id, direction: 'CREDIT', amountKobo: amount },
      ],
    });
  });
}

// Current wallet balance as a plain number (0 if the wallet doesn't exist yet).
async function getBalance(userId) {
  const account = await accountRepository.findUserAccount(String(userId));
  return account ? toKoboNumber(account.balance_kobo) : 0;
}

async function getSystemBalance(code) {
  const account = await knex('accounts').where({ code }).first();
  return toKoboNumber(account.balance_kobo);
}

module.exports = { fundWallet, getBalance, getSystemBalance };
