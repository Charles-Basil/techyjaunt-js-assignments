const { ZodError } = require('zod');
const AppError = require('../utils/AppError');
const env = require('../config/env');

function sendError(res, statusCode, code, message, details = null) {
  res.status(statusCode).json({ success: false, error: { code, message, details } });
}

// Express knows this is an error handler because it has 4 arguments.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // 1. Validation errors from zod (see middlewares/validate.js)
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  // 2. Errors we threw on purpose
  if (err instanceof AppError) {
    if (err.statusCode >= 500) req.log.error({ err }, err.message);
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  // 3. Body parser errors (bad JSON, body over 1mb)
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  // 4. Anything else is a bug: log it fully, but don't leak internals in production.
  req.log.error({ err }, 'Unhandled error');
  const message = env.isProduction ? 'Something went wrong' : err.message;
  const details = env.isProduction ? null : { stack: err.stack };
  return sendError(res, 500, 'INTERNAL_ERROR', message, details);
}

module.exports = errorHandler;
