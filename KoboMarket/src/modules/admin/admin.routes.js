const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const validate = require('../../middlewares/validate');
const { idParam } = require('../../utils/schemas');
const vendorSchemas = require('../vendors/vendor.schemas');
const vendorsController = require('../vendors/vendors.controller');

const router = express.Router();

// Every admin route requires a logged-in ADMIN.
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

module.exports = router;
