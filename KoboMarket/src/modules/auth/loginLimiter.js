// Brute-force protection for POST /auth/login.
// Max 5 FAILED attempts per 15 minutes for the same email from the same IP.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const AppError = require('../../utils/AppError');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  // Requests that end with status < 400 (a successful login) are not counted.
  skipSuccessfulRequests: true,
  // Key = "email:ip". ipKeyGenerator groups IPv6 addresses by network, so an
  // attacker can't dodge the limit by hopping between addresses in their range.
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${email}:${ipKeyGenerator(req.ip)}`;
  },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) =>
    next(new AppError('TOO_MANY_ATTEMPTS', 'Too many failed login attempts. Try again later.', 429)),
});

module.exports = loginLimiter;
