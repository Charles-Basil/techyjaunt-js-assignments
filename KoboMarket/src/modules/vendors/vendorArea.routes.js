// /api/v1/vendor: the logged-in vendor's own area.
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const validate = require('../../middlewares/validate');
const orderSchemas = require('../orders/orders.schemas');
const ordersController = require('../orders/orders.controller');

const router = express.Router();

// Every vendor route requires a logged-in VENDOR.
router.use(authenticate, requireRole('VENDOR'));

// Only exists to test RBAC.
router.get('/ping', (req, res) => {
  res.json({ success: true, data: { message: 'pong (vendor)' } });
});

// The sub-orders this vendor has to fulfil.
router.get('/sub-orders', validate({ query: orderSchemas.listSubOrdersQuery }), ordersController.listForVendor);

module.exports = router;
