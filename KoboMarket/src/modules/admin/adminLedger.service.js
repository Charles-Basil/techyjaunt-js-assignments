// Admin: look inside the ledger (read only), change the commission rate, read the audit log.
const { knex } = require('../../config/knex');
const AppError = require('../../utils/AppError');
const { toKoboNumber } = require('../../utils/money');
const pagination = require('../../utils/pagination');
const accountRepository = require('../wallet/account.repository');
const userRepository = require('../users/user.repository');
const settingsRepository = require('../settings/settings.repository');
const adminAuditRepository = require('./adminAudit.repository');
const adminLedgerRepository = require('./adminLedger.repository');
const { groupBy } = require('../orders/order.mapper');

function entrySide(e) {
  return {
    accountId: e.account_id,
    accountCode: e.code,
    ownerType: e.owner_type,
    ownerId: e.owner_id,
    direction: e.direction,
    amountKobo: toKoboNumber(e.amount_kobo),
  };
}

function pageOf(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { page, pagination: { nextCursor: hasMore ? pagination.encodeCursor(last.cursor_created_at, last.id) : null, hasMore, limit } };
}

// One account: who owns it, its balance, and its full history. Each entry also
// shows the OTHER side(s) of its transaction, e.g. "CREDIT 95000 <- DEBIT escrow".
async function getAccountLedger(accountId, { limit, cursor }) {
  const account = await accountRepository.findById(accountId);
  if (!account) throw new AppError('NOT_FOUND', 'Account not found', 404);

  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const { page, pagination: pageInfo } = pageOf(await accountRepository.listEntries(account.id, { after, limit: limit + 1 }), limit);
  const counter = groupBy(
    await accountRepository.findCounterEntries([...new Set(page.map((e) => e.transaction_id))], account.id),
    'transaction_id'
  );

  let owner = null;
  if (account.owner_type === 'USER') {
    const user = await userRepository.findById(account.owner_id).catch(() => null);
    owner = user ? { id: String(user._id), email: user.email, name: `${user.firstName} ${user.lastName}` } : null;
  }

  return {
    account: {
      id: account.id,
      ownerType: account.owner_type,
      ownerId: account.owner_id,
      code: account.code,
      owner,
      currency: account.currency,
      balanceKobo: toKoboNumber(account.balance_kobo),
      status: account.status,
    },
    entries: page.map((e) => ({
      id: e.id,
      transactionId: e.transaction_id,
      reference: e.reference,
      type: e.type,
      direction: e.direction,
      amountKobo: toKoboNumber(e.amount_kobo),
      createdAt: e.created_at,
      metadata: e.metadata,
      counterEntries: (counter.get(e.transaction_id) || []).map(entrySide),
    })),
    pagination: pageInfo,
  };
}

async function listTransactions({ type, from, to, limit, cursor }) {
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const { page, pagination: pageInfo } = pageOf(
    await adminLedgerRepository.listTransactions({ type, from, to, after, limit: limit + 1 }),
    limit
  );
  const entries = groupBy(await adminLedgerRepository.findEntriesForTransactions(page.map((t) => t.id)), 'transaction_id');
  return {
    items: page.map((t) => ({
      id: t.id,
      reference: t.reference,
      type: t.type,
      status: t.status,
      metadata: t.metadata,
      createdAt: t.created_at,
      entries: (entries.get(t.id) || []).map(entrySide),
    })),
    pagination: pageInfo,
  };
}

// Only NEW checkouts read the new rate: each sub-order stored its own rate at checkout.
async function setCommissionRate(admin, commissionRateBps) {
  const before = await settingsRepository.getCommissionRateBps();
  await knex.transaction(async (trx) => {
    await settingsRepository.setCommissionRateBps(commissionRateBps, trx);
    await adminAuditRepository.record(trx, {
      adminId: admin._id,
      action: 'COMMISSION_CHANGED',
      targetType: 'SETTING',
      targetId: 'commission_rate_bps',
      before: { commissionRateBps: before },
      after: { commissionRateBps },
    });
  });
  return { commissionRateBps, previousCommissionRateBps: before };
}

async function listAuditLog({ limit, cursor }) {
  const after = cursor ? pagination.decodeSqlCursor(cursor) : null;
  const { page, pagination: pageInfo } = pageOf(await adminAuditRepository.list({ after, limit: limit + 1 }), limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      before: r.before,
      after: r.after,
      note: r.note,
      createdAt: r.created_at,
    })),
    pagination: pageInfo,
  };
}

module.exports = { getAccountLedger, listTransactions, setCommissionRate, listAuditLog };
