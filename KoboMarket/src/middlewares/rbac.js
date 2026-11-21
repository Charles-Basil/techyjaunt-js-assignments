// STUB — role-based access control. Will be finished with the auth block.
// Usage (later): router.post('/x', authenticate, requireRole('ADMIN'), handler)
// Expects authenticate() to have set req.user = { id, role }.
const AppError = require('../utils/AppError');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('UNAUTHENTICATED', 'Authentication required', 401));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 'You do not have permission for this action', 403));
    }
    next();
  };
}

module.exports = { requireRole };
