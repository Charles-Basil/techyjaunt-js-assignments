const cartService = require('./cart.service');

async function getCart(req, res) {
  const cart = await cartService.getCart(req.user._id);
  res.json({ success: true, data: cart });
}

async function addItem(req, res) {
  const cart = await cartService.addItem(req.user._id, req.body);
  res.status(201).json({ success: true, data: cart });
}

async function updateItem(req, res) {
  const cart = await cartService.updateItem(req.user._id, req.params.itemId, req.body);
  res.json({ success: true, data: cart });
}

async function removeItem(req, res) {
  const cart = await cartService.removeItem(req.user._id, req.params.itemId);
  res.json({ success: true, data: cart });
}

module.exports = { getCart, addItem, updateItem, removeItem };
