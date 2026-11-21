const { RefreshToken } = require('./refreshToken.model');

function create(data) {
  return RefreshToken.create(data);
}

function findByHash(tokenHash) {
  return RefreshToken.findOne({ tokenHash });
}

// Atomically revoke ONE token, but only if it is still active.
// Returns the token if WE revoked it, or null if it was already revoked
// (e.g. two refresh requests with the same token arrived at the same time).
function revokeIfActive(tokenHash, replacedByHash = null) {
  return RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedByHash } },
    { returnDocument: 'after' }
  );
}

// Revoke every active token the user has, across all families (all devices).
function revokeAllForUser(userId) {
  return RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = { create, findByHash, revokeIfActive, revokeAllForUser };
