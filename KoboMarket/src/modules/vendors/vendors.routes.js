// /api/v1/vendors
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { notFrozen } = require('../../middlewares/notFrozen');
const validate = require('../../middlewares/validate');
const { idParam } = require('../../utils/schemas');
const { applyBody } = require('./vendor.schemas');
const controller = require('./vendors.controller');

const router = express.Router();

router.post('/apply', authenticate, notFrozen, validate({ body: applyBody }), controller.apply);
// :id = the vendor's user id (the same value products have in vendorId)
router.get('/:id', validate({ params: idParam }), controller.getPublicProfile);

module.exports = router;
