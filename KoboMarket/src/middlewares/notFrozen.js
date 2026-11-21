// Blocks frozen accounts from money-moving actions (checkout, payouts...).
// Must run after authenticate. Usage: router.post('/checkout', authenticate, notFrozen, ...)
const AppError = require('../utils/AppError');

function notFrozen(req, res, next) {
  if (req.user && req.user.status === 'FROZEN') {
    return next(new AppError('ACCOUNT_FROZEN', 'This account is frozen', 403));
  }
  next();
}

module.exports = { notFrozen };
