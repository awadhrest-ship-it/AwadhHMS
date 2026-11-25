import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesSince, fmtMin, cardState, filterCards, laneOf } from './kitchenMath.js';

const NOW = Date.parse('2026-11-01T10:00:00Z'); const ago = (m) => new Date(NOW - m * 60000).toISOString();
test('minutesSince / fmtMin', () => {
  assert.equal(minutesSince(ago(7), NOW), 7); assert.equal(minutesSince(null, NOW), null); assert.equal(minutesSince(new Date(NOW + 5000).toISOString(), NOW), 0);
  assert.equal(fmtMin(7.9), '7 min'); assert.equal(fmtMin(65), '1 h 05 min'); assert.equal(fmtMin(null), '-');
});
test('cardState: delay comes from the clock too, finished work is never active/delayed', () => {
  const base = { status: 'Queued', queuedAt: ago(25), thresholdMinutes: 20, delayed: false };
  assert.equal(cardState(base, NOW).delayed, true); assert.equal(Math.round(cardState(base, NOW).over), 5); assert.equal(cardState(base, NOW).key, 'delayed');
  assert.equal(cardState({ ...base, queuedAt: ago(5) }, NOW).key, 'queued'); assert.equal(cardState({ ...base, queuedAt: ago(5), isNew: true }, NOW).key, 'new');
  assert.equal(cardState({ ...base, status: 'Preparing', queuedAt: ago(5) }, NOW).key, 'preparing');
  const ready = cardState({ ...base, status: 'Ready', elapsedMinutes: 40 }, NOW); assert.equal(ready.delayed, false); assert.equal(ready.active, false); assert.equal(ready.key, 'ready');
  assert.equal(cardState({ ...base, status: 'Cancelled' }, NOW).delayed, false); assert.equal(cardState({ ...base, status: 'Cancelled' }, NOW).key, 'cancelled');
});
test('filterCards + laneOf', () => {
  const cards = [{ station: 'Indian', orderType: 'Dine-in', status: 'Queued', queuedAt: ago(30), thresholdMinutes: 20, isNew: false }, { station: 'Tandoor', orderType: 'Takeaway', status: 'Preparing', queuedAt: ago(2), thresholdMinutes: 20, isNew: false }, { station: 'Indian', orderType: 'Room Service', status: 'Queued', queuedAt: ago(1), thresholdMinutes: 20, isNew: true }];
  assert.equal(filterCards(cards, { station: 'Indian' }, NOW).length, 2); assert.equal(filterCards(cards, { delayedOnly: true }, NOW).length, 1); assert.equal(filterCards(cards, { newOnly: true }, NOW).length, 1); assert.equal(filterCards(cards, { orderType: 'Takeaway' }, NOW).length, 1);
  assert.deepEqual(cards.map(laneOf), ['new', 'preparing', 'new']); assert.equal(laneOf({ status: 'Served' }), 'done');
});
