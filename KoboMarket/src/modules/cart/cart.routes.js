// /api/v1/cart (every route needs a logged-in user; the cart is always the caller's own)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const schemas = require('./cart.schemas');
const controller = require('./cart.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.getCart);
router.post('/items', validate({ body: schemas.addItemBody }), controller.addItem);
router.patch(
  '/items/:itemId',
  validate({ params: schemas.itemParam, body: schemas.updateItemBody }),
  controller.updateItem
);
router.delete('/items/:itemId', validate({ params: schemas.itemParam }), controller.removeItem);

module.exports = router;
