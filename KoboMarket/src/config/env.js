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

  PAYSTACK_SECRET_KEY: z.string().min(1),

  // Basis points: 10000 bps = 100%
  COMMISSION_RATE_BPS: z.coerce.number().int().min(0).max(10000).default(500),
  ESCROW_TIMEOUT_HOURS: z.coerce.number().int().positive().default(72),
  PAYOUT_MIN_KOBO: z.coerce.number().int().positive().default(100000),

  CORS_ORIGIN: z.string().min(1),
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
