const webhookService = require('./webhook.service');

async function paystack(req, res) {
  await webhookService.handlePaystackWebhook({
    rawBody: req.rawBody, // exact bytes, saved by express.json({ verify }) in app.js
    signature: req.get('x-paystack-signature'),
    payload: req.body,
  });
  // Always 200 for a valid signature, even if we ignored the event: otherwise
  // Paystack keeps retrying something we have deliberately decided not to act on.
  res.status(200).json({ received: true });
}

module.exports = { paystack };
