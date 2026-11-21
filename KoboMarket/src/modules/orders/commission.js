// Commission maths, BigInt only.
//
//   commission   = subtotal * bps / 10000   (bps = basis points: 500 bps = 5%)
//   vendorAmount = subtotal - commission
//
// BigInt division drops the remainder (333n * 500n / 10000n = 16n, not 16.65),
// i.e. it rounds DOWN. So the platform never takes more than its rate, and
// commission + vendorAmount always equals the subtotal exactly (no kobo lost).

const BPS_DENOMINATOR = 10000n;

function splitCommission(subtotalKobo, rateBps) {
  if (typeof subtotalKobo !== 'bigint' || subtotalKobo < 0n) {
    throw new TypeError('subtotalKobo must be a non-negative BigInt');
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
    throw new TypeError('rateBps must be an integer from 0 to 10000');
  }
  const commissionKobo = (subtotalKobo * BigInt(rateBps)) / BPS_DENOMINATOR;
  return { commissionKobo, vendorAmountKobo: subtotalKobo - commissionKobo };
}

module.exports = { splitCommission };
