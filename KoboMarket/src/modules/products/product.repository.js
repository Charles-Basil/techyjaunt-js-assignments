const { Product } = require('./product.model');

// Products shoppers can see.
const VISIBLE = { isActive: true, isDeleted: false };

function create(data) {
  return Product.create(data);
}

// Any product, including deleted ones (services decide what to do with it).
function findById(id) {
  return Product.findById(id);
}

function findVisibleBySlug(slug) {
  return Product.findOne({ slug, ...VISIBLE });
}

function findVisibleById(id) {
  return Product.findOne({ _id: id, ...VISIBLE });
}

// One query for many products (used by the cart, avoids one query per item).
function findManyByIds(ids) {
  return Product.find({ _id: { $in: ids } });
}

// The filter includes vendorId, so a product can only be changed by its owner
// even if two requests race. Returns null if not found / not owned / deleted.
function updateOwned(id, vendorId, fields) {
  return Product.findOneAndUpdate(
    { _id: id, vendorId, isDeleted: false },
    { $set: fields },
    { returnDocument: 'after', runValidators: true }
  );
}

function softDeleteOwned(id, vendorId) {
  return Product.findOneAndUpdate(
    { _id: id, vendorId, isDeleted: false },
    { $set: { isDeleted: true, isActive: false, deletedAt: new Date() } },
    { returnDocument: 'after' }
  );
}

function listVisible(filter, sort, limit) {
  return Product.find({ ...filter, ...VISIBLE }).sort(sort).limit(limit);
}

// Adds one rating in a single atomic update (an "aggregation pipeline update").
// Inside one $set stage every expression reads the OLD values, so ratingCount on
// the right-hand side is the count before this review:
//   newAvg   = round((ratingAvg * ratingCount + rating) / (ratingCount + 1), 2)
//   newCount = ratingCount + 1
// Because it runs inside MongoDB, two reviews at the same time can't overwrite
// each other's result (no read-then-write in Node).
function addRating(id, rating) {
  return Product.updateOne(
    { _id: id },
    [
      {
        $set: {
          ratingAvg: {
            $round: [
              {
                $divide: [
                  { $add: [{ $multiply: ['$ratingAvg', '$ratingCount'] }, rating] },
                  { $add: ['$ratingCount', 1] },
                ],
              },
              2,
            ],
          },
          ratingCount: { $add: ['$ratingCount', 1] },
        },
      },
    ],
    { updatePipeline: true } // Mongoose 9 requires opting in to pipeline updates
  );
}

module.exports = {
  create,
  findById,
  findVisibleBySlug,
  findVisibleById,
  findManyByIds,
  updateOwned,
  softDeleteOwned,
  listVisible,
  addRating,
};
