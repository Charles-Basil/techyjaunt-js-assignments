// Admin: find users, freeze / unfreeze them.
const { knex } = require('../../config/knex');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const pagination = require('../../utils/pagination');
const userRepository = require('../users/user.repository');
const refreshTokenRepository = require('../auth/refreshToken.repository');
const accountRepository = require('../wallet/account.repository');
const adminAuditRepository = require('./adminAudit.repository');

// A search box must never become a regular expression: "a.*" should look for
// the characters a . * literally, not "a followed by anything" (and a crafted
// pattern can't make MongoDB do huge amounts of work).
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listUsers({ q, role, status, limit, cursor }) {
  const filter = {};
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }];
  }
  if (role) filter.roles = role;
  if (status) filter.status = status;
  if (cursor) {
    // $and: the cursor's own $or must not replace the search $or above.
    filter.$and = [pagination.afterCursorFilter('createdAt', -1, pagination.decodeCursor(cursor, pagination.parseDate))];
  }
  const docs = await userRepository.listForAdmin(filter, pagination.sortSpec('createdAt', -1), limit + 1);
  return pagination.buildPage(docs, limit, 'createdAt');
}

/**
 * Freezes or unfreezes a user in BOTH databases:
 *   1. MongoDB  user.status          (blocks login, checkout, funding, payouts via notFrozen)
 *   2. Postgres accounts.status      (the ledger refuses to move money on a FROZEN account)
 *               + an admin_audit_log row, in the same Postgres transaction
 * If step 2 fails, step 1 is put back, so the two databases never disagree.
 */
async function setFrozen(admin, userId, { frozen, reason }) {
  if (String(admin._id) === String(userId)) {
    throw new AppError('CANNOT_FREEZE_SELF', 'You cannot freeze your own account', 400);
  }
  const user = await userRepository.findById(userId);
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);

  const before = user.status;
  const after = frozen ? 'FROZEN' : 'ACTIVE';

  await userRepository.setStatus(userId, after);
  try {
    await knex.transaction(async (trx) => {
      await accountRepository.setOwnerStatus(trx, userId, after);
      await adminAuditRepository.record(trx, {
        adminId: admin._id,
        action: frozen ? 'USER_FROZEN' : 'USER_UNFROZEN',
        targetType: 'USER',
        targetId: userId,
        before: { status: before },
        after: { status: after },
        note: reason,
      });
    });
  } catch (err) {
    // Undo step 1 so Mongo and Postgres agree again.
    await userRepository.setStatus(userId, before).catch((revertErr) => {
      logger.fatal({ err: revertErr, userId }, 'Could not revert user status: Mongo and Postgres disagree');
    });
    logger.error({ err, userId }, 'Freeze failed in Postgres; reverted');
    throw new AppError('FREEZE_FAILED', 'Could not update the user; nothing was changed', 500);
  }

  // A frozen user is logged out everywhere (their access token dies within 15 min
  // anyway, and authenticate re-reads the status on every request).
  if (frozen) await refreshTokenRepository.revokeAllForUser(userId);
  return userRepository.findById(userId);
}

module.exports = { listUsers, setFrozen, escapeRegex };
