// Platform settings (settings table: key -> jsonb value).
const env = require('../../config/env');
const { knex } = require('../../config/knex');

// The commission rate in basis points (500 = 5%). Read inside the checkout
// transaction and COPIED onto each sub-order, so a later change by an admin
// never alters an order that was already placed.
async function getCommissionRateBps(db = knex) {
  const row = await db('settings').where({ key: 'commission_rate_bps' }).first();
  const value = row ? Number(row.value) : env.COMMISSION_RATE_BPS; // jsonb 500 -> 500
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error(`settings.commission_rate_bps is invalid: ${row && JSON.stringify(row.value)}`);
  }
  return value;
}

function setCommissionRateBps(bps, db = knex) {
  return db('settings')
    .insert({ key: 'commission_rate_bps', value: JSON.stringify(bps), updated_at: db.fn.now() })
    .onConflict('key')
    .merge();
}

module.exports = { getCommissionRateBps, setCommissionRateBps };
