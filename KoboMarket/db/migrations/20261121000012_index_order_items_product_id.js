// The review-eligibility check looks up order_items by product_id.
// Without this index Postgres would scan the whole order_items table.
exports.up = (knex) =>
  knex.schema.alterTable('order_items', (t) => {
    t.index('product_id');
  });

exports.down = (knex) =>
  knex.schema.alterTable('order_items', (t) => {
    t.dropIndex('product_id');
  });
