const reviewsService = require('./reviews.service');

async function create(req, res) {
  const review = await reviewsService.create(req.params.id, req.user._id, req.body);
  res.status(201).json({ success: true, data: { review } });
}

async function list(req, res) {
  const { items, pagination } = await reviewsService.list(req.params.id, req.validated.query);
  res.json({ success: true, data: items, pagination });
}

module.exports = { create, list };
