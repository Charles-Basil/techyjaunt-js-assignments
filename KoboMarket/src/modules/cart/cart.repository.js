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

// After a successful checkout: remove exactly the purchased product+variant lines.
// $inc __v bumps the version, so a cart edit that loaded the old version fails
// with CART_CONFLICT instead of silently putting the bought items back.
function removePurchasedItems(userId, lines) {
  if (lines.length === 0) return Promise.resolve();
  const match = lines.map((l) => ({ productId: l.productId, variantId: l.variantId || null }));
  return Cart.updateOne({ userId }, { $pull: { items: { $or: match } }, $inc: { __v: 1 } });
}

module.exports = { findByUserId, getOrCreate, save, removePurchasedItems };
