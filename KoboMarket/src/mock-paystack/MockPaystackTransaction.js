// What the fake Paystack remembers about each payment.
const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    amountKobo: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'amountKobo must be a safe integer' },
    },
    email: { type: String, required: true },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MockPaystackTransaction || mongoose.model('MockPaystackTransaction', schema);
