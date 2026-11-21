const mongoose = require('mongoose');

const ROLES = ['BUYER', 'VENDOR', 'ADMIN'];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false -> never loaded unless a query explicitly asks for it (+passwordHash)
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    roles: { type: [{ type: String, enum: ROLES }], default: ['BUYER'] },
    isEmailVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'FROZEN'], default: 'ACTIVE' },
    // PENDING until the Postgres wallet row exists (see README: user -> wallet)
    walletStatus: { type: String, enum: ['PENDING', 'CREATED'], default: 'PENDING' },

    // Only sha256 hashes of tokens are stored, never the tokens themselves.
    emailVerifyTokenHash: { type: String, select: false },
    emailVerifyExpiresAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
  },
  { timestamps: true } // adds createdAt and updatedAt
);

// The wallet reconciler job searches for "PENDING and older than 30s".
userSchema.index({ walletStatus: 1, createdAt: 1 });
// sparse: only users that currently HAVE a token are in these indexes.
userSchema.index({ emailVerifyTokenHash: 1 }, { sparse: true });
userSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });

// What the API sends back. Secrets are removed even if they were loaded.
userSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.emailVerifyTokenHash;
    delete ret.emailVerifyExpiresAt;
    delete ret.passwordResetTokenHash;
    delete ret.passwordResetExpiresAt;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };
