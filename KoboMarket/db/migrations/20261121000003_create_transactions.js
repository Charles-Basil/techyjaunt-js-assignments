// A transaction groups ledger entries that must balance (total debits = total credits).
exports.up = (knex) =>
  knex.schema.createTable('transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('reference').notNullable().unique(); // human/business reference, e.g. FUND-xxxx
    t.text('type').notNullable(); // e.g. WALLET_FUNDING, ORDER_PAYMENT, PAYOUT
    t.text('status').notNullable(); // e.g. PENDING, POSTED, FAILED
    t.text('idempotency_key').unique().nullable(); // NULLs don't clash with each other
    t.jsonb('metadata');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTable('transactions');
