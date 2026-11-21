// orders       -> what the buyer checked out (one per checkout)
// sub_orders   -> the part of an order belonging to ONE vendor (escrow is per sub-order)
// order_items  -> the products inside a sub-order, with the price frozen at checkout
const SUB_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
];

exports.up = async (knex) => {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('buyer_id').notNullable(); // Mongo user _id as a string
    t.text('status').notNullable();
    t.bigInteger('total_kobo').notNullable().checkPositive('orders_total_positive');
    t.text('idempotency_key').unique().nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('buyer_id');
  });

  await knex.schema.createTable('sub_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id').notNullable().references('id').inTable('orders');
    t.text('vendor_id').notNullable();
    t.text('status').notNullable().checkIn(SUB_ORDER_STATUSES, 'sub_orders_status_check');
    t.bigInteger('subtotal_kobo').notNullable().checkPositive('sub_orders_subtotal_positive');
    t.bigInteger('commission_kobo').nullable(); // set when the sub-order is completed
    t.timestamp('shipped_at', { useTz: true }).nullable();
    t.timestamp('delivered_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check('commission_kobo IS NULL OR commission_kobo >= 0', [], 'sub_orders_commission_non_negative');
    t.index('order_id');
    t.index('vendor_id');
    // Lets the escrow-timeout job quickly find "SHIPPED more than 72h ago".
    t.index(['status', 'shipped_at']);
  });

  await knex.schema.createTable('order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('sub_order_id').notNullable().references('id').inTable('sub_orders');
    t.text('product_id').notNullable();
    t.text('variant_id').nullable();
    t.text('name').notNullable(); // product name copied at checkout time
    t.bigInteger('unit_price_kobo').notNullable().checkPositive('order_items_unit_price_positive');
    t.integer('quantity').notNullable().checkPositive('order_items_quantity_positive');
    t.bigInteger('line_total_kobo').notNullable();

    // The database guarantees the line total is correct.
    t.check('line_total_kobo = unit_price_kobo * quantity', [], 'order_items_line_total_matches');
    t.index('sub_order_id');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('order_items');
  await knex.schema.dropTable('sub_orders');
  await knex.schema.dropTable('orders');
};
