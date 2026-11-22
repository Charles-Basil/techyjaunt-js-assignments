// /api/v1/admin
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const validate = require('../../middlewares/validate');
const { idParam } = require('../../utils/schemas');
const vendorSchemas = require('../vendors/vendor.schemas');
const vendorsController = require('../vendors/vendors.controller');
const schemas = require('./admin.schemas');
const controller = require('./admin.controller');

const router = express.Router();

// EVERY route below requires a logged-in ADMIN (router-level, so none can be forgotten).
router.use(authenticate, requireRole('ADMIN'));

// Only exists to test RBAC.
router.get('/ping', (req, res) => {
  res.json({ success: true, data: { message: 'pong (admin)' } });
});

// Vendor applications. :id here = the APPLICATION id (from the list below).
router.get('/vendors', validate({ query: vendorSchemas.adminListQuery }), vendorsController.listApplications);
router.patch(
  '/vendors/:id/approve',
  validate({ params: idParam, body: vendorSchemas.decisionBody }),
  vendorsController.decide
);

// Users
router.get('/users', validate({ query: schemas.usersQuery }), controller.listUsers);
router.patch('/users/:id/freeze', validate({ params: schemas.userIdParam, body: schemas.freezeBody }), controller.freezeUser);

// Ledger (read only)
router.get('/wallets/:id/ledger', validate({ params: schemas.accountIdParam, query: schemas.pageQuery }), controller.accountLedger);
router.get('/transactions', validate({ query: schemas.transactionsQuery }), controller.listTransactions);

// Settings and audit log
router.patch('/settings/commission', validate({ body: schemas.commissionBody }), controller.setCommission);
router.get('/audit-log', validate({ query: schemas.pageQuery }), controller.auditLog);

// Reports
router.get('/reports/revenue', validate({ query: schemas.revenueQuery }), controller.revenueReport);
router.get('/reports/top-vendors', validate({ query: schemas.topVendorsQuery }), controller.topVendorsReport);
router.get('/reports/escrow', controller.escrowReport);
router.get('/reports/reconciliation', controller.reconciliationReport);

module.exports = router;
