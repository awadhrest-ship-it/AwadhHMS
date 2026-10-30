// Pure unit tests (no database): unit conversion maths, integer micro-unit rounding.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../services/inventory/units');
const map = new Map(U.DEFAULT_UNITS.map(([code, name, dimension, toBase]) => [code, { code, name, dimension, toBase }]));

test('standard weight / volume / count conversions are exact', () => {
  const item = { name: 'Flour', baseUnit: 'kg', conversions: [] };
  assert.equal(U.toBase(item, 500, 'g', map).baseQty, 0.5);
  assert.equal(U.toBase({ baseUnit: 'ml', conversions: [] }, 1.5, 'l', map).baseQty, 1500);
  assert.equal(U.toBase({ baseUnit: 'pcs', conversions: [] }, 2, 'dozen', map).baseQty, 24);
});
test('package units need an explicit per-item conversion; cross-dimension is refused', () => {
  const rice = { name: 'Rice', baseUnit: 'kg', conversions: [{ unit: 'bag', factor: 25 }] };
  assert.equal(U.toBase(rice, 3, 'bag', map).baseQty, 75);
  assert.throws(() => U.toBase(rice, 1, 'carton', map), /conversion/i);
  assert.throws(() => U.toBase(rice, 1, 'l', map), /conversion|convert/i);
});
test('quantities are validated and stored as exact integers (no floating-point drift)', () => {
  const item = { baseUnit: 'kg', conversions: [] };
  assert.throws(() => U.toBase(item, 0, 'kg', map)); assert.throws(() => U.toBase(item, -1, 'kg', map)); assert.throws(() => U.toBase(item, 'abc', 'kg', map));
  let q = 0; for (let i = 0; i < 10; i += 1) q += U.toBase(item, 0.1, 'kg', map).qtyQ;
  assert.equal(U.fromQ(q), 1);   // ten additions of 0.1 are exactly 1, which 0.1*10 in floating point is not guaranteed to be
  assert.equal(U.fromBase({ baseUnit: 'kg', conversions: [{ unit: 'bag', factor: 25 }] }, 50, 'bag', map), 2);
  assert.equal(U.fromBase({ baseUnit: 'kg', conversions: [] }, 1, 'l', map), null);
});
