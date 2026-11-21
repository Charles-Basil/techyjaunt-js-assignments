// THE LEDGER. This file is the ONLY code allowed to insert ledger_entries or to
// change accounts.balance_kobo. Everything that moves money calls postTransaction.
//
// SIGN CONVENTION (every account, user or system):
//     balance_kobo = SUM(credits) - SUM(debits)
// A CREDIT increases the balance, a DEBIT decreases it.
//   Funding:  DEBIT PLATFORM_EXTERNAL_SETTLEMENT, CREDIT user wallet
//             (the external account goes negative: money that came in from outside)
// Each transaction's debits equal its credits, so the SUM of all balances is always 0.
const AppError = require('../utils/AppError');
const walletService = require('../modules/wallet/wallet.service');

const DIRECTIONS = new Set(['DEBIT', 'CREDIT']);

function unbalanced(message) {
  // 500, not 400: an unbalanced posting is a bug in OUR code, never a user mistake.
  return new AppError('LEDGER_UNBALANCED', message, 500);
}

function assertInTransaction(trx) {
  // knex.transaction(...) gives a trx with isTransaction === true.
  // The global knex instance does NOT have it, so passing it by mistake fails here.
  if (!trx || trx.isTransaction !== true) {
    throw new AppError('LEDGER_TRANSACTION_REQUIRED', 'Ledger calls must run inside a knex transaction', 500);
  }
}

// Checks every entry and returns the net change per account (credits - debits).
// Runs BEFORE any database write, so a bad posting writes nothing at all.
function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw unbalanced('A transaction needs at least 2 entries');
  }
  let debits = 0n;
  let credits = 0n;
  const netByAccount = new Map();

  for (const entry of entries) {
    if (!entry || !entry.accountId) throw unbalanced('Every entry needs an accountId');
    if (!DIRECTIONS.has(entry.direction)) throw unbalanced('Direction must be DEBIT or CREDIT');
    // Must be a BigInt: a JS number here would mean money was handled as a float somewhere.
    if (typeof entry.amountKobo !== 'bigint' || entry.amountKobo <= 0n) {
      throw unbalanced('Every amountKobo must be a positive BigInt');
    }

    if (entry.direction === 'DEBIT') debits += entry.amountKobo;
    else credits += entry.amountKobo;

    const signed = entry.direction === 'CREDIT' ? entry.amountKobo : -entry.amountKobo;
    netByAccount.set(entry.accountId, (netByAccount.get(entry.accountId) ?? 0n) + signed);
  }

  if (debits !== credits) {
    throw unbalanced(`Debits (${debits}) must equal credits (${credits})`);
  }
  return netByAccount;
}

// Postgres error -> our error. Anything unexpected is re-thrown unchanged.
function translateDbError(err) {
  // 23514 = check_violation. This CHECK (owner_type = 'SYSTEM' OR balance_kobo >= 0)
  // is what really stops a user wallet going negative, even under concurrency.
  if (err.code === '23514' && err.constraint === 'accounts_user_balance_non_negative') {
    return new AppError('INSUFFICIENT_FUNDS', 'Insufficient wallet balance', 402);
  }
  // 23505 = unique_violation on the transaction's reference or idempotency key.
  if (
    err.code === '23505' &&
    ['transactions_reference_unique', 'transactions_idempotency_key_unique'].includes(err.constraint)
  ) {
    return new AppError('DUPLICATE_TRANSACTION', 'This transaction has already been posted', 409);
  }
  return err;
}

/**
 * Posts one balanced transaction.
 * @param trx  a knex transaction (required)
 * @param input { reference, type, idempotencyKey?, metadata?, entries: [{ accountId, direction, amountKobo: bigint }] }
 * @returns { transaction, entries }
 */
async function postTransaction(trx, { reference, type, idempotencyKey = null, metadata = {}, entries }) {
  assertInTransaction(trx);
  const netByAccount = validateEntries(entries);
  if (!reference || !type) throw unbalanced('reference and type are required');

  // trx.transaction(...) inside a transaction = a SAVEPOINT. If anything below
  // fails, Postgres rolls back to the savepoint: none of this posting remains,
  // and the caller's outer transaction is still usable.
  try {
    return await trx.transaction(async (sp) => {
      // 1. Lock every involved account row. ORDER BY id means every transaction
      //    locks accounts in the same order, so two transfers between the same
      //    accounts can't each hold one lock and wait for the other (deadlock).
      const accountIds = [...netByAccount.keys()];
      const accounts = await sp('accounts').whereIn('id', accountIds).orderBy('id').forUpdate();
      if (accounts.length !== accountIds.length) {
        throw new AppError('LEDGER_ACCOUNT_NOT_FOUND', 'A ledger account does not exist', 500);
      }
      if (!metadata.allowFrozen && accounts.some((a) => a.status === 'FROZEN')) {
        throw new AppError('ACCOUNT_FROZEN', 'This account is frozen', 403);
      }

      // 2. The transaction header.
      const [transaction] = await sp('transactions')
        .insert({ reference, type, status: 'POSTED', idempotency_key: idempotencyKey, metadata })
        .returning('*');

      // 3. All entries in one INSERT. Amounts go to Postgres as strings (exact).
      const insertedEntries = await sp('ledger_entries')
        .insert(
          entries.map((e) => ({
            transaction_id: transaction.id,
            account_id: e.accountId,
            direction: e.direction,
            amount_kobo: e.amountKobo.toString(),
          }))
        )
        .returning('*');

      // 4. One UPDATE per account with its net change. The balance maths happens
      //    in Postgres (balance_kobo + change), never as a JS number.
      for (const account of accounts) {
        const change = netByAccount.get(account.id);
        if (change === 0n) continue;
        await sp('accounts')
          .where({ id: account.id })
          .update({ balance_kobo: sp.raw('balance_kobo + ?::bigint', [change.toString()]) });
      }

      return { transaction, entries: insertedEntries };
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

// A platform account by code, e.g. 'PLATFORM_ESCROW'. (No lock here: only
// postTransaction locks, always in id order.)
async function getSystemAccount(trx, code) {
  assertInTransaction(trx);
  const account = await trx('accounts').where({ owner_type: 'SYSTEM', code }).first();
  if (!account) throw new AppError('LEDGER_ACCOUNT_NOT_FOUND', `System account ${code} is missing`, 500);
  return account;
}

// The user's NGN wallet, created first if it doesn't exist yet.
async function getUserAccount(trx, userId) {
  assertInTransaction(trx);
  const where = { owner_type: 'USER', owner_id: String(userId), currency: 'NGN' };
  let account = await trx('accounts').where(where).first();
  if (!account) {
    // ensureWallet commits on its own connection (idempotent insert). Postgres'
    // default READ COMMITTED isolation lets this transaction see that row.
    await walletService.ensureWallet(String(userId));
    account = await trx('accounts').where(where).first();
  }
  if (!account) throw new AppError('LEDGER_ACCOUNT_NOT_FOUND', 'User wallet is missing', 500);
  return account;
}

module.exports = { postTransaction, getSystemAccount, getUserAccount };
