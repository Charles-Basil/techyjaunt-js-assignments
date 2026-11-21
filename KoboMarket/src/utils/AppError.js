// An error we throw on purpose. The error handler turns it into:
// { success: false, error: { code, message, details } } with the given HTTP status.
class AppError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code; // machine-readable, e.g. 'INSUFFICIENT_FUNDS'
    this.statusCode = statusCode;
    this.details = details; // optional extra info for the client
  }
}

module.exports = AppError;
