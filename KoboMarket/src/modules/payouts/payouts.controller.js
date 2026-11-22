const payoutsService = require('./payouts.service');

async function request(req, res) {
  const payout = await payoutsService.requestPayout(req.user, req.body.amountKobo, req.get('Idempotency-Key'));
  res.status(201).json({ success: true, data: { payout } });
}

async function listMine(req, res) {
  const { items, pagination } = await payoutsService.listMine(req.user._id, req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function getOne(req, res) {
  const payout = await payoutsService.getForUser(req.user, req.params.id);
  res.json({ success: true, data: { payout } });
}

module.exports = { request, listMine, getOne };
