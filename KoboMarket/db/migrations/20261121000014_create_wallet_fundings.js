exports.up = (knex) =>
  knex.schema.createTable('wallet_fundings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('user_id').notNullable();
    t.uuid('account_id').notNullable().references('id').inTable('accounts');
    t.text('reference').notNullable().unique();
    t.bigInteger('amount_kobo').notNullable().checkPositive();
    t.specificType('currency', 'char(3)').notNullable().defaultTo('NGN');
    t.text('status').notNullable().checkIn(['PENDING', 'SUCCESS', 'FAILED']);
    t.text('provider').notNullable().defaultTo('paystack');
    t.uuid('transaction_id').nullable().references('id').inTable('transactions');
    t.text('failure_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('paid_at', { useTz: true }).nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
  });

exports.down = (knex) => knex.schema.dropTable('wallet_fundings');
