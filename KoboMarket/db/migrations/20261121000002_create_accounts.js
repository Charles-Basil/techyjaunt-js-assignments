// A wallet/account in the ledger. Users get one per currency; the platform has
// SYSTEM accounts (escrow, revenue, payout clearing). ALL money is BIGINT kobo.
exports.up = (knex) =>
  knex.schema.createTable('accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('owner_type').notNullable().checkIn(['USER', 'SYSTEM'], 'accounts_owner_type_check');
    t.text('owner_id').notNullable();
    t.text('code').unique().nullable(); // only system accounts have a code
    t.specificType('currency', 'char(3)').notNullable().defaultTo('NGN');
    t.bigInteger('balance_kobo').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE').checkIn(['ACTIVE', 'FROZEN'], 'accounts_status_check');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // A user can never go below zero. System accounts may (e.g. a clearing account).
    t.check("owner_type = 'SYSTEM' OR balance_kobo >= 0", [], 'accounts_user_balance_non_negative');
    // One account per owner per currency.
    t.unique(['owner_type', 'owner_id', 'currency']);
  });

exports.down = (knex) => knex.schema.dropTable('accounts');
