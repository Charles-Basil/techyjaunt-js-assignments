const mongoose = require('mongoose');

// One document per refresh token ever issued.
// familyId links every token produced by rotating the same login session,
// so we can tell "an old token from this session was reused".
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    // TTL index: MongoDB deletes the document automatically once expiresAt passes.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = { RefreshToken };
