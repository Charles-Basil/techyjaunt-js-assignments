const { z } = require('zod');
const env = require('../../config/env');
const { limit, cursor } = require('../../utils/schemas');

const createBody = z
  .object({
    amountKobo: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .min(env.PAYOUT_MIN_KOBO, `The minimum payout is ${env.PAYOUT_MIN_KOBO} kobo`),
  })
  .strict();

const listQuery = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED']).optional(),
  limit,
  cursor,
});

module.exports = { createBody, listQuery };
