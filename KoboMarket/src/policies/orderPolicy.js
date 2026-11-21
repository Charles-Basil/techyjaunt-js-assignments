// Who may see or act on an order. Kept here (not in controllers) so the rules
// live in one place. Not-allowed returns 404, not 403: a stranger shouldn't even
// learn that the order exists.
const AppError = require('../utils/AppError');

const notFound = () => new AppError('NOT_FOUND', 'Order not found', 404);

const isAdmin = (user) => (user.roles || []).includes('ADMIN');
const isSelf = (user, id) => String(user._id) === String(id);

// View: the buyer who placed it, or an ADMIN.
function assertCanViewOrder(user, order) {
  if (!order || !(isSelf(user, order.buyer_id) || isAdmin(user))) throw notFound();
}

// Buyer actions (cancel, confirm): only the buyer. Admins don't act for buyers here.
function assertIsBuyer(user, orderOrSubOrder) {
  if (!orderOrSubOrder || !isSelf(user, orderOrSubOrder.buyer_id)) throw notFound();
}

// Vendor actions (ship, deliver): only the vendor of that sub-order.
// 403 (not 404) because the vendor role is already proven by requireRole.
function assertIsVendorOf(user, subOrder) {
  if (!subOrder) throw new AppError('NOT_FOUND', 'Sub-order not found', 404);
  if (!isSelf(user, subOrder.vendor_id)) {
    throw new AppError('NOT_SUB_ORDER_OWNER', 'This sub-order belongs to another vendor', 403);
  }
}

module.exports = { assertCanViewOrder, assertIsBuyer, assertIsVendorOf };
