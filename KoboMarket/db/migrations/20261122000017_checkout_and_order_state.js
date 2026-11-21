// Block 5: checkout, escrow and the order state machine.
// Older migrations are never edited; everything here is additive.
const SUB_ORDER_STATUSES_V1 = ['PENDING_PAYMENT', 'PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED'];
const SUB_ORDER_STATUSES_V2 = [...SUB_ORDER_STATUSES_V1, 'REFUNDED'];
const ORDER_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

const inList = (values) => values.map((v) => `'${v}'`).join(', ');

exports.up = async (knex) => {
  // 1. sub_orders.status may now also be REFUNDED (full-refund disputes, next block).
  await knex.raw('ALTER TABLE sub_orders DROP CONSTRAINT sub_orders_status_check');
  await knex.raw(`ALTER TABLE sub_orders ADD CONSTRAINT sub_orders_status_check CHECK (status IN (${inList(SUB_ORDER_STATUSES_V2)}))`);

  // 2. New sub_orders columns. NOT NULL columns are added the safe way:
  //    add as nullable -> fill existing rows -> then require a value.
  await knex.schema.alterTable('sub_orders', (t) => {
    t.integer('commission_rate_bps').nullable();
    t.text('buyer_id').nullable(); // copy of orders.buyer_id for fast "is this my sub-order?" checks
    t.text('tracking_number').nullable();
    t.text('cancel_reason').nullable();
  });
  await knex.raw(`
    UPDATE sub_orders so SET
      buyer_id = o.buyer_id,
      commission_rate_bps = COALESCE((SELECT (value #>> '{}')::int FROM settings WHERE key = 'commission_rate_bps'), 500)
    FROM orders o
    WHERE o.id = so.order_id
  `);
  await knex.raw('ALTER TABLE sub_orders ALTER COLUMN commission_rate_bps SET NOT NULL');
  await knex.raw('ALTER TABLE sub_orders ALTER COLUMN buyer_id SET NOT NULL');
  await knex.schema.alterTable('sub_orders', (t) => {
    t.check('commission_rate_bps BETWEEN 0 AND 10000', [], 'sub_orders_commission_rate_range');
    t.index(['buyer_id']);
    t.index(['vendor_id', 'created_at', 'id'], 'sub_orders_vendor_list_index');
  });

  // 3. orders: stock bookkeeping across the two databases, and a status CHECK.
  await knex.schema.alterTable('orders', (t) => {
    t.text('stock_status').notNullable().defaultTo('PENDING');
    t.text('cancel_reason').nullable();
    t.check(`stock_status IN ('PENDING', 'DEDUCTED', 'RELEASED')`, [], 'orders_stock_status_check');
    t.check(`status IN (${inList(ORDER_STATUSES)})`, [], 'orders_status_check');
    t.index(['buyer_id', 'created_at', 'id'], 'orders_buyer_list_index');
  });
  // Rows from before this migration have already finished their stock step.
  await knex('orders').update({ stock_status: 'DEDUCTED' });
  // The stock recovery job looks for PENDING orders older than 5 minutes.
  await knex.raw("CREATE INDEX orders_stock_pending_index ON orders (created_at) WHERE stock_status = 'PENDING'");

  // 4. History of every status change. Append-only, like the ledger.
  await knex.schema.createTable('sub_order_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('sub_order_id').notNullable().references('id').inTable('sub_orders');
    t.text('from_status').nullable();
    t.text('to_status').notNullable();
    t.text('actor_id').notNullable(); // a user id, or 'SYSTEM' for jobs
    t.text('actor_role').notNullable(); // BUYER | VENDOR | ADMIN | SYSTEM
    t.text('note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['sub_order_id', 'created_at']);
  });
  // prevent_append_only_mutation() was created in migration 016.
  await knex.raw(`
    CREATE TRIGGER sub_order_events_append_only
    BEFORE UPDATE OR DELETE ON sub_order_events
    FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('sub_order_events');

  await knex.raw('DROP INDEX IF EXISTS orders_stock_pending_index');
  await knex.schema.alterTable('orders', (t) => {
    t.dropIndex(['buyer_id', 'created_at', 'id'], 'orders_buyer_list_index');
    t.dropChecks(['orders_stock_status_check', 'orders_status_check']);
    t.dropColumn('stock_status');
    t.dropColumn('cancel_reason');
  });

  await knex.schema.alterTable('sub_orders', (t) => {
    t.dropIndex(['vendor_id', 'created_at', 'id'], 'sub_orders_vendor_list_index');
    t.dropIndex(['buyer_id']);
    t.dropChecks(['sub_orders_commission_rate_range']);
    t.dropColumn('commission_rate_bps');
    t.dropColumn('buyer_id');
    t.dropColumn('tracking_number');
    t.dropColumn('cancel_reason');
  });
  // Fails (on purpose) if REFUNDED rows exist: they would break the old rule.
  await knex.raw('ALTER TABLE sub_orders DROP CONSTRAINT sub_orders_status_check');
  await knex.raw(`ALTER TABLE sub_orders ADD CONSTRAINT sub_orders_status_check CHECK (status IN (${inList(SUB_ORDER_STATUSES_V1)}))`);
};
