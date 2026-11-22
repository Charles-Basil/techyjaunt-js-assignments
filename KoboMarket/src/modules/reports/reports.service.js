// Shapes the SQL report rows into API responses (kobo as safe integers).
const { knex } = require('../../config/knex');
const { toKoboBigInt, toKoboNumber } = require('../../utils/money');
const { findAccountMismatches } = require('../../ledger/audit');
const vendorRepository = require('../vendors/vendor.repository');
const reportsRepository = require('./reports.repository');

async function revenue({ from, to }) {
  const rows = await reportsRepository.revenueByDay(from, to);
  return {
    from,
    to,
    totalKobo: toKoboNumber(rows.length ? rows[0].total_kobo : '0'),
    days: rows.map((r) => ({ date: r.date, revenueKobo: toKoboNumber(r.revenue_kobo) })),
  };
}

async function topVendors({ month }) {
  const chosen = month || (await reportsRepository.currentLagosMonth());
  const rows = await reportsRepository.topVendors(`${chosen}-01`);

  // Store names live in MongoDB: ONE $in query for all ten vendors (no N+1).
  const profiles = await vendorRepository.findByUserIds(rows.map((r) => r.vendor_id));
  const storeByVendor = new Map(profiles.map((p) => [String(p.userId), p.storeName]));

  return {
    month: chosen,
    vendors: rows.map((r, index) => ({
      rank: index + 1,
      vendorId: r.vendor_id,
      storeName: storeByVendor.get(r.vendor_id) || null,
      completedCount: r.completed_count,
      grossKobo: toKoboNumber(r.gross_kobo),
      commissionKobo: toKoboNumber(r.commission_kobo),
      refundedKobo: toKoboNumber(r.refunded_kobo),
      netKobo: toKoboNumber(r.net_kobo),
    })),
  };
}

async function escrow() {
  const { breakdown, escrow_kobo: escrowKobo, open_total_kobo: openTotalKobo } = await reportsRepository.escrowBreakdown();
  return {
    escrowBalanceKobo: toKoboNumber(escrowKobo),
    openSubOrdersTotalKobo: toKoboNumber(openTotalKobo),
    // Every kobo in escrow belongs to an open sub-order, and vice versa.
    matches: toKoboBigInt(escrowKobo) === toKoboBigInt(openTotalKobo),
    breakdown: breakdown.map((b) => ({ status: b.status, count: b.count, totalKobo: toKoboNumber(b.total_kobo) })),
  };
}

async function reconciliation() {
  const rows = await findAccountMismatches(knex, 100);
  return {
    ok: rows.length === 0,
    mismatches: rows.map((r) => ({
      accountId: r.id,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      code: r.code,
      storedBalanceKobo: toKoboNumber(r.stored_balance),
      ledgerBalanceKobo: toKoboNumber(r.ledger_balance),
      differenceKobo: toKoboNumber(toKoboBigInt(r.stored_balance) - toKoboBigInt(r.ledger_balance)),
    })),
  };
}

module.exports = { revenue, topVendors, escrow, reconciliation };
