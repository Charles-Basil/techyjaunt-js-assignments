// /api/v1/wallet (always the caller's own wallet)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { notFrozen } = require('../../middlewares/notFrozen');
const { idempotency } = require('../../middlewares/idempotency');
const validate = require('../../middlewares/validate');
const schemas = require('./wallet.schemas');
const controller = require('./wallet.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.getWallet);
router.get('/transactions', validate({ query: schemas.transactionsQuery }), controller.listTransactions);
// Order matters: idempotency runs BEFORE validation, so a 400 for a bad body is
// stored and replayed too (same key + same body = same answer).
router.post('/fund', notFrozen, idempotency(), validate({ body: schemas.fundBody }), controller.fund);
router.get('/fundings/:reference', validate({ params: schemas.referenceParam }), controller.getFunding);

module.exports = router;
