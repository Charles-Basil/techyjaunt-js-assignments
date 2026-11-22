// Who may see a payout: the vendor it belongs to, or an ADMIN. Others get 404.
const AppError = require('../utils/AppError');

function assertCanViewPayout(user, payout) {
  const allowed = payout && ((user.roles || []).includes('ADMIN') || payout.vendor_id === String(user._id));
  if (!allowed) throw new AppError('NOT_FOUND', 'Payout not found', 404);
}

module.exports = { assertCanViewPayout };
