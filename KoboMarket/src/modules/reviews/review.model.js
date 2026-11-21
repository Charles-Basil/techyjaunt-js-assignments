const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: 'Rating must be a whole number' },
    },
    comment: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

// One review per buyer per product, enforced by the database.
reviewSchema.index({ productId: 1, buyerId: 1 }, { unique: true });
// Listing a product's reviews, newest first (cursor on createdAt + _id).
reviewSchema.index({ productId: 1, createdAt: -1, _id: -1 });

reviewSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Review = mongoose.model('Review', reviewSchema);

module.exports = { Review };
