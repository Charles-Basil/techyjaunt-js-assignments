const mongoose = require('mongoose');

const MAX_QUANTITY = 100;

const cartItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    max: MAX_QUANTITY,
    validate: { validator: Number.isInteger, message: 'Quantity must be a whole number' },
  },
  // Snapshots = what the buyer saw when adding. DISPLAY ONLY: checkout always
  // re-reads the real price and stock from the product.
  priceKoboSnapshot: { type: Number, required: true },
  nameSnapshot: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
});

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  {
    timestamps: true,
    // If two requests load the same cart and both save, the second save fails
    // with a VersionError instead of silently overwriting the first change.
    optimisticConcurrency: true,
  }
);

const Cart = mongoose.model('Cart', cartSchema);

module.exports = { Cart, MAX_QUANTITY };
