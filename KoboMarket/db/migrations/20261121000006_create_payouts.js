// A vendor withdrawing money from their wallet to their bank.
exports.up = async (knex) => {
  await knex.schema.createTable('payouts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('vendor_id').notNullable();
    t.uuid('account_id').notNullable().references('id').inTable('accounts');
    t.bigInteger('amount_kobo').notNullable().checkPositive('payouts_amount_positive');
    t.text('status')
      .notNullable()
      .checkIn(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'], 'payouts_status_check');
    t.text('provider_reference').nullable(); // Paystack transfer reference
    t.text('failure_reason').nullable();
    t.text('idempotency_key').unique().nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('vendor_id');
  });

  // Partial unique index: a vendor can have at most ONE payout in flight.
  // Finished payouts (SUCCESS/FAILED) are not covered, so history is unlimited.
  await knex.raw(`
    CREATE UNIQUE INDEX payouts_one_active_per_vendor
    ON payouts (vendor_id)
    WHERE status IN ('PENDING', 'PROCESSING')
  `);
};

exports.down = (knex) => knex.schema.dropTable('payouts');
