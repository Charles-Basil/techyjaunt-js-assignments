// Wallets: creation (cross-database, see README "user -> wallet"), balance,
// history and starting a funding. Moving money is done by src/ledger only.
const { v4: uuid } = require('uuid');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const pagination = require('../../utils/pagination');
const { toKoboBigInt, toKoboNumber } = require('../../utils/money');
const accountRepository = require('./account.repository');
const fundingRepository = require('./funding.repository');
const userRepository = require('../users/user.repository');
const paystack = require('../../integrations/paystack/paystack.client');

async function ensureWallet(userId) {
  const id = String(userId);
  // Step 1: create the Postgres row (does nothing if it already exists).
  await accountRepository.insertUserAccountIfMissing(id);
  // Step 2: only after Postgres succeeded, mark the Mongo user as done.
  // If step 2 fails, the reconciler simply runs step 1 again: still one row.
  await userRepository.markWalletCreated(id);
}

// The user's wallet row. Lazy safety net: if registration and the reconciler
// both missed it, create it now.
async function getWalletAccount(userId) {
  const id = String(userId);
  let account = await accountRepository.findUserAccount(id);
  if (!account) {
    await ensureWallet(id);
    account = await accountRepository.findUserAccount(id);
  }
  return account;
}

async function getWallet(userId) {
  const account = await getWalletAccount(userId);
  return {
    accountId: account.id,
    currency: account.currency,
    balanceKobo: toKoboNumber(account.balance_kobo),
    status: account.status,
  };
}

async function listTransactions(userId, { limit, cursor }) {
  const account = await getWalletAccount(userId);
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;

  const rows = await accountRepository.listEntries(account.id, { after, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id, // the ledger entry id
      transactionId: row.transaction_id,
      reference: row.reference,
      type: row.type,
      direction: row.direction,
      amountKobo: toKoboNumber(row.amount_kobo),
      createdAt: row.created_at,
      metadata: row.metadata,
    })),
    pagination: {
      nextCursor: hasMore ? pagination.encodeCursor(last.cursor_created_at, last.id) : null,
      hasMore,
      limit,
    },
  };
}

// Step 1 of funding: record a PENDING funding and ask the provider for a
// payment page. No money moves here; the webhook credits the wallet later.
async function startFunding(user, amountKobo) {
  const account = await getWalletAccount(user._id);
  const amount = toKoboBigInt(amountKobo);
  const reference = `FUND_${uuid()}`;

  await fundingRepository.create({ userId: user._id, accountId: account.id, reference, amountKobo: amount });

  let payment;
  try {
    payment = await paystack.initializeTransaction({
      email: user.email,
      amountKobo: amount,
      reference,
      callbackUrl: `${env.APP_BASE_URL}/wallet/fundings/${reference}`,
    });
  } catch {
    // Nothing was charged. Close this attempt so it doesn't stay PENDING forever.
    await fundingRepository.markFailedIfPending(reference, 'Payment provider could not start the payment');
    // 502 is a 5xx, so the idempotency middleware lets the client retry with the same key.
    throw new AppError('PAYMENT_PROVIDER_ERROR', 'Could not start the payment, please try again', 502);
  }

  return {
    reference,
    amountKobo: toKoboNumber(amount),
    authorizationUrl: payment.authorizationUrl,
    status: 'PENDING',
  };
}

async function getFunding(userId, reference) {
  const funding = await fundingRepository.findForUser(userId, reference);
  if (!funding) throw new AppError('FUNDING_NOT_FOUND', 'Funding not found', 404);
  return {
    reference: funding.reference,
    amountKobo: toKoboNumber(funding.amount_kobo),
    currency: funding.currency,
    status: funding.status,
    failureReason: funding.failure_reason,
    createdAt: funding.created_at,
    paidAt: funding.paid_at,
  };
}

module.exports = { ensureWallet, getWalletAccount, getWallet, listTransactions, startFunding, getFunding };
