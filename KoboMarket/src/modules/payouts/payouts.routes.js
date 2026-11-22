// /api/v1/payouts
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const { notFrozen } = require('../../middlewares/notFrozen');
const { idempotency } = require('../../middlewares/idempotency');
const validate = require('../../middlewares/validate');
const { uuidParam } = require('../orders/orders.schemas');
const schemas = require('./payouts.schemas');
const controller = require('./payouts.controller');

const router = express.Router();
router.use(authenticate);

router.post(
  '/',
  requireRole('VENDOR'),
  notFrozen,
  idempotency(),
  validate({ body: schemas.createBody }),
  controller.request
);
router.get('/', requireRole('VENDOR'), validate({ query: schemas.listQuery }), controller.listMine);
// The owning vendor or an ADMIN: checked by payoutPolicy in the service.
router.get('/:id', validate({ params: uuidParam }), controller.getOne);

module.exports = router;
