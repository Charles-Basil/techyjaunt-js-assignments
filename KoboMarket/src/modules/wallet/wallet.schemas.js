const { z } = require('zod');
const { limit, cursor } = require('../../utils/schemas');

// Money input: whole kobo, never above Number.MAX_SAFE_INTEGER (so the JS
// number is exact), then the funding limits NGN 100 to NGN 1,000,000.
const MIN_FUNDING_KOBO = 10_000;
const MAX_FUNDING_KOBO = 100_000_000;

const fundBody = z
  .object({
    amountKobo: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .min(MIN_FUNDING_KOBO, 'Minimum funding is NGN 100 (10000 kobo)')
      .max(MAX_FUNDING_KOBO, 'Maximum funding is NGN 1,000,000 (100000000 kobo)'),
  })
  .strict();

const referenceParam = z.object({ reference: z.string().trim().min(1).max(100) });

const transactionsQuery = z.object({ limit, cursor });

module.exports = { fundBody, referenceParam, transactionsQuery, MIN_FUNDING_KOBO, MAX_FUNDING_KOBO };
