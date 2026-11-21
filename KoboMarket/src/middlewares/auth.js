// authenticate: requires "Authorization: Bearer <accessToken>".
// Verifies the JWT, then loads the user from MongoDB so we always use the
// CURRENT roles and status (e.g. a user frozen 1 minute ago is treated as frozen,
// even though their token was issued before that).
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const userRepository = require('../modules/users/user.repository');

function unauthorized(message = 'Authentication required') {
  return new AppError('UNAUTHORIZED', message, 401);
}

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  let payload;
  try {
    // algorithms: only accept the one we sign with (blocks "alg: none" tricks).
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch {
    return next(unauthorized('Invalid or expired access token'));
  }

  if (!mongoose.isValidObjectId(payload.sub)) return next(unauthorized('Invalid access token'));
  const user = await userRepository.findById(payload.sub);
  if (!user) return next(unauthorized('Invalid access token'));

  req.user = user; // the Mongoose document (secret fields are not loaded)
  next();
}

module.exports = { authenticate };
