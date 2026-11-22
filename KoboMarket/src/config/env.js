// Loads .env and validates every variable ONCE at startup.
// If anything is missing or wrong, the app refuses to start (fail fast)
// instead of crashing later in the middle of a payment.
//
// Tests (NODE_ENV=test, which Jest sets automatically) read .env.test instead,
// so they use the separate kobomarket_test databases.
// Inside Docker there is no .env file: compose passes the variables directly,
// and dotenv silently does nothing.
const path = require('path');
const { z } = require('zod');
const cron = require('node-cron');

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
require('dotenv').config({ path: path.join(__dirname, '..', '..', envFile), quiet: true });

// Durations like "15m", "7d", "30s", "1h"
const DURATION = /^\d+[smhd]$/;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Used to build links in emails, e.g. the verify-email link.
  APP_BASE_URL: z.string().default('http://localhost:3000'),

  MONGO_URI: z.string().startsWith('mongodb', 'MONGO_URI must start with mongodb'),

  PG_HOST: z.string().min(1),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_USER: z.string().min(1),
  PG_PASSWORD: z.string().min(1),
  PG_DATABASE: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().regex(DURATION, 'use a format like 15m').default('15m'),
  REFRESH_TOKEN_TTL: z.string().regex(DURATION, 'use a format like 7d').default('7d'),

  // bcrypt work factor: each +1 doubles the time to hash (12 = about 250 ms).
  // Tests use 4 so creating hundreds of test users stays fast; production must be >= 10.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  PAYSTACK_SECRET_KEY: z.string().min(1),
  // mock = built-in fake Paystack (dev/tests); live = real api.paystack.co (use a TEST key)
  PAYSTACK_MODE: z.enum(['mock', 'live']).default('mock'),
  PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
  // Where the MOCK provider sends its webhooks (the real Paystack uses its dashboard setting).
  WEBHOOK_TARGET_URL: z.url().default('http://localhost:3000/api/v1/webhooks/paystack'),
  // Mock transfers succeed unless this is 'failed' (or the account number ends in 0000).
  MOCK_TRANSFER_OUTCOME: z.enum(['success', 'failed']).default('success'),

  // Basis points: 10000 bps = 100%
  COMMISSION_RATE_BPS: z.coerce.number().int().min(0).max(10000).default(500),
  ESCROW_TIMEOUT_HOURS: z.coerce.number().int().positive().default(72),
  // When the auto-complete job runs (cron syntax). Default: every minute.
  AUTO_COMPLETE_CRON: z
    .string()
    .default('* * * * *')
    .refine((value) => cron.validate(value), 'must be a valid cron expression, e.g. "* * * * *"'),
  PAYOUT_MIN_KOBO: z.coerce.number().int().positive().default(100000),
  // When the payout job runs (cron syntax). Default: every minute.
  PAYOUT_JOB_CRON: z
    .string()
    .default('* * * * *')
    .refine((value) => cron.validate(value), 'must be a valid cron expression, e.g. "* * * * *"'),

  CORS_ORIGIN: z.string().min(1),
})
  // A low bcrypt cost is only acceptable outside production.
  .refine((e) => e.NODE_ENV !== 'production' || e.BCRYPT_COST >= 10, {
    message: 'must be at least 10 in production',
    path: ['BCRYPT_COST'],
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // Only print variable names and reasons, never the values (they may be secrets).
  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables:\n${problems}`);
}

const env = {
  ...result.data,
  // "http://a.com, http://b.com" -> ['http://a.com', 'http://b.com']
  CORS_ORIGINS: result.data.CORS_ORIGIN.split(',').map((o) => o.trim()),
  isProduction: result.data.NODE_ENV === 'production',
};

module.exports = Object.freeze(env);
