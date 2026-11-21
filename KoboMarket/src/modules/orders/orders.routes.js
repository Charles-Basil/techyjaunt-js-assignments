// /api/v1/orders (buyers; ownership is checked by src/policies/orderPolicy.js)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { notFrozen } = require('../../middlewares/notFrozen');
const { idempotency } = require('../../middlewares/idempotency');
const validate = require('../../middlewares/validate');
const schemas = require('./orders.schemas');
const controller = require('./orders.controller');

const router = express.Router();
router.use(authenticate);

router.post('/checkout', notFrozen, idempotency(), validate({ body: schemas.checkoutBody }), controller.checkout);
router.get('/', validate({ query: schemas.listOrdersQuery }), controller.listMine);
router.get('/:id', validate({ params: schemas.uuidParam }), controller.getOne);
router.post(
  '/:id/cancel',
  notFrozen,
  validate({ params: schemas.uuidParam, body: schemas.emptyBody }),
  controller.cancel
);

module.exports = router;
