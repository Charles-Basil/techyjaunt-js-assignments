// Remembers the response to a request sent with an Idempotency-Key header,
// so a retried request returns the same result instead of charging twice.
exports.up = (knex) =>
  knex.schema.createTable('idempotency_keys', (t) => {
    t.text('user_id').notNullable();
    t.text('endpoint').notNullable(); // e.g. 'POST /api/v1/wallet/fund'
    t.text('key').notNullable();
    t.text('request_hash').notNullable(); // detects the same key reused with a different body
    t.integer('response_status').nullable(); // null while the first request is still running
    t.jsonb('response_body').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Keys are scoped per user and per endpoint.
    t.primary(['user_id', 'endpoint', 'key']);
  });

exports.down = (knex) => knex.schema.dropTable('idempotency_keys');
