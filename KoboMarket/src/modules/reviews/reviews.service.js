const AppError = require('../../utils/AppError');
const pagination = require('../../utils/pagination');
const reviewRepository = require('./review.repository');
const productRepository = require('../products/product.repository');
const orderRepository = require('../orders/order.repository');

async function create(productId, buyerId, { rating, comment }) {
  const product = await productRepository.findVisibleById(productId);
  if (!product) throw new AppError('NOT_FOUND', 'Product not found', 404);

  // Only buyers who actually received the product (COMPLETED sub-order in Postgres).
  const eligible = await orderRepository.hasCompletedPurchase(buyerId, productId);
  if (!eligible) {
    throw new AppError('NOT_ELIGIBLE_TO_REVIEW', 'You can only review products you have received', 403);
  }

  let review;
  try {
    review = await reviewRepository.create({ productId, buyerId, rating, comment });
  } catch (err) {
    // The unique index { productId, buyerId } rejects a second review.
    if (err.code === 11000) {
      throw new AppError('ALREADY_REVIEWED', 'You have already reviewed this product', 409);
    }
    throw err;
  }

  // Two separate writes (review, then product totals). If this second one
  // failed, the rating summary would be one review behind; it can be rebuilt
  // from the reviews collection. It can't double-count: a retry of the request
  // hits ALREADY_REVIEWED above before reaching this line.
  await productRepository.addRating(productId, rating);
  return review;
}

async function list(productId, { limit, cursor }) {
  const product = await productRepository.findVisibleById(productId);
  if (!product) throw new AppError('NOT_FOUND', 'Product not found', 404);

  const filter = cursor
    ? pagination.afterCursorFilter('createdAt', -1, pagination.decodeCursor(cursor, pagination.parseDate))
    : {};
  const docs = await reviewRepository.listForProduct(
    productId,
    filter,
    pagination.sortSpec('createdAt', -1),
    limit + 1
  );
  return pagination.buildPage(docs, limit, 'createdAt');
}

module.exports = { create, list };
