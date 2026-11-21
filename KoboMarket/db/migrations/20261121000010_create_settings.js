// Runtime-editable platform settings (an admin can change them without a redeploy).
exports.up = async (knex) => {
  await knex.schema.createTable('settings', (t) => {
    t.text('key').primary();
    t.jsonb('value').notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // 500 basis points = 5% commission. JSON.stringify(500) -> '500', a valid JSON value.
  await knex('settings').insert({ key: 'commission_rate_bps', value: JSON.stringify(500) });
};

exports.down = (knex) => knex.schema.dropTable('settings');
