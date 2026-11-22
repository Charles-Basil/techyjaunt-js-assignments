// /api/v1/disputes (opening one is under /sub-orders/:id/disputes)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const validate = require('../../middlewares/validate');
const { uuidParam } = require('../orders/orders.schemas');
const schemas = require('./disputes.schemas');
const controller = require('./disputes.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', requireRole('ADMIN'), validate({ query: schemas.listQuery }), controller.list);
// ADMIN, the buyer or the vendor: checked by disputePolicy in the service.
router.get('/:id', validate({ params: uuidParam }), controller.getOne);
router.patch(
  '/:id/resolve',
  requireRole('ADMIN'),
  validate({ params: uuidParam, body: schemas.resolveBody }),
  controller.resolve
);

module.exports = router;
