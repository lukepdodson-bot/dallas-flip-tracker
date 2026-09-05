const test   = require('node:test');
const assert = require('node:assert');
const { splitCommission, minimumViablePrice, fmt } = require('../services/money');

test('splits reconcile to the penny', () => {
  for (const priceCents of [1000, 12345, 99999, 250000, 333333, 1000001]) {
    const s = splitCommission({ priceCents, photographerBps: 1000, platformBps: 1500 });
    assert.strictEqual(s.platformCents + s.photographerCents + s.painterCents, priceCents,
      `split of ${priceCents} did not reconcile`);
  }
});

test('the painter absorbs the rounding remainder, never the buyer', () => {
  // 3 cents at 10%/15% floors both shares to 0, so the painter must get all 3.
  const s = splitCommission({ priceCents: 3, photographerBps: 1000, platformBps: 1500 });
  assert.deepStrictEqual(
    [s.platformCents, s.photographerCents, s.painterCents], [0, 0, 3]);
});

test('a per-image floor beats the percentage', () => {
  const s = splitCommission({ priceCents: 40000, photographerBps: 1000, platformBps: 1500, floorCents: 15000 });
  assert.strictEqual(s.photographerCents, 15000);
  assert.strictEqual(s.floorApplied, true);
  assert.strictEqual(s.painterCents, 40000 - 15000 - 6000);
});

test('the percentage wins when it exceeds the floor', () => {
  const s = splitCommission({ priceCents: 400000, photographerBps: 1000, platformBps: 1500, floorCents: 15000 });
  assert.strictEqual(s.photographerCents, 40000);
  assert.strictEqual(s.floorApplied, false);
});

test('a price that leaves the painter nothing is refused, and says why', () => {
  assert.throws(
    () => splitCommission({ priceCents: 10000, photographerBps: 1000, platformBps: 1500, floorCents: 15000 }),
    /leaves the painter nothing/);
});

test('minimumViablePrice is the exact boundary, not an estimate', () => {
  const args = { photographerBps: 1000, platformBps: 1500, floorCents: 15000 };
  const minimum = minimumViablePrice(args);
  assert.ok(splitCommission({ ...args, priceCents: minimum }).painterCents > 0);
  assert.throws(() => splitCommission({ ...args, priceCents: minimum - 1 }));
});

test('rejects nonsense inputs rather than producing nonsense splits', () => {
  assert.throws(() => splitCommission({ priceCents: 0, photographerBps: 1000, platformBps: 1500 }));
  assert.throws(() => splitCommission({ priceCents: 1.5, photographerBps: 1000, platformBps: 1500 }));
  assert.throws(() => splitCommission({ priceCents: 1000, photographerBps: 6000, platformBps: 5000 }));
});

test('formats money without floating point drift', () => {
  assert.strictEqual(fmt(0), '$0.00');
  assert.strictEqual(fmt(5), '$0.05');
  assert.strictEqual(fmt(123456789), '$1,234,567.89');
});
