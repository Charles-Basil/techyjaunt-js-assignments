// /api/v1/products (reviews are nested here too: /products/:id/reviews)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');
const validate = require('../../middlewares/validate');
const { idParam } = require('../../utils/schemas');
const schemas = require('./product.schemas');
const controller = require('./products.controller');
const reviewSchemas = require('../reviews/review.schemas');
const reviewsController = require('../reviews/reviews.controller');

const router = express.Router();
const vendorOnly = [authenticate, requireRole('VENDOR')];

// Public
router.get('/', validate({ query: schemas.listQuery }), controller.list);
router.get('/:slug', validate({ params: schemas.slugParam }), controller.getBySlug);

// Vendor (ownership is checked in the service)
router.post('/', ...vendorOnly, validate({ body: schemas.createBody }), controller.create);
router.patch('/:id', ...vendorOnly, validate({ params: idParam, body: schemas.updateBody }), controller.update);
router.delete('/:id', ...vendorOnly, validate({ params: idParam }), controller.remove);

// Reviews
router.get('/:id/reviews', validate({ params: idParam, query: reviewSchemas.listQuery }), reviewsController.list);
router.post(
  '/:id/reviews',
  authenticate,
  validate({ params: idParam, body: reviewSchemas.createBody }),
  reviewsController.create
);

module.exports = router;
