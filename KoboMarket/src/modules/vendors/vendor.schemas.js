const { z } = require('zod');
const { limit, cursor } = require('../../utils/schemas');

const applyBody = z
  .object({
    storeName: z.string().trim().min(2).max(60),
    description: z.string().trim().max(1000).optional(),
    bankDetails: z
      .object({
        bankName: z.string().trim().min(2).max(100),
        bankCode: z.string().trim().regex(/^\d{3,6}$/, 'Bank code must be 3 to 6 digits'),
        // Nigerian (NUBAN) account numbers are exactly 10 digits.
        accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account number must be 10 digits'),
        accountName: z.string().trim().min(2).max(100),
      })
      .strict(),
  })
  .strict();

const decisionBody = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  // A rejection must tell the applicant why.
  .refine((b) => b.decision === 'APPROVED' || b.reason, {
    message: 'A reason is required when rejecting',
    path: ['reason'],
  });

const adminListQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  limit,
  cursor,
});

module.exports = { applyBody, decisionBody, adminListQuery };
