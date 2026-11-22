const adminUsersService = require('./adminUsers.service');
const adminLedgerService = require('./adminLedger.service');
const reportsService = require('../reports/reports.service');

// ---------- users ----------
async function listUsers(req, res) {
  const { items, pagination } = await adminUsersService.listUsers(req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function freezeUser(req, res) {
  const user = await adminUsersService.setFrozen(req.user, req.params.id, req.body);
  res.json({ success: true, data: { user } });
}

// ---------- ledger ----------
async function accountLedger(req, res) {
  const { account, entries, pagination } = await adminLedgerService.getAccountLedger(req.params.id, req.validated.query);
  res.json({ success: true, data: { account, entries }, pagination });
}

async function listTransactions(req, res) {
  const { items, pagination } = await adminLedgerService.listTransactions(req.validated.query);
  res.json({ success: true, data: items, pagination });
}

// ---------- settings / audit ----------
async function setCommission(req, res) {
  const result = await adminLedgerService.setCommissionRate(req.user, req.body.commissionRateBps);
  res.json({ success: true, data: result });
}

async function auditLog(req, res) {
  const { items, pagination } = await adminLedgerService.listAuditLog(req.validated.query);
  res.json({ success: true, data: items, pagination });
}

// ---------- reports ----------
async function revenueReport(req, res) {
  res.json({ success: true, data: await reportsService.revenue(req.validated.query) });
}

async function topVendorsReport(req, res) {
  res.json({ success: true, data: await reportsService.topVendors(req.validated.query) });
}

async function escrowReport(req, res) {
  res.json({ success: true, data: await reportsService.escrow() });
}

async function reconciliationReport(req, res) {
  res.json({ success: true, data: await reportsService.reconciliation() });
}

module.exports = {
  listUsers,
  freezeUser,
  accountLedger,
  listTransactions,
  setCommission,
  auditLog,
  revenueReport,
  topVendorsReport,
  escrowReport,
  reconciliationReport,
};
