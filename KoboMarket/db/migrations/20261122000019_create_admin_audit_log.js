// Who did what, as an admin. Append-only like the ledger: a row can never be
// changed or removed, so the log can be trusted in a dispute about a decision.
exports.up = async (knex) => {
  await knex.schema.createTable('admin_audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('admin_id').notNullable();
    t.text('action').notNullable(); // e.g. VENDOR_APPROVED, USER_FROZEN, COMMISSION_CHANGED, DISPUTE_RESOLVED
    t.text('target_type').notNullable(); // VENDOR_APPLICATION | USER | SETTING | DISPUTE
    t.text('target_id').notNullable();
    t.jsonb('before').nullable();
    t.jsonb('after').nullable();
    t.text('note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['created_at', 'id'], 'admin_audit_log_list_index');
    t.index(['target_type', 'target_id']);
  });
  // prevent_append_only_mutation() was created in migration 016.
  await knex.raw(`
    CREATE TRIGGER admin_audit_log_append_only
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
  `);

  // Admin views of the ledger: all transactions by time and type.
  await knex.schema.alterTable('transactions', (t) => {
    t.index(['created_at', 'id'], 'transactions_list_index');
    t.index(['type', 'created_at'], 'transactions_type_index');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('transactions', (t) => {
    t.dropIndex(['created_at', 'id'], 'transactions_list_index');
    t.dropIndex(['type', 'created_at'], 'transactions_type_index');
  });
  await knex.schema.dropTable('admin_audit_log');
};
