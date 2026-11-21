// Money helpers. Rules:
//  - Money is whole kobo. Arithmetic on money uses BigInt (e.g. 1500n + 250n).
//  - Postgres BIGINT arrives as a string ("150000"): convert with BigInt(value).
//  - JSON has no BigInt, so API responses use plain numbers, but only when the
//    value is exactly representable (|value| <= Number.MAX_SAFE_INTEGER).
const AppError = require('./AppError');

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// bigint | "123" (from Postgres) | safe integer number  ->  bigint
function toKoboBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new AppError('INVALID_MONEY_VALUE', `Not a whole-kobo amount: ${String(value)}`, 500);
}

// For API output. Throws instead of silently returning a wrong (rounded) number.
function toKoboNumber(value) {
  const amount = toKoboBigInt(value);
  if (amount > MAX_SAFE || amount < -MAX_SAFE) {
    throw new AppError('MONEY_AMOUNT_UNSAFE', 'Money amount is too large to send as a JSON number', 500);
  }
  return Number(amount);
}

module.exports = { toKoboBigInt, toKoboNumber };
