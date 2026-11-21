// STUB — real JWT verification is built in the auth block.
// It deliberately REJECTS every request ("fail closed"): if someone wires it
// onto a route too early, that route stays locked instead of wide open.
const AppError = require('../utils/AppError');

function authenticate(req, res, next) {
  next(new AppError('NOT_IMPLEMENTED', 'Authentication is not implemented yet', 501));
}

module.exports = { authenticate };
