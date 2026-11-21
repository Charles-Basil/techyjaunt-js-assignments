const mongoose = require('mongoose');

// "0123456789" -> "******6789"
function maskAccountNumber(accountNumber) {
  if (!accountNumber) return accountNumber;
  return `${'*'.repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`;
}

const bankDetailsSchema = new mongoose.Schema(
  {
    bankName: { type: String, required: true, trim: true },
    bankCode: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
  },
  { _id: false } // a plain embedded object, it doesn't need its own id
);

const vendorProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    storeName: { type: String, required: true, unique: true, trim: true },
    storeSlug: { type: String, required: true, unique: true },
    description: { type: String, trim: true, default: '' },
    bankDetails: { type: bankDetailsSchema, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Admin list: filter by status, newest first (cursor on createdAt + _id).
vendorProfileSchema.index({ status: 1, createdAt: -1, _id: -1 });

// Every API response masks the account number. The full number stays in the
// database for payouts (later blocks read it directly from the document).
vendorProfileSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    if (ret.bankDetails) ret.bankDetails.accountNumber = maskAccountNumber(ret.bankDetails.accountNumber);
    return ret;
  },
});

const VendorProfile = mongoose.model('VendorProfile', vendorProfileSchema);

module.exports = { VendorProfile, maskAccountNumber };
