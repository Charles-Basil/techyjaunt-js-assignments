// Transactional outbox: events (e.g. "order paid -> notify vendor") are written
// in the SAME Postgres transaction as the money change, then a worker sends them.
// So we never move money without recording the event, or vice versa.
exports.up = (knex) =>
  knex.schema.createTable('outbox', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('event_type').notNullable();
    t.jsonb('payload').notNullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('last_error').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('processed_at', { useTz: true }).nullable();

    t.index('status');
  });

exports.down = (knex) => knex.schema.dropTable('outbox');
