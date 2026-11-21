const productsService = require('./products.service');

async function create(req, res) {
  const product = await productsService.create(req.user._id, req.body);
  res.status(201).json({ success: true, data: { product } });
}

async function update(req, res) {
  const product = await productsService.update(req.params.id, req.user._id, req.body);
  res.json({ success: true, data: { product } });
}

async function remove(req, res) {
  await productsService.remove(req.params.id, req.user._id);
  res.json({ success: true, data: { message: 'Product deleted' } });
}

async function getBySlug(req, res) {
  const product = await productsService.getBySlug(req.params.slug);
  res.json({ success: true, data: { product } });
}

async function list(req, res) {
  const { items, pagination } = await productsService.list(req.validated.query);
  res.json({ success: true, data: items, pagination });
}

module.exports = { create, update, remove, getBySlug, list };
