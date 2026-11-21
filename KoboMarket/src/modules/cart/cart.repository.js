const { Cart } = require('./cart.model');

function findByUserId(userId) {
  return Cart.findOne({ userId });
}

// Returns the user's cart, creating an empty one the first time.
// upsert = "update, or insert if missing" in a single atomic operation.
async function getOrCreate(userId) {
  try {
    return await Cart.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, items: [] } },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    // Two first-time requests can race; the loser hits the unique userId index.
    // The cart exists now, so just read it.
    if (err.code === 11000) return Cart.findOne({ userId });
    throw err;
  }
}

function save(cart) {
  return cart.save();
}

module.exports = { findByUserId, getOrCreate, save };
