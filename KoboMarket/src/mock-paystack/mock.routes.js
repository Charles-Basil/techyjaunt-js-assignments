// /mock-paystack: only mounted when PAYSTACK_MODE=mock and NODE_ENV !== 'production' (see app.js).
const express = require('express');
const { z } = require('zod');
const validate = require('../middlewares/validate');
const mockService = require('./mock.service');

const referenceParam = z.object({ reference: z.string().min(1).max(100) });
const payBody = z
  .object({
    outcome: z.enum(['success', 'failed']).default('success'),
    duplicates: z.number().int().min(1).max(5).default(2),
  })
  .strict();

const router = express.Router();

router.get('/checkout/:reference', validate({ params: referenceParam }), async (req, res) => {
  res.json({ success: true, data: await mockService.getCheckout(req.params.reference) });
});

router.post('/checkout/:reference/pay', validate({ params: referenceParam, body: payBody }), async (req, res) => {
  res.json({ success: true, data: await mockService.pay(req.params.reference, req.body) });
});

module.exports = router;
