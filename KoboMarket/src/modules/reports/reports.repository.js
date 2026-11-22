// Admin reports. Raw SQL with BOUND parameters (? placeholders, never string
// concatenation), and all the adding up happens in Postgres, not in JS loops.
// Money comes back as text (::text) so no BIGINT is ever squeezed through a JS number.
//
// Calendar days are Nigerian days: `(date)::timestamp AT TIME ZONE 'Africa/Lagos'`
// turns "2026-11-22 00:00 in Lagos" into the exact instant, so an entry at
// 23:30 UTC on the 21st (00:30 in Lagos on the 22nd) counts for the 22nd.
const { knex } = require('../../config/knex');

const LAGOS = 'Africa/Lagos';

// Revenue per day = credits - debits on PLATFORM_REVENUE. generate_series makes
// one row per day, so days without revenue appear with 0.
async function revenueByDay(from, to) {
  const { rows } = await knex.raw(
    `
    WITH days AS (
      SELECT d::date AS day
      FROM generate_series(?::date, ?::date, interval '1 day') AS d
    ),
    revenue AS (
      SELECT (le.created_at AT TIME ZONE '${LAGOS}')::date AS day,
             SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END) AS net
      FROM ledger_entries le
      JOIN accounts a ON a.id = le.account_id AND a.code = 'PLATFORM_REVENUE'
      WHERE le.created_at >= (?::date)::timestamp AT TIME ZONE '${LAGOS}'
        AND le.created_at <  (?::date + 1)::timestamp AT TIME ZONE '${LAGOS}'
      GROUP BY 1
    )
    SELECT to_char(days.day, 'YYYY-MM-DD')                  AS date,
           COALESCE(revenue.net, 0)::text                    AS revenue_kobo,
           (SUM(COALESCE(revenue.net, 0)) OVER ())::text     AS total_kobo
    FROM days
    LEFT JOIN revenue ON revenue.day = days.day
    ORDER BY days.day
  `,
    [from, to, from, to]
  );
  return rows;
}

async function currentLagosMonth() {
  const { rows } = await knex.raw(`SELECT to_char(now() AT TIME ZONE '${LAGOS}', 'YYYY-MM') AS month`);
  return rows[0].month;
}

// Top 10 vendors by COMPLETED sales completed in the month (Lagos time).
//   gross      = sum of sub-order subtotals
//   commission = what the platform kept
//   refunded   = partial refunds given back to buyers in disputes
//   net        = what the vendor was actually paid = gross - commission - refunded
async function topVendors(monthStart) {
  const { rows } = await knex.raw(
    `
    WITH bounds AS (
      SELECT (?::date)::timestamp AT TIME ZONE '${LAGOS}'                        AS start_at,
             ((?::date) + interval '1 month')::timestamp AT TIME ZONE '${LAGOS}' AS end_at
    )
    SELECT so.vendor_id,
           COUNT(*)::int                                                          AS completed_count,
           SUM(so.subtotal_kobo)::text                                            AS gross_kobo,
           SUM(COALESCE(so.commission_kobo, 0))::text                             AS commission_kobo,
           SUM(COALESCE(d.refund_kobo, 0))::text                                  AS refunded_kobo,
           (SUM(so.subtotal_kobo) - SUM(COALESCE(so.commission_kobo, 0))
              - SUM(COALESCE(d.refund_kobo, 0)))::text                            AS net_kobo
    FROM sub_orders so
    CROSS JOIN bounds b
    LEFT JOIN disputes d
      ON d.sub_order_id = so.id AND d.status = 'RESOLVED' AND d.resolution = 'PARTIAL_REFUND'
    WHERE so.status = 'COMPLETED'
      AND so.completed_at >= b.start_at
      AND so.completed_at <  b.end_at
    GROUP BY so.vendor_id
    ORDER BY SUM(so.subtotal_kobo) DESC, so.vendor_id
    LIMIT 10
  `,
    [monthStart, monthStart]
  );
  return rows;
}

const OPEN_STATUSES = ['PAID', 'SHIPPED', 'DELIVERED', 'DISPUTED'];

// Money in escrow vs the sub-orders that should account for it. Every open
// status is listed (VALUES ... LEFT JOIN), even with 0 sub-orders.
async function escrowBreakdown() {
  const breakdown = await knex.raw(
    `
    SELECT s.status,
           COUNT(so.id)::int                         AS count,
           COALESCE(SUM(so.subtotal_kobo), 0)::text  AS total_kobo
    FROM (VALUES ${OPEN_STATUSES.map(() => '(?)').join(', ')}) AS s(status)
    LEFT JOIN sub_orders so ON so.status = s.status
    GROUP BY s.status
    ORDER BY array_position(ARRAY[${OPEN_STATUSES.map(() => '?').join(', ')}]::text[], s.status)
  `,
    [...OPEN_STATUSES, ...OPEN_STATUSES]
  );
  const totals = await knex.raw(
    `
    SELECT (SELECT balance_kobo FROM accounts WHERE code = 'PLATFORM_ESCROW')::text AS escrow_kobo,
           (SELECT COALESCE(SUM(subtotal_kobo), 0) FROM sub_orders
             WHERE status IN (${OPEN_STATUSES.map(() => '?').join(', ')}))::text    AS open_total_kobo
  `,
    OPEN_STATUSES
  );
  return { breakdown: breakdown.rows, ...totals.rows[0] };
}

module.exports = { revenueByDay, currentLagosMonth, topVendors, escrowBreakdown, OPEN_STATUSES };
