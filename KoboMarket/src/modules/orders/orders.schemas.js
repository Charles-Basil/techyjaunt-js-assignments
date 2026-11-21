const { z } = require('zod');
const { objectId, limit, cursor } = require('../../utils/schemas');
const { MAX_QUANTITY } = require('../cart/cart.model');
const { TRANSITIONS } = require('./orderStateMachine');

// {} = check out my cart; { items: [...] } = "buy now" (the cart is not touched).
const checkoutBody = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: objectId,
            variantId: objectId.optional(),
            quantity: z.number().int().min(1).max(MAX_QUANTITY),
          })
          .strict()
      )
      .min(1, 'items must not be empty (send {} to check out your cart)')
      .max(50)
      .optional(),
  })
  .strict();

const ORDER_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
const SUB_ORDER_STATUSES = Object.keys(TRANSITIONS);

const listOrdersQuery = z.object({ status: z.enum(ORDER_STATUSES).optional(), limit, cursor });
const listSubOrdersQuery = z.object({ status: z.enum(SUB_ORDER_STATUSES).optional(), limit, cursor });

const uuidParam = z.object({ id: z.uuid('Invalid id') });

const shipBody = z.object({ trackingNumber: z.string().trim().min(1).max(100).optional() }).strict();
const emptyBody = z.object({}).strict();

module.exports = { checkoutBody, listOrdersQuery, listSubOrdersQuery, uuidParam, shipBody, emptyBody };
