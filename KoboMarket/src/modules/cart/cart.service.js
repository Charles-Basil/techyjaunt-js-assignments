const AppError = require('../../utils/AppError');
const cartRepository = require('./cart.repository');
const productRepository = require('../products/product.repository');
const { MAX_QUANTITY } = require('./cart.model');

// ---------- helpers ----------

const sameId = (a, b) => String(a ?? '') === String(b ?? '');

function isBuyable(product) {
  return Boolean(product) && product.isActive && !product.isDeleted;
}

// The CURRENT price/stock/name for a product or one of its variants.
// Returns null if the variant no longer exists.
function currentLine(product, variantId) {
  if (!variantId) return { priceKobo: product.priceKobo, stock: product.stock, name: product.name };
  const variant = product.variants.id(variantId); // Mongoose helper: find subdocument by _id
  if (!variant) return null;
  return { priceKobo: variant.priceKobo, stock: variant.stock, name: `${product.name} (${variant.name})` };
}

// Loads a product and checks it can be put in a cart. Returns { product, line }.
async function loadBuyable(productId, variantId) {
  const product = await productRepository.findById(productId);
  if (!isBuyable(product)) throw new AppError('PRODUCT_UNAVAILABLE', 'This product is not available', 404);

  // A product with variants (e.g. sizes) must be bought as a specific variant.
  if (!variantId && product.variants.length > 0) {
    throw new AppError('VARIANT_REQUIRED', 'Choose a variant for this product', 400);
  }
  const line = currentLine(product, variantId);
  if (!line) throw new AppError('VARIANT_NOT_FOUND', 'This variant does not exist', 404);
  return { product, line };
}

function checkQuantity(quantity, stock) {
  if (quantity > MAX_QUANTITY) {
    throw new AppError('QUANTITY_LIMIT_EXCEEDED', `You can have at most ${MAX_QUANTITY} of one item`, 400, {
      max: MAX_QUANTITY,
      requested: quantity,
    });
  }
  if (quantity > stock) {
    throw new AppError('INSUFFICIENT_STOCK', 'Not enough stock for this quantity', 409, {
      available: stock,
      requested: quantity,
    });
  }
}

async function saveCart(cart) {
  try {
    return await cartRepository.save(cart);
  } catch (err) {
    // Another request changed this cart between our read and our write.
    if (err.name === 'VersionError') {
      throw new AppError('CART_CONFLICT', 'Your cart was changed by another request, please retry', 409);
    }
    throw err;
  }
}

// Joins every cart item with its product's CURRENT data. One query for all
// products (not one per item). Prices are integers, so the sum is exact.
async function enrich(cart) {
  const items = cart ? cart.items : [];
  const products = await productRepository.findManyByIds(items.map((i) => i.productId));
  const byId = new Map(products.map((p) => [String(p._id), p]));

  let subtotalKobo = 0;
  const enriched = items.map((item) => {
    const product = byId.get(String(item.productId));
    const line = isBuyable(product) ? currentLine(product, item.variantId) : null;
    const unavailable = line === null; // deleted, inactive, or variant removed
    const result = {
      id: String(item._id),
      productId: String(item.productId),
      variantId: item.variantId ? String(item.variantId) : null,
      vendorId: String(item.vendorId),
      name: unavailable ? item.nameSnapshot : line.name,
      quantity: item.quantity,
      priceKoboSnapshot: item.priceKoboSnapshot,
      currentPriceKobo: unavailable ? null : line.priceKobo,
      currentStock: unavailable ? 0 : line.stock,
      lineTotalKobo: unavailable ? 0 : line.priceKobo * item.quantity,
      priceChanged: !unavailable && line.priceKobo !== item.priceKoboSnapshot,
      outOfStock: !unavailable && line.stock < item.quantity, // not enough for this quantity
      unavailable,
      addedAt: item.addedAt,
    };
    subtotalKobo += result.lineTotalKobo; // unavailable items count as 0
    return result;
  });

  return { items: enriched, subtotalKobo };
}

// ---------- use cases ----------

async function getCart(userId) {
  return enrich(await cartRepository.findByUserId(userId));
}

async function addItem(userId, { productId, variantId = null, quantity }) {
  const { product, line } = await loadBuyable(productId, variantId);
  const cart = await cartRepository.getOrCreate(userId);

  // Same product + same variant already in the cart? Merge the quantities.
  const existing = cart.items.find((i) => sameId(i.productId, productId) && sameId(i.variantId, variantId));
  const newQuantity = (existing ? existing.quantity : 0) + quantity;
  checkQuantity(newQuantity, line.stock);

  if (existing) {
    existing.quantity = newQuantity;
    existing.priceKoboSnapshot = line.priceKobo; // the buyer has seen the new price now
  } else {
    cart.items.push({
      productId,
      variantId,
      vendorId: product.vendorId,
      quantity,
      priceKoboSnapshot: line.priceKobo,
      nameSnapshot: line.name,
    });
  }
  return enrich(await saveCart(cart));
}

async function updateItem(userId, itemId, { quantity }) {
  const cart = await cartRepository.findByUserId(userId);
  const item = cart && cart.items.id(itemId);
  if (!item) throw new AppError('CART_ITEM_NOT_FOUND', 'Cart item not found', 404);

  const { line } = await loadBuyable(item.productId, item.variantId);
  checkQuantity(quantity, line.stock);
  item.quantity = quantity;
  item.priceKoboSnapshot = line.priceKobo;
  return enrich(await saveCart(cart));
}

async function removeItem(userId, itemId) {
  const cart = await cartRepository.findByUserId(userId);
  const item = cart && cart.items.id(itemId);
  if (!item) throw new AppError('CART_ITEM_NOT_FOUND', 'Cart item not found', 404);

  item.deleteOne(); // removes the subdocument from cart.items
  return enrich(await saveCart(cart));
}

// Used by checkout (later block). Re-checks every item against CURRENT product
// data. Returns the priced items, or throws 409 CART_INVALID listing every problem.
async function validateForCheckout(userId) {
  const { items } = await getCart(userId);
  if (items.length === 0) throw new AppError('CART_EMPTY', 'Your cart is empty', 409);

  const problems = items
    .filter((i) => i.unavailable || i.outOfStock)
    .map((i) => ({
      itemId: i.id,
      productId: i.productId,
      variantId: i.variantId,
      name: i.name,
      reason: i.unavailable ? 'UNAVAILABLE' : 'INSUFFICIENT_STOCK',
      requested: i.quantity,
      available: i.currentStock,
    }));
  if (problems.length > 0) {
    throw new AppError('CART_INVALID', 'Some items in your cart need attention', 409, problems);
  }

  const priced = items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId,
    vendorId: i.vendorId,
    name: i.name,
    unitPriceKobo: i.currentPriceKobo,
    quantity: i.quantity,
    lineTotalKobo: i.lineTotalKobo,
  }));
  return {
    items: priced,
    vendorIds: [...new Set(priced.map((i) => i.vendorId))],
    totalKobo: priced.reduce((sum, i) => sum + i.lineTotalKobo, 0),
  };
}

module.exports = { getCart, addItem, updateItem, removeItem, validateForCheckout };
