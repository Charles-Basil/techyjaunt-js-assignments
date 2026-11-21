const { z } = require('zod');
const { limit, cursor } = require('../../utils/schemas');

const createBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();

const listQuery = z.object({ limit, cursor });

module.exports = { createBody, listQuery };
