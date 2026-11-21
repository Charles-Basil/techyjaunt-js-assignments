// Pure unit tests: no database.
const { TRANSITIONS, assertTransition, deriveOrderStatus } = require('../src/modules/orders/orderStateMachine');
const { splitCommission } = require('../src/modules/orders/commission');

describe('assertTransition', () => {
  const allowed = Object.entries(TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => [from, to]));

  test.each(allowed)('%s -> %s is allowed', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  test.each([
    ['PAID', 'COMPLETED'], // can't complete without shipping
    ['PAID', 'DELIVERED'],
    ['PENDING_PAYMENT', 'SHIPPED'],
    ['SHIPPED', 'PAID'], // no going back
    ['SHIPPED', 'CANCELLED'], // too late to cancel
    ['DELIVERED', 'SHIPPED'],
    ['DISPUTED', 'CANCELLED'],
    ['COMPLETED', 'REFUNDED'], // final states are final
    ['CANCELLED', 'PAID'],
    ['REFUNDED', 'COMPLETED'],
    ['UNKNOWN', 'PAID'],
  ])('%s -> %s throws 409 INVALID_STATE_TRANSITION', (from, to) => {
    let error;
    try {
      assertTransition(from, to);
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      statusCode: 409,
      details: { from, to, allowed: TRANSITIONS[from] || [] },
    });
  });

  test('every status in the table is covered and final states have no exits', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      ['CANCELLED', 'COMPLETED', 'DELIVERED', 'DISPUTED', 'PAID', 'PENDING_PAYMENT', 'REFUNDED', 'SHIPPED'].sort()
    );
    for (const final of ['COMPLETED', 'CANCELLED', 'REFUNDED']) expect(TRANSITIONS[final]).toEqual([]);
  });
});

describe('deriveOrderStatus', () => {
  test.each([
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
    [['COMPLETED', 'COMPLETED'], 'COMPLETED'],
    [['COMPLETED', 'CANCELLED'], 'COMPLETED'],
    [['COMPLETED', 'REFUNDED'], 'COMPLETED'],
    [['REFUNDED', 'CANCELLED'], 'REFUNDED'],
    [['REFUNDED'], 'REFUNDED'],
    [['PAID', 'COMPLETED'], 'IN_PROGRESS'],
    [['SHIPPED', 'CANCELLED'], 'IN_PROGRESS'],
    [['DISPUTED'], 'IN_PROGRESS'],
  ])('%j -> %s', (statuses, expected) => {
    expect(deriveOrderStatus(statuses)).toBe(expected);
  });
});

describe('splitCommission (BigInt, rounds down)', () => {
  test('100000 at 500 bps -> 5000 commission, 95000 vendor', () => {
    expect(splitCommission(100000n, 500)).toEqual({ commissionKobo: 5000n, vendorAmountKobo: 95000n });
  });

  test('rounding: 333 at 500 bps -> 16 commission (16.65 rounded down), 317 vendor', () => {
    expect(splitCommission(333n, 500)).toEqual({ commissionKobo: 16n, vendorAmountKobo: 317n });
  });

  test('commission + vendor amount always equals the subtotal', () => {
    for (const [subtotal, bps] of [[1n, 500], [19n, 333], [999999n, 1], [12345678901234n, 750], [7n, 10000], [7n, 0]]) {
      const { commissionKobo, vendorAmountKobo } = splitCommission(subtotal, bps);
      expect(commissionKobo + vendorAmountKobo).toBe(subtotal);
      expect(commissionKobo * 10000n <= subtotal * BigInt(bps)).toBe(true); // never above the rate
    }
  });

  test('edge rates and bad input', () => {
    expect(splitCommission(1000n, 0)).toEqual({ commissionKobo: 0n, vendorAmountKobo: 1000n });
    expect(splitCommission(1000n, 10000)).toEqual({ commissionKobo: 1000n, vendorAmountKobo: 0n });
    expect(() => splitCommission(1000, 500)).toThrow(TypeError); // a JS number, not BigInt
    expect(() => splitCommission(1000n, 10001)).toThrow(TypeError);
    expect(() => splitCommission(1000n, 2.5)).toThrow(TypeError);
  });
});
