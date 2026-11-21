// Checkout: turns a cart (or a "buy now" list) into a paid order with the money
// held in ESCROW. Two databases are involved, so the steps are (see README
// "Cross-database consistency: checkout"):
//
//   a) MongoDB   validate products, CURRENT prices and stock
//   b) Postgres  ONE transaction: lock wallet + escrow, check balance, insert
//                order/sub-orders/items, ledger ORDER_PAYMENT (wallet -> escrow)
//   c) MongoDB   take the stock, one atomic conditional $inc per item
//   d) if (c) fails: put back what was taken, then COMPENSATE in Postgres
//                (ORDER_REFUND escrow -> wallet, sub-orders CANCELLED)
//   e) success:  stock_status DEDUCTED, clear the cart lines, emit 'order.placed'
//
// If the process dies between b and c, the stock recovery job finds the order
// (stock_status still PENDING) and compensates it.
const { knex } = require('../../config/knex');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const { toKoboNumber } = require('../../utils/money');
const ledger = require('../../ledger/ledger.service');
const { emitEvent } = require('../../events/emitter');
const productRepository = require('../products/product.repository');
const cartRepository = require('../cart/cart.repository');
const settingsRepository = require('../settings/settings.repository');
const orderRepository = require('./order.repository');
const { transition } = require('./orderStateMachine');
const ordersService = require('./orders.service');

const ESCROW = 'PLATFORM_ESCROW';

// ---------- a) validate against MongoDB ----------

