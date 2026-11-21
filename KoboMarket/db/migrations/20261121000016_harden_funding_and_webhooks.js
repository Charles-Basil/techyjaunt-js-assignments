// Migrations 013-015 already ran, so changes go in a NEW migration (never edit an applied one).
//
// 1. webhook_events becomes truly append-only (same idea as ledger_entries).
// 2. webhook_events.processing_note: a short human reason ("amount mismatch", ...).
// 3. A SUCCESS funding must point at its ledger transaction and have paid_at.
// 4. Index for the wallet history query: entries of one account, newest first.
exports.up = async (knex) => {
  await knex.schema.alterTable('webhook_events', (t) => {
    t.text('processing_note').nullable();
  });

  // Generic version of the ledger trigger: TG_TABLE_NAME names the table in the error.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_append_only_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER webhook_events_append_only
    BEFORE UPDATE OR DELETE ON webhook_events
    FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
  `);

  await knex.schema.alterTable('wallet_fundings', (t) => {
    t.check(
      "status <> 'SUCCESS' OR (transaction_id IS NOT NULL AND paid_at IS NOT NULL)",
      [],
      'wallet_fundings_success_has_transaction'
    );
  });

  await knex.schema.alterTable('ledger_entries', (t) => {
    t.index(['account_id', 'created_at', 'id'], 'ledger_entries_account_history_index');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('ledger_entries', (t) => {
    t.dropIndex(['account_id', 'created_at', 'id'], 'ledger_entries_account_history_index');
  });
  await knex.raw('ALTER TABLE wallet_fundings DROP CONSTRAINT wallet_fundings_success_has_transaction');
  await knex.raw('DROP TRIGGER IF EXISTS webhook_events_append_only ON webhook_events');
  await knex.raw('DROP FUNCTION IF EXISTS prevent_append_only_mutation()');
  await knex.schema.alterTable('webhook_events', (t) => {
    t.dropColumn('processing_note');
  });
};
