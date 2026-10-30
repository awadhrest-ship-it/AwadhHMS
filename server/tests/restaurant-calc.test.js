// Phase 6 - pure money / bill-calculation tests (no database needed).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, fromMinor, isMoney, percentOf, allocate } = require('../services/restaurant/money');
const { calcBill } = require('../services/restaurant/calc');

const L = (name, unitPrice, quantity, taxable = true) => ({ orderItem: name, name, unitPrice, quantity, taxable });
const TAX5 = [{ code: 'T5', name: 'Test tax', ratePercent: 5 }];

test('money: paise conversion is exact for typical prices and never drifts', () => {
  assert.equal(toMinor(33.33), 3333); assert.equal(toMinor(0.1 + 0.2), 30); assert.equal(toMinor(1.15), 115); assert.equal(toMinor(19.99), 1999);
  assert.equal(fromMinor(1234), 12.34); assert.ok(isMoney(10.25)); assert.ok(!isMoney(10.255)); assert.ok(!isMoney(NaN));
  let total = 0; for (let i = 0; i < 1000; i += 1) total += toMinor(0.1); assert.equal(total, 10000);   // 1000 x 0.10 is exactly 100.00 (10000 paise)
});
test('money: percentages round half-up in paise', () => {
  assert.equal(percentOf(9999, 5), 500); assert.equal(percentOf(61650, 5), 3083); assert.equal(percentOf(100, 2.5), 3); assert.equal(percentOf(0, 18), 0); assert.equal(percentOf(1000, 18), 180);
});
test('money: allocate always adds up exactly and is deterministic', () => {
  assert.deepEqual(allocate(500, [3333, 3333, 3333]), [167, 167, 166]);
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]); assert.deepEqual(allocate(7, [0, 0]), [7, 0]);
  for (let n = 0; n < 200; n += 1) { const w = [1 + (n % 7), 3 + (n % 5), 11, n % 3]; const t = 1 + n * 13; assert.equal(allocate(t, w).reduce((a, b) => a + b, 0), t); }
});
test('bill: no tax configured means no tax (nothing is invented)', () => {
  const c = calcBill({ lines: [L('a', 260, 2), L('b', 55, 3)], taxes: [] });
  assert.equal(c.grossMinor, 68500); assert.equal(c.taxMinor, 0); assert.equal(c.totalMinor, 68500);
});
test('bill: tax on net, 10% discount, and the line discounts add up to the bill discount', () => {
  const adj = [{ kind: 'Discount', status: 'Applied', mode: 'percent', value: 10 }];
  const c = calcBill({ lines: [L('a', 260, 2), L('b', 55, 3)], adjustments: adj, taxes: TAX5 });
  assert.equal(c.discountMinor, 6850); assert.equal(c.netMinor, 61650); assert.equal(c.taxMinor, 3083); assert.equal(c.totalMinor, 64733);
  assert.equal(c.rows.reduce((s, r) => s + r.discount, 0), c.discountMinor);
});
test('bill: pending / rejected adjustments have NO effect; only Applied ones count', () => {
  const base = calcBill({ lines: [L('a', 100, 2)], taxes: TAX5 }).totalMinor;
  for (const status of ['Pending', 'Rejected', 'Superseded']) assert.equal(calcBill({ lines: [L('a', 100, 2)], adjustments: [{ kind: 'Discount', status, mode: 'amount', value: 50 }], taxes: TAX5 }).totalMinor, base);
});
test('bill: complimentary items are neither charged nor taxed; non-taxable items carry no tax', () => {
  const c = calcBill({ lines: [L('a', 200, 2), L('w', 30, 1, false)], adjustments: [{ kind: 'Complimentary', status: 'Applied', lines: [{ orderItem: 'a', quantity: 1 }] }], taxes: TAX5 });
  assert.equal(c.complimentaryMinor, 20000);
  assert.equal(c.grossMinor, 43000); assert.equal(c.netMinor, 23000); assert.equal(c.taxableMinor, 20000); assert.equal(c.taxMinor, 1000); assert.equal(c.totalMinor, 24000);
});
test('bill: a discount can never exceed the bill', () => {
  const c = calcBill({ lines: [L('a', 100, 1)], adjustments: [{ kind: 'Discount', status: 'Applied', mode: 'amount', value: 999 }], taxes: TAX5 });
  assert.equal(c.discountMinor, 10000); assert.equal(c.totalMinor, 0);
});
test('bill: many awkward prices never produce a fractional paisa and totals are internally consistent', () => {
  for (let n = 1; n <= 150; n += 1) {
    const lines = [L('x', 33.33 + (n % 9) * 0.01, 1 + (n % 4)), L('y', 12.5 + n * 0.07, 2)];
    const adj = n % 2 ? [{ kind: 'Discount', status: 'Applied', mode: 'percent', value: 3 + (n % 12) }] : [];
    const c = calcBill({ lines, adjustments: adj, taxes: [{ code: 'A', name: 'A', ratePercent: 2.5 }, { code: 'B', name: 'B', ratePercent: 9 }] });
    for (const v of [c.grossMinor, c.netMinor, c.taxMinor, c.totalMinor, ...c.taxLines.map((t) => t.amountMinor)]) assert.ok(Number.isInteger(v));
    assert.equal(c.totalMinor, c.netMinor + c.taxMinor); assert.equal(c.netMinor, c.grossMinor - c.complimentaryMinor - c.discountMinor);
  }
});