// "Buy now" may list the same product twice: add the quantities together.
function mergeLines(lines) {
  const byKey = new Map();
  for (const line of lines) {
    const key = `${line.productId}:${line.variantId || ''}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += line.quantity;
    else byKey.set(key, { productId: String(line.productId), variantId: line.variantId ? String(line.variantId) : null, quantity: line.quantity });
  }
  return [...byKey.values()];
}

async function priceLines(buyerId, rawLines) {
  const lines = mergeLines(rawLines);
  if (lines.length === 0) throw new AppError('CART_EMPTY', 'There is nothing to check out', 400);

  // One query for all products (not one per line).
  const products = await productRepository.findManyByIds(lines.map((l) => l.productId));
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const problems = [];
  const priced = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    const problem = (reason, extra = {}) => problems.push({ ...line, reason, ...extra });

    if (!product || !product.isActive || product.isDeleted) {
      problem('UNAVAILABLE');
      continue;
    }
    if (String(product.vendorId) === String(buyerId)) {
      throw new AppError('CANNOT_BUY_OWN_PRODUCT', 'You cannot buy your own product', 400, { productId: line.productId });
    }

    let variant = null;
    if (line.variantId) {
      variant = product.variants.id(line.variantId);
      if (!variant) {
        problem('VARIANT_NOT_FOUND');
        continue;
      }
    } else if (product.variants.length > 0) {
      problem('VARIANT_REQUIRED');
      continue;
    }

    const stock = variant ? variant.stock : product.stock;
    if (line.quantity > stock) {
      problem('INSUFFICIENT_STOCK', { requested: line.quantity, available: stock });
      continue;
    }

    // The CURRENT price from the product, never the cart snapshot.
    const unitPriceKobo = BigInt(variant ? variant.priceKobo : product.priceKobo);
    priced.push({
      ...line,
      vendorId: String(product.vendorId),
      name: variant ? `${product.name} (${variant.name})` : product.name,
      unitPriceKobo,
      lineTotalKobo: unitPriceKobo * BigInt(line.quantity),
    });
  }

  if (problems.length > 0) {
    throw new AppError('CART_INVALID', 'Some items cannot be bought right now', 409, problems);
  }
  return priced;
}

function groupByVendor(priced) {
  const groups = new Map();
  for (const line of priced) {
    if (!groups.has(line.vendorId)) groups.set(line.vendorId, { vendorId: line.vendorId, lines: [], subtotalKobo: 0n });
    const group = groups.get(line.vendorId);
    group.lines.push(line);
    group.subtotalKobo += line.lineTotalKobo;
  }
  return [...groups.values()];
}

// ---------- b) one Postgres transaction ----------

async function createPaidOrder(buyerId, priced, idempotencyKey) {
  const groups = groupByVendor(priced);
  const totalKobo = groups.reduce((sum, g) => sum + g.subtotalKobo, 0n);

  return knex.transaction(async (trx) => {
    const wallet = await ledger.getUserAccount(trx, buyerId);
    const escrow = await ledger.getSystemAccount(trx, ESCROW);

    // Lock BOTH rows (in id order) before reading the balance. A second
    // checkout by the same buyer now waits here until this one commits, then
    // reads the reduced balance. That's why 10 parallel checkouts on a wallet
    // that can pay for 3 give exactly 3 orders.
    const locked = await ledger.lockAccounts(trx, [wallet.id, escrow.id]);
    const balance = BigInt(locked.find((a) => a.id === wallet.id).balance_kobo);
    if (balance < totalKobo) {
      throw new AppError('INSUFFICIENT_FUNDS', 'Your wallet balance is too low for this order', 402, {
        balanceKobo: toKoboNumber(balance),
        requiredKobo: toKoboNumber(totalKobo),
      });
    }

    // Copied onto every sub-order: a later settings change won't touch this order.
    const commissionRateBps = await settingsRepository.getCommissionRateBps(trx);
    const order = await orderRepository.insertOrder(trx, { buyerId, totalKobo, idempotencyKey });

    for (const group of groups) {
      const subOrder = await orderRepository.insertSubOrder(trx, {
        orderId: order.id,
        vendorId: group.vendorId,
        buyerId,
        subtotalKobo: group.subtotalKobo,
        commissionRateBps,
      });
      // The DB CHECK line_total = unit_price * quantity double-checks our maths.
      await orderRepository.insertItems(
        trx,
        group.lines.map((l) => ({
          sub_order_id: subOrder.id,
          product_id: l.productId,
          variant_id: l.variantId,
          name: l.name,
          unit_price_kobo: l.unitPriceKobo.toString(),
          quantity: l.quantity,
          line_total_kobo: l.lineTotalKobo.toString(),
        }))
      );
      // Sub-orders start directly in PAID (the wallet pays instantly). This
      // event keeps the history complete: PENDING_PAYMENT -> PAID.
      await orderRepository.insertEvent(trx, {
        subOrderId: subOrder.id,
        from: 'PENDING_PAYMENT',
        to: 'PAID',
        actorId: buyerId,
        actorRole: 'BUYER',
        note: 'Paid from wallet at checkout',
      });
    }

    // Money moves: buyer wallet -> escrow. (The DB CHECK on balances is the
    // second safety net behind the balance check above.)
    await ledger.postTransaction(trx, {
      reference: `ORDER_PAYMENT:${order.id}`,
      type: 'ORDER_PAYMENT',
      metadata: { orderId: order.id },
      entries: [
        { accountId: wallet.id, direction: 'DEBIT', amountKobo: totalKobo },
        { accountId: escrow.id, direction: 'CREDIT', amountKobo: totalKobo },
      ],
    });

    return { order, totalKobo };
  });
}

// ---------- c) / d) stock in MongoDB ----------

// Puts back stock we already took. Errors are logged: the order is refunded
// either way; a failed put-back means stock is under-counted (never oversold).
async function restoreStock(lines) {
  for (const line of lines) {
    try {
      await productRepository.incrementStock(line.productId, line.variantId, line.quantity);
    } catch (err) {
      logger.error({ err, productId: line.productId }, 'Could not restore stock');
    }
  }
}

/**
 * Undoes a checkout whose stock step did not finish: refund escrow -> wallet,
 * cancel the PAID sub-orders, stock_status RELEASED. Safe to call more than
 * once (and from the request and the recovery job at the same time): it only
 * acts while stock_status is still PENDING, checked under a row lock, and the
 * refund reference is unique.
 * Returns true if it compensated, false if there was nothing to do.
 */
async function compensateOrder(orderId, { reason, skipLocked = false }) {
  return knex.transaction(async (trx) => {
    // Lock order: order -> sub-orders -> accounts (the same in every flow).
    const order = await orderRepository.lockOrder(trx, orderId, { skipLocked });
    if (!order || order.stock_status !== 'PENDING') return false;

    const subOrders = await orderRepository.lockSubOrdersOfOrder(trx, orderId);
    const paid = subOrders.filter((s) => s.status === 'PAID');
    const refundKobo = paid.reduce((sum, s) => sum + BigInt(s.subtotal_kobo), 0n);

    if (refundKobo > 0n) {
      const wallet = await ledger.getUserAccount(trx, order.buyer_id);
      const escrow = await ledger.getSystemAccount(trx, ESCROW);
      await ledger.lockAccounts(trx, [wallet.id, escrow.id]);
      await ledger.postTransaction(trx, {
        reference: `ORDER_REFUND:${orderId}`,
        type: 'ORDER_REFUND',
        // allowFrozen: giving a buyer their own money back is always allowed.
        metadata: { orderId, reason, allowFrozen: true },
        entries: [
          { accountId: escrow.id, direction: 'DEBIT', amountKobo: refundKobo },
          { accountId: wallet.id, direction: 'CREDIT', amountKobo: refundKobo },
        ],
      });
    }
    for (const subOrder of paid) {
      await transition(trx, subOrder.id, 'CANCELLED', {
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        note: reason,
        extraFields: { cancel_reason: reason },
      });
    }
    await orderRepository.markOrderReleased(trx, orderId, reason);
    return true;
  });
}

// ---------- the whole flow ----------

/**
 * @param buyer  the Mongo user (req.user)
 * @param items  "buy now" lines, or undefined to use the buyer's cart
 * @param idempotencyKey  the request's Idempotency-Key header
 */
async function placeOrder(buyer, { items, idempotencyKey }) {
  const buyerId = String(buyer._id);
  const fromCart = !items;

  let lines = items;
  if (fromCart) {
    const cart = await cartRepository.findByUserId(buyerId);
    lines = cart ? cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })) : [];
  }

  // a)
  const priced = await priceLines(buyerId, lines);

  // b) The database backstop for idempotency: the same user+key can only
  //    ever create one order (UNIQUE orders.idempotency_key).
  const orderKey = `${buyerId}:${idempotencyKey}`;
  let created;
  try {
    created = await createPaidOrder(buyerId, priced, orderKey);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'orders_idempotency_key_unique') {
      const existing = await orderRepository.findOrderByIdempotencyKey(orderKey);
      return ordersService.getOrderDetails(existing.id);
    }
    throw err;
  }
  const { order, totalKobo } = created;

  // c) Take the stock, item by item.
  const taken = [];
  let soldOut = null;
  let mongoError = null;
  try {
    for (const line of priced) {
      const ok = await productRepository.decrementStock(line.productId, line.variantId, line.quantity);
      if (!ok) {
        soldOut = line;
        break;
      }
      taken.push(line);
    }
  } catch (err) {
    mongoError = err;
  }

  // d) Something failed: undo in both databases.
  if (soldOut || mongoError) {
    await restoreStock(taken);
    const reason = soldOut ? 'OUT_OF_STOCK' : 'STOCK_UPDATE_FAILED';
    try {
      await compensateOrder(order.id, { reason });
    } catch (err) {
      // Postgres also failing: the recovery job will compensate in a few minutes.
      logger.error({ err, orderId: order.id }, 'Compensation failed; stock recovery job will retry');
      throw err;
    }
    if (mongoError) {
      logger.error({ err: mongoError, orderId: order.id }, 'Stock update failed; order refunded');
      throw new AppError('STOCK_UPDATE_FAILED', 'Could not reserve stock; you have not been charged', 503);
    }
    throw new AppError('OUT_OF_STOCK', 'An item sold out while you were checking out; you have not been charged', 409, {
      orderId: order.id,
      productId: soldOut.productId,
      variantId: soldOut.variantId,
      name: soldOut.name,
      requested: soldOut.quantity,
    });
  }

  // e) Done. Conditional update: if the recovery job already compensated this
  //    order (only possible if we were stuck for over 5 minutes), give the stock back.
  const marked = await orderRepository.markStockDeducted(order.id);
  if (!marked) {
    await restoreStock(taken);
    throw new AppError('CHECKOUT_EXPIRED', 'Checkout took too long and was cancelled; you have not been charged', 409);
  }

  if (fromCart) {
    await cartRepository.removePurchasedItems(buyerId, priced).catch((err) => {
      logger.error({ err, buyerId }, 'Could not clear purchased items from the cart');
    });
  }

  const details = await ordersService.getOrderDetails(order.id);
  emitEvent('order.placed', {
    orderId: order.id,
    buyerId,
    totalKobo: totalKobo.toString(),
    subOrders: details.subOrders.map((s) => ({ id: s.id, vendorId: s.vendorId })),
  });
  return details;
}

module.exports = { placeOrder, compensateOrder, priceLines, mergeLines };
