const { z } = require('zod');
const { limit, cursor } = require('../../utils/schemas');

const httpUrl = z
  .url('Image evidence must be a URL')
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'Image evidence must be an http(s) URL');

// Each evidence item is either a text note or an image link.
const evidenceItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('image'), value: httpUrl }).strict(),
]);

const openBody = z
  .object({
    reason: z.string().trim().min(10, 'Please describe the problem (at least 10 characters)').max(1000),
    evidence: z.array(evidenceItem).max(10).default([]),
  })
  .strict();

const resolveBody = z
  .object({
    resolution: z.enum(['FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED']),
    refundKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    note: z.string().trim().min(5, 'A note of at least 5 characters is required').max(1000),
  })
  .strict()
  // refundKobo belongs to PARTIAL_REFUND only (the upper limit, "less than the
  // subtotal", needs the sub-order and is checked in the service).
  .refine((b) => (b.resolution === 'PARTIAL_REFUND') === (b.refundKobo !== undefined), {
    message: 'refundKobo is required for PARTIAL_REFUND and not allowed otherwise',
    path: ['refundKobo'],
  });

const listQuery = z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), limit, cursor });

module.exports = { openBody, resolveBody, listQuery };
