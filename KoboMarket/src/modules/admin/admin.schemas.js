const { z } = require('zod');
const { objectId, limit, cursor } = require('../../utils/schemas');
const { ROLES } = require('../users/user.model');

const isoDate = z.iso.date('Use the format YYYY-MM-DD');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY;

const usersQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['ACTIVE', 'FROZEN']).optional(),
  limit,
  cursor,
});

const userIdParam = z.object({ id: objectId });
const accountIdParam = z.object({ id: z.uuid('Invalid account id') });

const freezeBody = z
  .object({
    frozen: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const pageQuery = z.object({ limit, cursor });

const transactionsQuery = z
  .object({
    type: z.string().trim().regex(/^[A-Z_]{3,40}$/, 'type looks like ORDER_PAYMENT').optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit,
    cursor,
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { message: 'to must be on or after from', path: ['to'] });

const commissionBody = z
  .object({ commissionRateBps: z.number().int().min(0).max(5000, 'At most 5000 bps (50%)') })
  .strict();

const revenueQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.to >= q.from, { message: 'to must be on or after from', path: ['to'] })
  // 366 days at most (a leap year), counting both ends.
  .refine((q) => daysBetween(q.from, q.to) <= 365, { message: 'The range can be at most 366 days', path: ['to'] });

const topVendorsQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM')
    .optional(),
});

module.exports = {
  usersQuery,
  userIdParam,
  accountIdParam,
  freezeBody,
  pageQuery,
  transactionsQuery,
  commissionBody,
  revenueQuery,
  topVendorsQuery,
};
