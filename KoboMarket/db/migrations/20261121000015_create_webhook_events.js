exports.up = (knex) =>
  knex.schema.createTable('webhook_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('provider').notNullable();
    t.text('event').nullable();
    t.text('reference').nullable();
    t.boolean('signature_valid').notNullable();
    t.text('processing_result').nullable();
    t.jsonb('payload').nullable();
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTable('webhook_events');
