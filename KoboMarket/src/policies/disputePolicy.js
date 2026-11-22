// Who may see a dispute: an ADMIN, the buyer who opened it, or the vendor of
// that sub-order. Anyone else gets 404 (they shouldn't learn it exists).
const AppError = require('../utils/AppError');

function assertCanViewDispute(user, dispute) {
  const id = String(user._id);
  const allowed =
    dispute && ((user.roles || []).includes('ADMIN') || dispute.buyer_id === id || dispute.vendor_id === id);
  if (!allowed) throw new AppError('NOT_FOUND', 'Dispute not found', 404);
}

module.exports = { assertCanViewDispute };
