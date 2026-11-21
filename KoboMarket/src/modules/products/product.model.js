const mongoose = require('mongoose');

// Schema-level safety net (zod already checks requests): stock must be a whole
// number >= 0 no matter which code path writes it.
const stockField = {
  type: Number,
  required: true,
  min: [0, 'Stock cannot be negative'],
  validate: { validator: Number.isInteger, message: 'Stock must be a whole number' },
};

const priceField = {
  type: Number,
  required: true,
  min: [1, 'Price must be at least 1 kobo'],
  validate: { validator: Number.isInteger, message: 'Price must be whole kobo' },
};

// Each variant gets its own _id automatically; carts reference it as variantId.
const variantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sku: { type: String, required: true, trim: true },
  attributes: {
    size: { type: String, trim: true },
    colour: { type: String, trim: true },
  },
  priceKobo: priceField,
  stock: stockField,
});

const productSchema = new mongoose.Schema(
  {
    // The vendor's USER id (not the VendorProfile id).
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, trim: true, default: '' },
    priceKobo: priceField,
    category: { type: String, required: true, trim: true, lowercase: true },
    images: { type: [String], default: [] },
    stock: stockField,
    variants: { type: [variantSchema], default: [] },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Full-text search on name and description. A word found in the name counts 3x.
productSchema.index({ name: 'text', description: 'text' }, { weights: { name: 3, description: 1 } });
productSchema.index({ category: 1, priceKobo: 1 });
productSchema.index({ vendorId: 1 });
productSchema.index({ ratingAvg: 1 });
productSchema.index({ createdAt: 1, _id: 1 });
// Support the price sorts without a category filter.
productSchema.index({ priceKobo: 1, _id: 1 });

productSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Product = mongoose.model('Product', productSchema);

module.exports = { Product };
