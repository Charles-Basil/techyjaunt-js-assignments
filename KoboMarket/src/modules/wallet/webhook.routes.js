// /api/v1/webhooks: public (Paystack calls it), authenticated by the HMAC
// signature instead of a JWT. Mounted in app.js BEFORE the API rate limiter.
const express = require('express');
const controller = require('./webhook.controller');

const router = express.Router();

router.post('/paystack', controller.paystack);

module.exports = router;
