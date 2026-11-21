const { z } = require('zod');
const { objectId } = require('../../utils/schemas');
const { MAX_QUANTITY } = require('./cart.model');

const quantity = z.number().int().min(1).max(MAX_QUANTITY);

const addItemBody = z
  .object({
    productId: objectId,
    variantId: objectId.optional(),
    quantity,
  })
  .strict();

const updateItemBody = z.object({ quantity }).strict();

const itemParam = z.object({ itemId: objectId });

module.exports = { addItemBody, updateItemBody, itemParam };
