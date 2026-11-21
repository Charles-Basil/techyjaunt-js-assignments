const db = require('./helpers/db');
const { register } = require('./helpers/auth');
const { fundWallet, getBalance, getSystemBalance } = require('./helpers/wallet');
const ledger = require('../src/ledger/ledger.service');
const { runAudit } = require('../src/ledger/audit');

const { knex } = db;

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

async function counts() {
  const [{ count: transactions }] = await knex('transactions').count();
  const [{ count: entries }] = await knex('ledger_entries').count();
  return { transactions: Number(transactions), entries: Number(entries) };
}

// Posts "move `amount` from the user's wallet to escrow" (DEBIT wallet, CREDIT escrow).
function debitWalletToEscrow(userId, amount, reference = `TEST_DEBIT:${Date.now()}:${Math.random()}`) {
  return knex.transaction(async (trx) => {
    const wallet = await ledger.getUserAccount(trx, userId);
    const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
    return ledger.postTransaction(trx, {
      reference,
      type: 'TEST_DEBIT',
      entries: [
        { accountId: wallet.id, direction: 'DEBIT', amountKobo: amount },
        { accountId: escrow.id, direction: 'CREDIT', amountKobo: amount },
      ],
    });
  });
}

describe('ledger.postTransaction', () => {
  let user;
  beforeEach(async () => {
    ({ user } = await register());
    await fundWallet(user.id, 10000);
  });

  test('a valid posting updates balances by credits - debits', async () => {
    await debitWalletToEscrow(user.id, 2500n);
    expect(await getBalance(user.id)).toBe(7500);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(2500);
    expect(await getSystemBalance('PLATFORM_EXTERNAL_SETTLEMENT')).toBe(-10000);
    expect((await runAudit(knex)).pass).toBe(true);
  });

  test('unbalanced entries throw LEDGER_UNBALANCED and write nothing', async () => {
    const before = await counts();
    const attempt = knex.transaction(async (trx) => {
      const wallet = await ledger.getUserAccount(trx, user.id);
      const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
      return ledger.postTransaction(trx, {
        reference: 'UNBALANCED_1',
        type: 'TEST',
        entries: [
          { accountId: wallet.id, direction: 'DEBIT', amountKobo: 1000n },
          { accountId: escrow.id, direction: 'CREDIT', amountKobo: 999n },
        ],
      });
    });
    await expect(attempt).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED', statusCode: 500 });
    expect(await counts()).toEqual(before);
    expect(await getBalance(user.id)).toBe(10000);
  });

  test('rejects bad entries: one entry, zero amount, JS numbers instead of BigInt', async () => {
    const run = (entries) =>
      knex.transaction(async (trx) => {
        const wallet = await ledger.getUserAccount(trx, user.id);
        const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
        return ledger.postTransaction(trx, { reference: `BAD_${Math.random()}`, type: 'TEST', entries: entries(wallet, escrow) });
      });
    await expect(run((w) => [{ accountId: w.id, direction: 'CREDIT', amountKobo: 1n }])).rejects.toMatchObject({
      code: 'LEDGER_UNBALANCED',
    });
    await expect(
      run((w, e) => [
        { accountId: w.id, direction: 'DEBIT', amountKobo: 0n },
        { accountId: e.id, direction: 'CREDIT', amountKobo: 0n },
      ])
    ).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
    await expect(
      run((w, e) => [
        { accountId: w.id, direction: 'DEBIT', amountKobo: 100 },
        { accountId: e.id, direction: 'CREDIT', amountKobo: 100 },
      ])
    ).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
  });

  test('must be called inside a knex transaction', async () => {
    await expect(
      ledger.postTransaction(knex, { reference: 'X', type: 'TEST', entries: [] })
    ).rejects.toMatchObject({ code: 'LEDGER_TRANSACTION_REQUIRED' });
  });

  test('debiting a wallet below zero throws INSUFFICIENT_FUNDS and writes nothing', async () => {
    const before = await counts();
    await expect(debitWalletToEscrow(user.id, 10001n)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      statusCode: 402,
    });
    expect(await counts()).toEqual(before); // no transaction row, no entries
    expect(await getBalance(user.id)).toBe(10000);
    expect(await getSystemBalance('PLATFORM_ESCROW')).toBe(0);
  });

  test('a failed posting leaves the caller’s outer transaction usable (savepoint)', async () => {
    await knex.transaction(async (trx) => {
      const wallet = await ledger.getUserAccount(trx, user.id);
      const escrow = await ledger.getSystemAccount(trx, 'PLATFORM_ESCROW');
      const tooMuch = { accountId: wallet.id, direction: 'DEBIT', amountKobo: 50000n };
      await expect(
        ledger.postTransaction(trx, {
          reference: 'TOO_MUCH',
          type: 'TEST',
          entries: [tooMuch, { accountId: escrow.id, direction: 'CREDIT', amountKobo: 50000n }],
        })
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
      // Same outer transaction keeps working after the error:
      await ledger.postTransaction(trx, {
        reference: 'SMALL_ENOUGH',
        type: 'TEST',
        entries: [
          { accountId: wallet.id, direction: 'DEBIT', amountKobo: 3000n },
          { accountId: escrow.id, direction: 'CREDIT', amountKobo: 3000n },
        ],
      });
    });
    expect(await getBalance(user.id)).toBe(7000);
    expect(await knex('transactions').where({ reference: 'TOO_MUCH' }).first()).toBeUndefined();
  });

  test('a reused reference throws DUPLICATE_TRANSACTION', async () => {
    await debitWalletToEscrow(user.id, 100n, 'SAME_REF');
    await expect(debitWalletToEscrow(user.id, 100n, 'SAME_REF')).rejects.toMatchObject({
      code: 'DUPLICATE_TRANSACTION',
      statusCode: 409,
    });
    expect(await getBalance(user.id)).toBe(9900);
  });

  test('a FROZEN account is rejected unless metadata.allowFrozen is true', async () => {
    await knex('accounts').where({ owner_id: user.id }).update({ status: 'FROZEN' });
    await expect(debitWalletToEscrow(user.id, 100n)).rejects.toMatchObject({ code: 'ACCOUNT_FROZEN', statusCode: 403 });

    await knex.transaction(async (trx) => {
      const wallet = await ledger.getUserAccount(trx, user.id);
      const external = await ledger.getSystemAccount(trx, 'PLATFORM_EXTERNAL_SETTLEMENT');
      await ledger.postTransaction(trx, {
        reference: 'FROZEN_OK',
        type: 'WALLET_FUNDING',
        metadata: { allowFrozen: true },
        entries: [
          { accountId: external.id, direction: 'DEBIT', amountKobo: 500n },
          { accountId: wallet.id, direction: 'CREDIT', amountKobo: 500n },
        ],
      });
    });
    expect(await getBalance(user.id)).toBe(10500);
  });

  test('two concurrent debits that together overdraw: exactly one succeeds', async () => {
    // 10000 in the wallet; two parallel debits of 6000. The row lock makes the
    // second one wait, then the CHECK constraint rejects it.
    const results = await Promise.allSettled([
      debitWalletToEscrow(user.id, 6000n, 'RACE_A'),
      debitWalletToEscrow(user.id, 6000n, 'RACE_B'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('INSUFFICIENT_FUNDS');
    expect(await getBalance(user.id)).toBe(4000);
    expect((await runAudit(knex)).pass).toBe(true);
  });
});

describe('append-only ledger (database trigger)', () => {
  test('UPDATE and DELETE on ledger_entries are rejected by Postgres', async () => {
    const { user } = await register();
    await fundWallet(user.id, 10000);
    const entry = await knex('ledger_entries').first();

    await expect(knex('ledger_entries').where({ id: entry.id }).update({ amount_kobo: '1' })).rejects.toThrow(
      /append-only: UPDATE is not allowed/
    );
    await expect(knex('ledger_entries').where({ id: entry.id }).del()).rejects.toThrow(
      /append-only: DELETE is not allowed/
    );
    const unchanged = await knex('ledger_entries').where({ id: entry.id }).first();
    expect(unchanged.amount_kobo).toBe('10000');
  });

  test('webhook_events is append-only too', async () => {
    await knex('webhook_events').insert({ provider: 'test', signature_valid: false });
    await expect(knex('webhook_events').update({ provider: 'x' })).rejects.toThrow(/append-only/);
    await expect(knex('webhook_events').del()).rejects.toThrow(/append-only/);
  });
});

describe('ledger audit', () => {
  test('passes on a clean ledger and catches a tampered balance', async () => {
    const { user } = await register();
    await fundWallet(user.id, 25000);
    expect((await runAudit(knex)).pass).toBe(true);

    // Simulate a bug that changes a balance without a ledger entry.
    await knex('accounts').where({ owner_id: user.id }).update({ balance_kobo: '99999' });
    const audit = await runAudit(knex);
    expect(audit.pass).toBe(false);
    const byName = Object.fromEntries(audit.checks.map((c) => [c.name, c.pass]));
    expect(byName['Every transaction is balanced (debits = credits)']).toBe(true);
    expect(byName['Every account balance matches its ledger entries']).toBe(false);
    expect(byName['Sum of all account balances is 0']).toBe(false);
  });
});
