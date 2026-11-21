// All the auth rules live here. Controllers only translate HTTP <-> these functions.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const env = require('../../config/env');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const { generateToken, hashToken } = require('../../utils/tokens');
const { durationToMs } = require('../../utils/duration');
const userRepository = require('../users/user.repository');
const refreshTokenRepository = require('./refreshToken.repository');
const walletService = require('../wallet/wallet.service');
const mailer = require('../notifications/mailer.service');

const BCRYPT_COST = 12;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

// When the email doesn't exist we still run bcrypt.compare against this
// dummy hash, so "wrong email" and "wrong password" take the same time.
// Otherwise an attacker could time responses to find out which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

// ---------- helpers ----------

function signAccessToken(user) {
  return jwt.sign({ roles: user.roles }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id), // becomes the "sub" claim
    expiresIn: env.ACCESS_TOKEN_TTL,
    algorithm: 'HS256',
  });
}

// Creates a refresh token, stores ONLY its hash, returns the raw token to the client.
async function issueRefreshToken(userId, familyId, context) {
  const refreshToken = generateToken(64); // 64 random bytes
  await refreshTokenRepository.create({
    userId,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + durationToMs(env.REFRESH_TOKEN_TTL)),
    ip: context.ip,
    userAgent: context.userAgent,
  });
  return refreshToken;
}

function tokenResponse(accessToken, refreshToken) {
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: env.ACCESS_TOKEN_TTL };
}

// ---------- use cases ----------

async function register({ email, password, firstName, lastName, phone }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409);

  const verifyToken = generateToken();
  let user;
  try {
    user = await userRepository.create({
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      firstName,
      lastName,
      phone,
      emailVerifyTokenHash: hashToken(verifyToken),
      emailVerifyExpiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
    });
  } catch (err) {
    // 11000 = duplicate key: two registrations with the same email at the same time.
    if (err.code === 11000) {
      throw new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409);
    }
    throw err;
  }

  await mailer.sendVerificationEmail({ to: user.email, token: verifyToken });

  // The user exists now; the wallet is a second step in another database.
  // If it fails, registration still succeeds and the reconciler job retries.
  try {
    await walletService.ensureWallet(user._id);
    user.walletStatus = 'CREATED'; // keep the response in sync with the DB
  } catch (err) {
    logger.error({ err, userId: String(user._id) }, 'Wallet creation failed; reconciler will retry');
  }

  return user;
}

async function verifyEmail(token) {
  const user = await userRepository.verifyEmailByTokenHash(hashToken(token), new Date());
  if (!user) throw new AppError('INVALID_TOKEN', 'Verification link is invalid or has expired', 400);
  return user;
}

async function login({ email, password }, context) {
  const user = await userRepository.findByEmailWithPassword(email);
  const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !passwordOk) {
    throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
  }
  // Checked only after the password, so these don't reveal anything to a stranger.
  if (!user.isEmailVerified) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email before logging in', 403);
  }
  if (user.status === 'FROZEN') {
    throw new AppError('ACCOUNT_FROZEN', 'This account is frozen', 403);
  }

  const familyId = crypto.randomUUID(); // a new login starts a new token family
  const refreshToken = await issueRefreshToken(user._id, familyId, context);
  return tokenResponse(signAccessToken(user), refreshToken);
}

async function refresh(refreshToken, context) {
  const tokenHash = hashToken(refreshToken);
  const stored = await refreshTokenRepository.findByHash(tokenHash);

  if (!stored || stored.expiresAt <= new Date()) {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired', 401);
  }

  // Create the next token's value now so we can record it as "replacedByHash"
  // in the same atomic update that revokes the old one.
  const nextRefreshToken = generateToken(64);
  const nextHash = hashToken(nextRefreshToken);

  // null here means the token was ALREADY revoked: it is being reused.
  // A revoked token should never come back, so we assume it was stolen.
  const revoked = stored.revokedAt ? null : await refreshTokenRepository.revokeIfActive(tokenHash, nextHash);
  if (!revoked) {
    await refreshTokenRepository.revokeAllForUser(stored.userId);
    logger.warn(
      { userId: String(stored.userId), familyId: stored.familyId },
      'Refresh token reuse detected; all sessions revoked'
    );
    throw new AppError('TOKEN_REUSE_DETECTED', 'Session is no longer valid, please log in again', 401);
  }

  const user = await userRepository.findById(stored.userId);
  if (!user) throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired', 401);
  if (user.status === 'FROZEN') throw new AppError('ACCOUNT_FROZEN', 'This account is frozen', 403);

  // Same family as the old token (rotation inside one session).
  await refreshTokenRepository.create({
    userId: user._id,
    tokenHash: nextHash,
    familyId: stored.familyId,
    expiresAt: new Date(Date.now() + durationToMs(env.REFRESH_TOKEN_TTL)),
    ip: context.ip,
    userAgent: context.userAgent,
  });

  return tokenResponse(signAccessToken(user), nextRefreshToken);
}

async function logout(refreshToken) {
  // Whether or not the token existed, the result for the client is the same.
  await refreshTokenRepository.revokeIfActive(hashToken(refreshToken));
}

async function forgotPassword(email) {
  const user = await userRepository.findByEmail(email);
  if (!user) return; // say nothing: the controller returns the same 200 either way

  const resetToken = generateToken();
  await userRepository.setPasswordResetToken(
    user._id,
    hashToken(resetToken),
    new Date(Date.now() + PASSWORD_RESET_TTL_MS)
  );
  await mailer.sendPasswordResetEmail({ to: user.email, token: resetToken });
}

async function resetPassword({ token, newPassword }) {
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const user = await userRepository.resetPasswordByTokenHash(hashToken(token), new Date(), passwordHash);
  if (!user) throw new AppError('INVALID_TOKEN', 'Reset link is invalid or has expired', 400);

  // Log out every device: whoever knew the old password loses access.
  await refreshTokenRepository.revokeAllForUser(user._id);
}

module.exports = { register, verifyEmail, login, refresh, logout, forgotPassword, resetPassword };
