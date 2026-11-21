const { Review } = require('./review.model');

function create(data) {
  return Review.create(data);
}

function listForProduct(productId, extraFilter, sort, limit) {
  return Review.find({ productId, ...extraFilter }).sort(sort).limit(limit);
}

module.exports = { create, listForProduct };
