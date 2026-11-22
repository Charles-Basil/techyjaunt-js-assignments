// What the fake Paystack remembers about each bank transfer (vendor payout).
const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true }, // = our payout id
    transferCode: { type: String, required: true },
    amountKobo: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'amountKobo must be a safe integer' },
    },
    bankCode: String,
    accountNumberLast4: String, // the fake provider doesn't need to keep the full number either
    status: { type: String, enum: ['success', 'failed'], required: true },
    reason: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MockPaystackTransfer || mongoose.model('MockPaystackTransfer', schema);
