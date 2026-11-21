// All MongoDB access for users goes through here.
// Services call these functions; they never use the User model directly.
const { User } = require('./user.model');

function create(data) {
  return User.create(data);
}

function findById(id) {
  return User.findById(id);
}

function findByEmail(email) {
  return User.findOne({ email });
}

// Login needs the password hash, which is hidden by default (select: false).
function findByEmailWithPassword(email) {
  return User.findOne({ email }).select('+passwordHash');
}

function updateProfile(id, fields) {
  // runValidators: apply the schema rules (trim, required...) to updates too.
  return User.findByIdAndUpdate(id, { $set: fields }, { returnDocument: 'after', runValidators: true });
}

// Find-and-update in ONE atomic step, so the same token can't be used twice
// by two requests racing each other.
function verifyEmailByTokenHash(tokenHash, now) {
  return User.findOneAndUpdate(
    { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: { $gt: now } },
    {
      $set: { isEmailVerified: true },
      $unset: { emailVerifyTokenHash: 1, emailVerifyExpiresAt: 1 },
    },
    { returnDocument: 'after' }
  );
}

function setPasswordResetToken(id, tokenHash, expiresAt) {
  return User.updateOne(
    { _id: id },
    { $set: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt } }
  );
}

function resetPasswordByTokenHash(tokenHash, now, passwordHash) {
  return User.findOneAndUpdate(
    { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: now } },
    {
      $set: { passwordHash },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    },
    { returnDocument: 'after' }
  );
}

// $addToSet adds the role only if the user doesn't already have it.
function addRole(id, role) {
  return User.updateOne({ _id: id }, { $addToSet: { roles: role } });
}

function markWalletCreated(id) {
  return User.updateOne({ _id: id }, { $set: { walletStatus: 'CREATED' } });
}

// Used by the wallet reconciler job.
function findPendingWallets(createdBefore, limit) {
  return User.find({ walletStatus: 'PENDING', createdAt: { $lt: createdBefore } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('_id');
}

module.exports = {
  create,
  findById,
  findByEmail,
  findByEmailWithPassword,
  updateProfile,
  verifyEmailByTokenHash,
  setPasswordResetToken,
  resetPasswordByTokenHash,
  addRole,
  markWalletCreated,
  findPendingWallets,
};
