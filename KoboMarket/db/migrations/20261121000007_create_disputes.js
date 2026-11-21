// A buyer disputing a sub-order. While OPEN, the escrowed money is frozen.
exports.up = async (knex) => {
  await knex.schema.createTable('disputes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('sub_order_id').notNullable().references('id').inTable('sub_orders');
    t.text('buyer_id').notNullable();
    t.text('reason').notNullable();
    t.jsonb('evidence'); // e.g. list of image URLs and notes
    t.text('status').notNullable().defaultTo('OPEN').checkIn(['OPEN', 'RESOLVED'], 'disputes_status_check');
    t.text('resolution')
      .nullable()
      .checkIn(['FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED'], 'disputes_resolution_check');
    t.bigInteger('refund_kobo').nullable();
    t.text('resolved_by').nullable(); // admin user id
    t.text('resolution_note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true }).nullable();

    t.check('refund_kobo IS NULL OR refund_kobo > 0', [], 'disputes_refund_positive');
  });

  // Only one OPEN dispute per sub-order at a time.
  await knex.raw(`
    CREATE UNIQUE INDEX disputes_one_open_per_sub_order
    ON disputes (sub_order_id)
    WHERE status = 'OPEN'
  `);
};

exports.down = (knex) => knex.schema.dropTable('disputes');
