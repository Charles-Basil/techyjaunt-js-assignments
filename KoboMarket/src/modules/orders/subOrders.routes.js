// /api/v1/sub-orders/:id/... (one vendor's part of an order)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const validate = require('../../middlewares/validate');
const schemas = require('./orders.schemas');
const controller = require('./orders.controller');
const disputeSchemas = require('../disputes/disputes.schemas');
const disputesController = require('../disputes/disputes.controller');

const router = express.Router();
router.use(authenticate);

// Vendor actions: role by middleware; "is it MY sub-order" by orderPolicy in the service.
router.patch(
  '/:id/ship',
  requireRole('VENDOR'),
  validate({ params: schemas.uuidParam, body: schemas.shipBody }),
  controller.ship
);
router.patch(
  '/:id/deliver',
  requireRole('VENDOR'),
  validate({ params: schemas.uuidParam, body: schemas.emptyBody }),
  controller.deliver
);

// Buyer actions: any logged-in user, but only the sub-order's buyer passes the policy check.
router.patch('/:id/confirm', validate({ params: schemas.uuidParam, body: schemas.emptyBody }), controller.confirm);
router.post(
  '/:id/disputes',
  validate({ params: schemas.uuidParam, body: disputeSchemas.openBody }),
  disputesController.open
);

module.exports = router;
