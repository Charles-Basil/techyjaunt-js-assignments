const checkoutService = require('./checkout.service');
const ordersService = require('./orders.service');
const subOrdersService = require('./subOrders.service');

async function checkout(req, res) {
  const order = await checkoutService.placeOrder(req.user, {
    items: req.body.items, // undefined -> use the cart
    idempotencyKey: req.get('Idempotency-Key'), // already validated by the idempotency middleware
  });
  res.status(201).json({ success: true, data: { order } });
}

async function listMine(req, res) {
  const { items, pagination } = await ordersService.listMyOrders(req.user._id, req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function getOne(req, res) {
  const order = await ordersService.getOrderForUser(req.user, req.params.id);
  res.json({ success: true, data: { order } });
}

async function cancel(req, res) {
  const order = await ordersService.cancelOrder(req.user, req.params.id);
  res.json({ success: true, data: { order } });
}

async function listForVendor(req, res) {
  const { items, pagination } = await subOrdersService.listForVendor(req.user._id, req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function ship(req, res) {
  const subOrder = await subOrdersService.ship(req.user, req.params.id, req.body);
  res.json({ success: true, data: { subOrder } });
}

async function deliver(req, res) {
  const subOrder = await subOrdersService.deliver(req.user, req.params.id);
  res.json({ success: true, data: { subOrder } });
}

async function confirm(req, res) {
  const subOrder = await subOrdersService.confirm(req.user, req.params.id);
  res.json({ success: true, data: { subOrder } });
}

module.exports = { checkout, listMine, getOne, cancel, listForVendor, ship, deliver, confirm };
