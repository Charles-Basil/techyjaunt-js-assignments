const AppError = require('../utils/AppError');

// Runs only when no route matched. Hands a 404 to the error handler.
function notFound(req, res, next) {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`, 404));
}

module.exports = notFound;
