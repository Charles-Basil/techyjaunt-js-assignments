// Role-based access control. The ONLY place roles are checked:
// controllers never look at req.user.roles themselves.
//
// Usage: router.get('/x', authenticate, requireRole('ADMIN'), handler)
// A user passes if they have AT LEAST ONE of the listed roles.
const AppError = require('../utils/AppError');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    }
    const userRoles = req.user.roles || [];
    if (!userRoles.some((role) => allowedRoles.includes(role))) {
      return next(new AppError('FORBIDDEN', 'You do not have permission for this action', 403));
    }
    next();
  };
}

module.exports = { requireRole };
