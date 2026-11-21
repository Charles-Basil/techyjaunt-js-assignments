// One row per movement of money. Entries are APPEND-ONLY: to fix a mistake you
// post a new reversing transaction, you never edit or delete history.
exports.up = async (knex) => {
  await knex.schema.createTable('ledger_entries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('transaction_id').notNullable().references('id').inTable('transactions');
    t.uuid('account_id').notNullable().references('id').inTable('accounts');
    t.text('direction').notNullable().checkIn(['DEBIT', 'CREDIT'], 'ledger_entries_direction_check');
    t.bigInteger('amount_kobo').notNullable().checkPositive('ledger_entries_amount_positive');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('account_id');
    t.index('transaction_id');
  });

  // The database itself refuses UPDATE and DELETE, even if app code has a bug.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'ledger_entries is append-only: % is not allowed', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER ledger_entries_append_only
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();
  `);
};

exports.down = async (knex) => {
  // Dropping the table also drops its trigger.
  await knex.schema.dropTable('ledger_entries');
  await knex.raw('DROP FUNCTION IF EXISTS prevent_ledger_entry_mutation()');
};
