// Run with: node --test client/src/utils   (no extra tooling needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, fromMinor, percentOf, estimateCart } from './restaurantMath.js';
test('paise conversion is exact', () => { assert.equal(toMinor(33.33), 3333); assert.equal(toMinor(0.1 + 0.2), 30); assert.equal(fromMinor(64733), 647.33); });
test('percent rounds half-up like the server', () => { assert.equal(percentOf(61650, 5), 3083); assert.equal(percentOf(9999, 5), 500); assert.equal(percentOf(0, 18), 0); });
test('cart estimate: no tax configured means no tax', () => { const e = estimateCart([{ price: 260, quantity: 2 }, { price: 55, quantity: 3 }]); assert.equal(e.grossMinor, 68500); assert.equal(e.totalMinor, 68500); });
test('cart estimate: non-taxable lines are excluded from tax', () => { const e = estimateCart([{ price: 200, quantity: 1 }, { price: 30, quantity: 1, taxable: false }], [{ code: 'T', name: 'T', ratePercent: 5 }]); assert.equal(e.taxMinor, 1000); assert.equal(e.totalMinor, 24000); });
