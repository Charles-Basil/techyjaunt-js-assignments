const AppError = require('../../utils/AppError');
const { slugWithSuffix } = require('../../utils/slug');
const pagination = require('../../utils/pagination');
const productRepository = require('./product.repository');
const vendorRepository = require('../vendors/vendor.repository');

// For each ?sort= value: which field, which direction, and how to read the
// cursor value back (dates travel as ISO strings inside the cursor).
const SORT_CONFIG = {
  newest: { field: 'createdAt', direction: -1, parse: pagination.parseDate },
  price_asc: { field: 'priceKobo', direction: 1, parse: pagination.parseNumber },
  price_desc: { field: 'priceKobo', direction: -1, parse: pagination.parseNumber },
  rating: { field: 'ratingAvg', direction: -1, parse: pagination.parseNumber },
};

async function create(vendorId, data) {
  // The VENDOR role is checked by middleware. Here we also require the store
  // itself to be APPROVED.
  const profile = await vendorRepository.findByUserId(vendorId);
  if (!profile || profile.status !== 'APPROVED') {
    throw new AppError('VENDOR_NOT_APPROVED', 'Your vendor profile is not approved', 403);
  }

  // The random suffix makes a clash very unlikely; if one happens, try a new suffix.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await productRepository.create({ ...data, vendorId, slug: slugWithSuffix(data.name) });
    } catch (err) {
      const slugClash = err.code === 11000 && err.keyPattern && err.keyPattern.slug;
      if (!slugClash || attempt >= 3) throw err;
    }
  }
}

// Finds the product and checks the caller owns it. Ownership is about THIS
// product, not a role, so it belongs in the service, not in RBAC middleware.
async function loadOwned(productId, vendorId) {
  const product = await productRepository.findById(productId);
  if (!product || product.isDeleted) throw new AppError('NOT_FOUND', 'Product not found', 404);
  if (String(product.vendorId) !== String(vendorId)) {
    throw new AppError('NOT_PRODUCT_OWNER', 'You can only manage your own products', 403);
  }
  return product;
}

async function update(productId, vendorId, fields) {
  await loadOwned(productId, vendorId);
  const updated = await productRepository.updateOwned(productId, vendorId, fields);
  if (!updated) throw new AppError('NOT_FOUND', 'Product not found', 404); // deleted meanwhile
  return updated;
}

async function remove(productId, vendorId) {
  await loadOwned(productId, vendorId);
  await productRepository.softDeleteOwned(productId, vendorId);
}

async function getBySlug(slug) {
  const product = await productRepository.findVisibleBySlug(slug);
  if (!product) throw new AppError('NOT_FOUND', 'Product not found', 404);
  return product;
}

async function list({ q, category, vendorId, minPrice, maxPrice, minRating, sort, limit, cursor }) {
  const filter = {};
  if (q) filter.$text = { $search: q };
  if (category) filter.category = category;
  if (vendorId) filter.vendorId = vendorId;
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.priceKobo = {};
    if (minPrice !== undefined) filter.priceKobo.$gte = minPrice;
    if (maxPrice !== undefined) filter.priceKobo.$lte = maxPrice;
  }
  if (minRating !== undefined) filter.ratingAvg = { $gte: minRating };

  const { field, direction, parse } = SORT_CONFIG[sort];
  if (cursor) {
    // $and keeps the cursor condition separate from the filters above
    // (e.g. a price filter and a price cursor both on priceKobo).
    filter.$and = [pagination.afterCursorFilter(field, direction, pagination.decodeCursor(cursor, parse))];
  }

  // Ask for one extra item: if it comes back, there is a next page.
  const docs = await productRepository.listVisible(filter, pagination.sortSpec(field, direction), limit + 1);
  return pagination.buildPage(docs, limit, field);
}

module.exports = { create, update, remove, getBySlug, list };
