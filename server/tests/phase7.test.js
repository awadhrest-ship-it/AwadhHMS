// Phase 7 - Kitchen & Kitchen Display. Requires a MongoDB-compatible server: MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const M = require('../models');
const stockSvc = require('../services/inventory/stock');
const delays = require('../services/kitchen/delays');
const consumption = require('../services/kitchen/consumption');
const { runMigrations } = require('../migrations');

let c; const call = (...a) => c.call(...a);
const LOGINS = { owner: 'owner@awadhpalace.test', gm: 'gm@awadhpalace.test', rest: 'restaurant@awadhpalace.test', captain: 'captain@awadhpalace.test', kitchen: 'kitchen@awadhpalace.test', chef: 'chef@awadhpalace.test',
  head: 'headchef@awadhpalace.test', store: 'store@awadhpalace.test', cashier: 'cashier@awadhpalace.test', hk: 'housekeeping@awadhpalace.test', director: 'director@awadhpalace.test' };
before(async () => { c = await boot(LOGINS); });
after(async () => { await c.close(); });

let n = 0; const key = () => `k7-${Date.now()}-${++n}-abcdef`;
const item = async (code) => (await call('rest', 'GET', '/restaurant/menu/items?q=' + code)).data.find((i) => i.code === code);
const L = async (code, quantity, notes) => ({ menuItem: (await item(code))._id, quantity, ...(notes ? { notes } : {}) });
const mkOrder = (who, body, k = key()) => call(who, 'POST', '/restaurant/orders', body, { 'Idempotency-Key': k });
const setStation = (code, station) => item(code).then((i) => call('kitchen', 'PUT', `/kitchen/menu/${i._id}/station`, { station }));
const board = async (who = 'kitchen', q = '') => (await call(who, 'GET', '/kitchen/board' + q)).data;
const cardsOf = async (orderNumber, who = 'kitchen') => (await board(who)).cards.filter((x) => x.orderNumber === orderNumber);
const kstock = async (sku, dept = 'Kitchen') => { const it = await M.InventoryItem.findOne({ sku }); const rows = await M.StockBalance.find({ item: it._id, department: dept }); return rows.reduce((s, r) => s + r.qtyQ, 0) / 1e6; };
const move = (who, body, k = key()) => call(who, 'POST', '/inventory/movements', body, { 'Idempotency-Key': k });
const T = {};
async function ingredient(sku, name, baseUnit, { conv, qty = 0, price, unit } = {}) {
  const cat = (await call('store', 'GET', '/inventory/categories')).data.find((x) => x.key === 'food_ingredients');
  const body = { sku, name, category: cat._id, baseUnit, usageUnit: baseUnit, ...(conv ? { conversions: conv } : {}), ...(qty ? { openingStock: [{ department: 'Kitchen', quantity: qty, unit: unit || baseUnit, expiryDate: '2027-12-31', ...(price != null ? { unitPrice: price } : {}) }] } : {}) };
  const r = await call('store', 'POST', '/inventory/items', body); assert.equal(r.status, 201, JSON.stringify(r)); return r.data._id || r.data.item?._id;
}
const finalise = async (who, orderId) => { const b = await call(who, 'POST', `/restaurant/orders/${orderId}/bills`, {}); assert.equal(b.status, 201, JSON.stringify(b)); const f = await call(who, 'POST', `/restaurant/bills/${b.data[0]._id}/finalise`); assert.equal(f.status, 200, JSON.stringify(f)); return { bill: f.data }; };
async function readyOrder(orderId) { // drive every ticket of an order to Served through the real endpoints (whole-ticket legacy action)
  const o = (await call('rest', 'GET', `/restaurant/orders/${orderId}`)).data;
  for (const t of o.tickets) { for (const s of ['Preparing', 'Ready']) assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${t._id}/status`, { status: s })).status, 200); }
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${orderId}/serve`)).status, 200);
}

/* ------------------------------------------------------------------ permissions & security */
test('security: kitchen endpoints are authorised on the server, per role', async () => {
  assert.equal((await call(null, 'GET', '/kitchen/board')).status, 401);
  assert.equal((await call('hk', 'GET', '/kitchen/board')).status, 403);          // other department
  assert.equal((await call('captain', 'GET', '/kitchen/board')).status, 403);     // restaurant order-taking role has no kitchen display right by default
  for (const who of ['kitchen', 'chef', 'head', 'rest', 'owner']) assert.equal((await call(who, 'GET', '/kitchen/board')).status, 200, who);
  const it = await item('ST01');
  assert.equal((await call('chef', 'PUT', `/kitchen/menu/${it._id}/station`, { station: 'Tandoor' })).status, 403);   // chefs cannot restructure stations
  assert.equal((await call('chef', 'PUT', '/kitchen/settings', { delay: { defaultMinutes: 5 } })).status, 403);
  assert.equal((await call('chef', 'GET', '/kitchen/performance')).status, 403);
  assert.equal((await call('chef', 'POST', '/kitchen/recipes', { menuItem: it._id, ingredients: [] })).status, 403);
  assert.equal((await call('chef', 'POST', '/kitchen/prep', { tasks: [] })).status, 403);
  assert.equal((await call('chef', 'GET', '/kitchen/consumption')).status, 403);
  assert.equal((await call('store', 'POST', '/kitchen/wastage', {}, { 'Idempotency-Key': key() })).status, 403);        // store manager reviews, does not record kitchen waste
  assert.equal((await call('store', 'GET', '/kitchen/consumption')).status, 200);
  assert.equal((await call('director', 'GET', '/kitchen/board')).status, 403);
  assert.equal((await call('kitchen', 'GET', '/kitchen/performance')).status, 200); assert.equal((await call('head', 'GET', '/kitchen/performance')).status, 200);
  assert.equal((await call('captain', 'POST', '/kitchen/tickets/000000000000000000000000/items/status', { to: 'Ready', station: 'Indian' })).status, 403);
});

/* ------------------------------------------------------------------ stations */
test('stations: four stations; items start Unassigned (never guessed); assignment is validated, permissioned and audited', async () => {
  const s = await call('kitchen', 'GET', '/kitchen/settings'); assert.deepEqual(s.stations, ['Main kitchen', 'Indian', 'Chinese', 'Tandoor']);
  const un = await call('kitchen', 'GET', '/kitchen/menu?station=unassigned'); assert.ok(un.data.length >= 10); assert.ok(un.data.every((m) => m.station === null));
  assert.equal((await setStation('ST01', 'Italian')).status, 400);
  for (const [code, st] of [['ST01', 'Tandoor'], ['BR01', 'Tandoor'], ['MC01', 'Indian'], ['MC02', 'Indian'], ['ST03', 'Chinese'], ['DS01', 'Main kitchen']]) assert.equal((await setStation(code, st)).status, 200);
  assert.equal((await item('ST01')).station, 'Tandoor'); assert.equal((await item('BV01')).station, null);      // untouched items stay Unassigned
  const bulk = await call('kitchen', 'POST', '/kitchen/menu/stations', { items: [{ menuItem: (await item('MC03'))._id, station: 'Indian' }] }); assert.equal(bulk.status, 200);
  const au = await call('owner', 'GET', '/audit-logs?module=Kitchen&limit=100'); assert.ok(au.data.some((a) => a.entityLabel === 'Paneer Tikka station'));
});

/* ------------------------------------------------------------------ 7.1 tickets, routing, item-level status */
test('routing: one ticket per round, each station sees only its items, Unassigned items stay visible, duplicates create nothing new', async () => {
  const body = { type: 'Dine-in', table: (await call('rest', 'GET', '/restaurant/tables')).data.find((t) => t.number === 'T1')._id, covers: 2, notes: 'Birthday table', items: [await L('ST01', 2, 'extra spicy'), await L('MC01', 1), await L('ST03', 1), await L('BV01', 2, 'no sugar')] };
  const k = key(); const r = await mkOrder('captain', body, k); assert.equal(r.status, 201, JSON.stringify(r)); T.dine = r.data;
  const again = await mkOrder('captain', body, k); assert.equal(again.data._id, T.dine._id);                              // retried submit: same order
  const send = await call('captain', 'POST', `/restaurant/orders/${T.dine._id}/send`); assert.equal(send.status, 200);
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${T.dine._id}/send`)).status, 200);                      // resend is a no-op
  const o = (await call('rest', 'GET', `/restaurant/orders/${T.dine._id}`)).data; assert.equal(o.tickets.length, 1); T.ticket = o.tickets[0]._id; T.orderNumber = o.orderNumber;
  const cards = await cardsOf(T.orderNumber); assert.deepEqual(cards.map((x) => x.station).sort(), ['Chinese', 'Indian', 'Tandoor', 'Unassigned']);
  const tandoor = cards.find((x) => x.station === 'Tandoor'); assert.equal(tandoor.items.length, 1); assert.equal(tandoor.items[0].notes, 'extra spicy'); assert.equal(tandoor.orderNotes, 'Birthday table');
  assert.equal(tandoor.orderType, 'Dine-in'); assert.equal(tandoor.tableNumber, 'T1'); assert.equal(tandoor.status, 'Queued'); assert.ok(tandoor.isNew); assert.equal(tandoor.hasMultipleStations, true);
  assert.equal(cards.find((x) => x.station === 'Unassigned').items[0].name, 'Masala Chai');
  assert.equal(await M.KitchenTicket.countDocuments({ order: T.dine._id }), 1);
  const t = await M.KitchenTicket.findById(T.ticket); assert.equal(t.round, 1); assert.equal(t.orderNumber, T.orderNumber); assert.ok(t.orderRound.endsWith(':1'));
});
test('station-restricted chef only sees and moves their own station; unassigned items are managers\' work', async () => {
  const roles = (await call('owner', 'GET', '/roles')).data; const chefRole = roles.find((r) => r.key === 'chef')._id;
  const u = await call('owner', 'POST', '/users', { name: 'Tandoor Chef', email: 'tandoor@awadhpalace.test', password: 'Awadh@123', role: chefRole, department: 'Kitchen', kitchenStations: ['Tandoor'] }); assert.equal(u.status, 201, JSON.stringify(u));
  const l = await call(null, 'POST', '/auth/login', { email: 'tandoor@awadhpalace.test', password: 'Awadh@123' }); c.tokens.tchef = l.token; T.tchefId = u.data._id;
  const b = await board('tchef'); assert.deepEqual(b.stations, ['Tandoor']); assert.ok(b.cards.every((x) => x.station === 'Tandoor')); assert.ok(b.cards.some((x) => x.orderNumber === T.orderNumber));
  assert.equal((await call('tchef', 'GET', '/kitchen/board?station=Indian')).status, 403);
  assert.equal((await call('tchef', 'GET', '/kitchen/board?station=Unassigned')).status, 403);
  assert.equal((await call('tchef', 'POST', `/kitchen/tickets/${T.ticket}/items/status`, { to: 'Preparing', station: 'Indian' })).status, 403);
  assert.equal((await call('tchef', 'POST', `/kitchen/tickets/${T.ticket}/items/status`, { to: 'Preparing', station: 'Unassigned' })).status, 403);
  const kb = await board('kitchen'); assert.ok(kb.stations.includes('Unassigned')); assert.ok(kb.unassignedMenuItems > 0);
});
test('item level: stations progress independently; the ticket is Ready only when EVERY item is Ready; Ready is not Served', async () => {
  const st = (s, to) => call(s.who, 'POST', `/kitchen/tickets/${T.ticket}/items/status`, { to, station: s.station });
  assert.equal((await st({ who: 'tchef', station: 'Tandoor' }, 'Ready')).status, 400);                                   // Queued -> Ready is not allowed
  assert.equal((await st({ who: 'tchef', station: 'Tandoor' }, 'Preparing')).status, 200);
  let tk = await M.KitchenTicket.findById(T.ticket); assert.equal(tk.status, 'Preparing');
  assert.equal((await cardsOf(T.orderNumber)).find((x) => x.station === 'Indian').status, 'Queued');                       // other stations untouched
  assert.equal((await st({ who: 'tchef', station: 'Tandoor' }, 'Preparing')).status, 400);                                // already preparing
  assert.equal((await st({ who: 'tchef', station: 'Tandoor' }, 'Ready')).status, 200);
  tk = await M.KitchenTicket.findById(T.ticket); assert.equal(tk.status, 'Preparing', 'one station ready must not make the whole ticket ready');
  assert.equal((await call('rest', 'GET', `/restaurant/orders/${T.dine._id}`)).data.status, 'Preparing');
  for (const s of ['Indian', 'Chinese', 'Unassigned']) { assert.equal((await st({ who: 'kitchen', station: s }, 'Preparing')).status, 200); }
  assert.equal((await st({ who: 'kitchen', station: 'Indian' }, 'Ready')).status, 200); assert.equal((await st({ who: 'kitchen', station: 'Chinese' }, 'Ready')).status, 200);
  assert.equal((await M.KitchenTicket.findById(T.ticket)).status, 'Preparing');
  assert.equal((await st({ who: 'kitchen', station: 'Unassigned' }, 'Ready')).status, 200);
  tk = await M.KitchenTicket.findById(T.ticket); assert.equal(tk.status, 'Ready'); assert.ok(tk.readyAt); assert.ok(tk.items.every((i) => i.status === 'Ready' && i.readyByName));
  assert.equal((await call('rest', 'GET', `/restaurant/orders/${T.dine._id}`)).data.status, 'Ready');
  assert.notEqual(tk.status, 'Served');
  assert.equal((await call('chef', 'POST', `/restaurant/tickets/${T.ticket}/status`, { status: 'Served' })).status, 403);   // serving is front-of-house
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${T.dine._id}/serve`)).status, 200);
  tk = await M.KitchenTicket.findById(T.ticket); assert.equal(tk.status, 'Served'); assert.ok(tk.items.every((i) => i.status === 'Served'));
  assert.ok(tk.history.length >= 7 && tk.history.every((h) => h.byName && h.at), 'every status change records who and when');
  const au = await call('owner', 'GET', '/audit-logs?module=Kitchen&limit=100'); assert.ok(au.data.some((a) => a.entity === 'KitchenTicket' && a.action === 'status'));
});
test('backward compatible: the Phase 6 ticket-level endpoint still works and keeps items consistent; unassigned items can be re-routed by a manager only', async () => {
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Legacy' }, items: [await L('BV01', 1), await L('BR01', 1)], send: true }); assert.equal(r.status, 201); const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data; const tk = o.tickets[0]._id;
  const unassigned = (await M.KitchenTicket.findById(tk)).items.find((i) => !i.station);
  assert.equal((await call('chef', 'PATCH', `/kitchen/tickets/${tk}/items/${unassigned._id}/station`, { station: 'Indian' })).status, 403);
  assert.equal((await call('kitchen', 'PATCH', `/kitchen/tickets/${tk}/items/${unassigned._id}/station`, { station: 'Indian' })).status, 200);
  assert.ok((await cardsOf(o.orderNumber)).some((x) => x.station === 'Indian' && x.items[0].name === 'Masala Chai'));
  assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' })).status, 200);
  assert.ok((await M.KitchenTicket.findById(tk)).items.every((i) => i.status === 'Preparing'));
  assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' })).status, 200);
  assert.equal((await M.KitchenTicket.findById(tk)).status, 'Ready'); await call('captain', 'POST', `/restaurant/orders/${r.data._id}/serve`);
});
test('cancelled items and orders are reflected on the display', async () => {
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Cancel' }, items: [await L('MC01', 1), await L('ST01', 1)], send: true }); const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data;
  const oi = o.items.find((i) => i.name === 'Paneer Tikka');
  assert.equal((await call('captain', 'DELETE', `/restaurant/orders/${o._id}/items/${oi._id}`, { reason: 'x' })).status, 403);   // a sent item needs a manager
  assert.equal((await call('rest', 'DELETE', `/restaurant/orders/${o._id}/items/${oi._id}`, { reason: 'Guest changed mind' })).status, 200);
  const cards = await cardsOf(o.orderNumber); assert.equal(cards.find((x) => x.station === 'Tandoor').status, 'Cancelled'); assert.equal(cards.find((x) => x.station === 'Indian').status, 'Queued');
  assert.equal((await M.KitchenTicket.findById(o.tickets[0]._id)).status, 'Queued');
  assert.equal((await call('rest', 'POST', `/restaurant/orders/${o._id}/cancel`, { reason: 'Walked out' })).status, 200);
  const after = await cardsOf(o.orderNumber); assert.ok(after.every((x) => x.status === 'Cancelled')); assert.equal((await board()).cards.filter((x) => x.orderNumber === o.orderNumber && ['Queued', 'Preparing'].includes(x.status)).length, 0);
});
test('legacy tickets (created before Phase 7, no item status) are read correctly and can be moved', async () => {
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Old' }, items: [await L('MC01', 1), await L('ST03', 1)], send: true }); const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data;
  await M.KitchenTicket.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(o.tickets[0]._id) }, { $set: { status: 'Preparing' }, $unset: { 'items.0.status': '', 'items.1.status': '' } });
  const cards = await cardsOf(o.orderNumber); assert.ok(cards.every((x) => x.status === 'Preparing' && x.items.every((i) => i.status === 'Preparing')));
  assert.equal((await call('kitchen', 'POST', `/kitchen/tickets/${o.tickets[0]._id}/items/status`, { to: 'Ready', station: 'Indian' })).status, 200);
  const t = await M.KitchenTicket.findById(o.tickets[0]._id); assert.equal(t.status, 'Preparing'); assert.ok(t.items.every((i) => i.status));
  await call('kitchen', 'POST', `/kitchen/tickets/${t._id}/items/status`, { to: 'Ready', station: 'Chinese' }); await call('captain', 'POST', `/restaurant/orders/${o._id}/serve`);
});

/* ------------------------------------------------------------------ 7.2 delayed orders */
const backdate = async (ticketId, minutes) => M.KitchenTicket.updateOne({ _id: ticketId }, { $set: { queuedAt: new Date(Date.now() - minutes * 60000) } });
const notes = async (who, type = 'kitchen_delay') => (await call(who, 'GET', '/notifications')).data.filter((x) => x.type === type);
test('delays: thresholds are persisted, validated and respected (station > order type > default); nothing is delayed before its limit', async () => {
  assert.equal((await call('head', 'PUT', '/kitchen/settings', { delay: { defaultMinutes: 5 } })).status, 403);       // the Head Chef sees settings but cannot change them
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { delay: { defaultMinutes: -3 } })).status, 400);
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { recipients: { roles: ['no_such_role'] } })).status, 400);
  const ok = await call('rest', 'PUT', '/kitchen/settings', { delay: { defaultMinutes: 20, stationMinutes: { Tandoor: 60 } }, recipients: { roles: ['kitchen_manager'], users: [] } }); assert.equal(ok.status, 200);
  assert.equal((await call('rest', 'GET', '/kitchen/settings')).data.delay.stationMinutes.Tandoor, 60);                // persisted in MongoDB, not UI state
  const r = await mkOrder('captain', { type: 'Dine-in', table: (await call('rest', 'GET', '/restaurant/tables')).data.find((t) => t.number === 'T2')._id, items: [await L('ST01', 1), await L('MC01', 1)], send: true }); T.delayOrder = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data;
  const tid = T.delayOrder.tickets[0]._id; T.delayTicket = tid;
  await backdate(tid, 10); assert.ok((await cardsOf(T.delayOrder.orderNumber)).every((x) => !x.delayed));
  await backdate(tid, 30); const cs = await cardsOf(T.delayOrder.orderNumber);
  assert.equal(cs.find((x) => x.station === 'Indian').delayed, true); assert.ok(cs.find((x) => x.station === 'Indian').delayMinutes >= 9);
  assert.equal(cs.find((x) => x.station === 'Tandoor').delayed, false, 'the Tandoor limit is 60 min');
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { delay: { orderTypeThresholdsEnabled: true, orderTypeMinutes: { 'Dine-in': 15 } } })).status, 200);
  assert.equal((await cardsOf(T.delayOrder.orderNumber)).find((x) => x.station === 'Indian').thresholdMinutes, 15);       // Indian has no station value, so the (now enabled) Dine-in value applies
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { delay: { orderTypeThresholdsEnabled: false } })).status, 200);
});
test('delays: ONE alert per ticket+station however often it is swept; recipients follow configuration; resolved on Ready; completed/cancelled are never delayed', async () => {
  const before = (await notes('kitchen')).length; const restBefore = (await notes('rest')).length;
  const r1 = await call('kitchen', 'POST', '/kitchen/delays/sweep'); assert.equal(r1.status, 200); assert.ok(r1.data.raised >= 1);
  const open = await M.KitchenDelayAlert.find({ ticket: T.delayTicket }); assert.equal(open.length, 1); assert.equal(open[0].station, 'Indian'); assert.equal(open[0].notifiedCount, 1);
  for (let i = 0; i < 4; i += 1) assert.equal((await call('kitchen', 'POST', '/kitchen/delays/sweep')).data.raised, 0);       // no spam
  await Promise.all([1, 2, 3].map(() => delays.sweep())); assert.equal(await M.KitchenDelayAlert.countDocuments({ ticket: T.delayTicket }), 1);
  const mine = await notes('kitchen'); assert.equal(mine.length, before + 1); assert.match(mine[0].message, new RegExp(T.delayOrder.orderNumber)); assert.match(mine[0].message, /Indian/); assert.match(mine[0].message, /Dine-in/); assert.match(mine[0].message, /delayed \d+ min/);
  assert.equal((await notes('rest')).length, restBefore, 'the restaurant manager is not a recipient in this configuration');
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { recipients: { roles: ['restaurant_manager'], users: [] } })).status, 200);   // recipients are configurable
  const r2 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Slow' }, items: [await L('MC01', 1)], send: true }); const o2 = (await call('rest', 'GET', `/restaurant/orders/${r2.data._id}`)).data; await backdate(o2.tickets[0]._id, 45);
  await delays.sweep(); assert.equal((await notes('rest')).length, restBefore + 1); assert.equal((await notes('kitchen')).length, before + 1);
  assert.equal((await call('kitchen', 'GET', '/kitchen/delays?open=true')).data.length, 2);
  // resolved when Ready -> no longer an active delay
  await call('kitchen', 'POST', `/kitchen/tickets/${o2.tickets[0]._id}/items/status`, { to: 'Preparing', station: 'Indian' }); assert.equal((await cardsOf(o2.orderNumber))[0].delayed, true);   // preparing but still late
  await call('kitchen', 'POST', `/kitchen/tickets/${o2.tickets[0]._id}/items/status`, { to: 'Ready', station: 'Indian' });
  const done = await M.KitchenDelayAlert.findOne({ ticket: o2.tickets[0]._id }); assert.equal(done.resolution, 'Ready'); assert.ok(done.resolvedAt); assert.ok(done.totalMinutes >= 44);
  assert.equal((await cardsOf(o2.orderNumber))[0].delayed, false); assert.equal((await cardsOf(o2.orderNumber))[0].lateWhenFinished, true);
  // cancelled -> resolved
  await call('rest', 'POST', `/restaurant/orders/${T.delayOrder._id}/cancel`, { reason: 'Guest left' }); assert.ok((await M.KitchenDelayAlert.findOne({ ticket: T.delayTicket })).resolvedAt);
  assert.equal((await M.KitchenDelayAlert.findOne({ ticket: T.delayTicket })).resolution, 'Cancelled');
  assert.ok((await cardsOf(T.delayOrder.orderNumber)).every((x) => !x.delayed));
  await call('captain', 'POST', `/restaurant/orders/${o2._id}/serve`);
  // switching delay tracking off raises nothing
  await call('rest', 'PUT', '/kitchen/settings', { delay: { enabled: false } }); const r3 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Off' }, items: [await L('MC01', 1)], send: true }); const o3 = (await call('rest', 'GET', `/restaurant/orders/${r3.data._id}`)).data; await backdate(o3.tickets[0]._id, 90);
  assert.equal((await delays.sweep()).raised, 0); await call('rest', 'PUT', '/kitchen/settings', { delay: { enabled: true } }); await call('rest', 'POST', `/restaurant/orders/${o3.data?._id || o3._id}/cancel`, { reason: 'test cleanup' });
});
test('delays: escalation is OFF by default; when enabled it fires exactly once', async () => {
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Esc' }, items: [await L('MC01', 1)], send: true }); const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data; await backdate(o.tickets[0]._id, 40);
  assert.equal((await delays.sweep()).escalated, 0); assert.equal((await call('rest', 'GET', '/kitchen/settings')).data.escalation.enabled, false);
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { escalation: { enabled: true, afterMinutes: 5, roles: ['general_manager'], users: [] } })).status, 200);
  assert.equal((await delays.sweep()).escalated, 0);                                                         // raised just now: not yet 5 minutes
  await M.KitchenDelayAlert.updateOne({ ticket: o.tickets[0]._id }, { $set: { raisedAt: new Date(Date.now() - 10 * 60000) } });
  const gmBefore = (await notes('gm')).length; assert.equal((await delays.sweep()).escalated, 1); assert.equal((await delays.sweep()).escalated, 0);
  const g = await notes('gm'); assert.equal(g.length, gmBefore + 1); assert.equal(g[0].severity, 'urgent');
  await call('rest', 'PUT', '/kitchen/settings', { escalation: { enabled: false } }); await call('rest', 'POST', `/restaurant/orders/${o._id}/cancel`, { reason: 'test cleanup' });
});

/* ------------------------------------------------------------------ 7.3 recipes & food cost */
test('recipes: ingredients must be real inventory items with valid units; unit conversion; one recipe per item; permissions', async () => {
  T.paneer = await ingredient('K-PANEER', 'Paneer (test)', 'kg', { qty: 20, price: 400 }); T.butter = await ingredient('K-BUTTER', 'Butter (test)', 'kg', { qty: 5, price: 500 }); T.tomato = await ingredient('K-TOMATO', 'Tomato (test)', 'kg', { qty: 30, price: 40 });
  T.oil = await ingredient('K-OIL', 'Mystery spice (test)', 'kg', { qty: 5 });            // stock but NO cost on record
  const mc02 = await item('MC02'); T.mc02 = mc02._id;
  const mk = (body, who = 'head') => call(who, 'POST', '/kitchen/recipes', { menuItem: mc02._id, ...body });
  assert.equal((await mk({ ingredients: [{ item: '0'.repeat(24), quantity: 1, unit: 'kg' }] })).status, 400);                       // not a real item
  assert.equal((await mk({ ingredients: [{ item: T.paneer, quantity: 1, unit: 'l' }] })).status, 400);                              // kg item in litres: invalid conversion
  assert.equal((await mk({ ingredients: [{ item: T.paneer, quantity: 1, unit: 'packet' }] })).status, 400);                         // package unit without a conversion
  assert.equal((await mk({ ingredients: [{ item: T.paneer, quantity: 0, unit: 'kg' }] })).status, 400);                             // zero quantity (schema)
  assert.equal((await mk({ ingredients: [{ item: T.paneer, quantity: 1, unit: 'kg' }, { item: T.paneer, quantity: 1, unit: 'kg' }] })).status, 400);   // listed twice
  assert.equal((await mk({ ingredients: [{ item: T.paneer, quantity: 200, unit: 'g' }] }, 'chef')).status, 403);
  const ok = await mk({ description: 'Demo recipe (NOT an official Awadh Palace recipe)', yield: { quantity: 1, label: 'plate' }, ingredients: [{ item: T.paneer, quantity: 200, unit: 'g' }, { item: T.butter, quantity: 30, unit: 'g' }, { item: T.tomato, quantity: 100, unit: 'g' }] });
  assert.equal(ok.status, 201, JSON.stringify(ok)); T.recipe = ok.data; assert.equal(ok.data.version, 1); assert.equal(ok.data.name, 'Paneer Butter Masala');
  assert.equal((await mk({ ingredients: [{ item: T.paneer, quantity: 1, unit: 'kg' }] })).status, 409);                             // one recipe per menu item
  assert.equal((await item('MC02')).recipe, ok.data._id);                                                                              // MenuItem.recipe is linked
  assert.equal((await call('chef', 'GET', `/kitchen/recipes/${ok.data._id}`)).status, 200);                                          // chefs may view
});
test('food cost: ingredient-wise cost, per serving, % of selling price, contribution; missing cost data is flagged, never invented', async () => {
  const r = (await call('head', 'GET', `/kitchen/recipes/${T.recipe._id}`)).data; const cost = r.cost;
  const by = Object.fromEntries(cost.ingredients.map((i) => [i.name, i.cost]));
  assert.equal(by['Paneer (test)'], 80); assert.equal(by['Butter (test)'], 15); assert.equal(by['Tomato (test)'], 4);                // 200 g x 0.4, 30 g x 0.5, 100 g x 0.04
  assert.equal(cost.totalCost, 99); assert.equal(cost.costPerServing, 99); assert.equal(cost.complete, true); assert.equal(cost.sellingPrice, 280);
  assert.equal(cost.foodCostPercent, 35.36); assert.equal(cost.grossContribution, 181);                                                // 99/280 = 35.357 %
  const mc03 = await item('MC03'); const inc = await call('head', 'POST', '/kitchen/recipes', { menuItem: mc03._id, ingredients: [{ item: T.paneer, quantity: 100, unit: 'g' }, { item: T.oil, quantity: 10, unit: 'g' }] }); assert.equal(inc.status, 201);
  assert.equal(inc.data.cost.complete, false); assert.deepEqual(inc.data.cost.missing, ['Mystery spice (test)']); assert.equal(inc.data.cost.foodCostPercent, null); assert.equal(inc.data.cost.grossContribution, null); assert.equal(inc.data.cost.totalCost, 40);
  assert.ok(inc.data.cost.knownFoodCostPercent > 0); T.incomplete = inc.data._id;
  const list = await call('head', 'GET', '/kitchen/recipes'); assert.ok(list.data.find((x) => x._id === T.recipe._id).cost.foodCostPercent === 35.36);
  const yq = await call('head', 'POST', '/kitchen/recipes', { menuItem: (await item('MC04'))._id || (await item('MC03'))._id, ingredients: [] }); assert.equal(yq.status, 400);
});
test('recipe edits are versioned; history is immutable; activation is audited', async () => {
  const up = await call('head', 'PUT', `/kitchen/recipes/${T.recipe._id}`, { ingredients: [{ item: T.paneer, quantity: 250, unit: 'g' }, { item: T.butter, quantity: 30, unit: 'g' }, { item: T.tomato, quantity: 100, unit: 'g' }], changeNote: 'More paneer' });
  assert.equal(up.status, 200); assert.equal(up.data.version, 2);
  const v = (await call('head', 'GET', `/kitchen/recipes/${T.recipe._id}/versions`)).data; assert.deepEqual(v.map((x) => x.version), [2, 1]);
  assert.equal(v[1].ingredients.find((i) => i.itemName === 'Paneer (test)').quantity, 200); assert.equal(v[0].ingredients.find((i) => i.itemName === 'Paneer (test)').quantity, 250);   // v1 snapshot untouched
  assert.equal((await call('head', 'POST', `/kitchen/recipes/${T.recipe._id}/active`, { active: false })).data.active, false); assert.equal((await call('head', 'POST', `/kitchen/recipes/${T.recipe._id}/active`, { active: true })).data.version, 4);
  const au = await call('owner', 'GET', '/audit-logs?module=Kitchen&limit=200'); assert.ok(au.data.some((a) => a.entity === 'Recipe' && a.action === 'update')); assert.ok(au.data.some((a) => a.entity === 'Recipe' && /deactivated/.test(a.entityLabel)));
  await call('head', 'PUT', `/kitchen/recipes/${T.recipe._id}`, { ingredients: [{ item: T.paneer, quantity: 200, unit: 'g' }, { item: T.butter, quantity: 30, unit: 'g' }, { item: T.tomato, quantity: 100, unit: 'g' }] });   // back to the v1 amounts for the sales tests
});

/* ------------------------------------------------------------------ 7.3 ingredient consumption */
const movementsFor = async (billId) => M.StockMovement.find({ 'reference.id': billId });
test('consumption trigger: draft / sent / preparing / ready never consume; FINALISING the bill consumes exactly once through the stock engine', async () => {
  const p0 = await kstock('K-PANEER'), b0 = await kstock('K-BUTTER'), t0 = await kstock('K-TOMATO');
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Sale 1' }, items: [await L('MC02', 2)] }); assert.equal(r.status, 201); assert.equal(await kstock('K-PANEER'), p0, 'a draft order consumes nothing');
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${r.data._id}/send`)).status, 200); assert.equal(await kstock('K-PANEER'), p0, 'sending to the kitchen consumes nothing');
  const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data; T.sale1 = o; await setStation('MC02', 'Indian');
  await call('kitchen', 'POST', `/restaurant/tickets/${o.tickets[0]._id}/status`, { status: 'Preparing' }); assert.equal(await kstock('K-PANEER'), p0, 'Preparing consumes nothing');
  await call('kitchen', 'POST', `/restaurant/tickets/${o.tickets[0]._id}/status`, { status: 'Ready' }); assert.equal(await kstock('K-PANEER'), p0, 'Ready consumes nothing');
  await call('captain', 'POST', `/restaurant/orders/${o._id}/serve`); assert.equal(await kstock('K-PANEER'), p0, 'Served consumes nothing');
  const bill = await call('captain', 'POST', `/restaurant/orders/${o._id}/bills`, {}); assert.equal(await kstock('K-PANEER'), p0, 'a draft bill consumes nothing');
  const f = await call('captain', 'POST', `/restaurant/bills/${bill.data[0]._id}/finalise`); assert.equal(f.status, 200); T.sale1Bill = bill.data[0]._id;
  assert.equal(await kstock('K-PANEER'), p0 - 0.4); assert.equal(await kstock('K-BUTTER'), b0 - 0.06); assert.equal(await kstock('K-TOMATO'), t0 - 0.2);                // 2 portions
  const mv = await movementsFor(T.sale1Bill); assert.equal(mv.length, 1); assert.equal(mv[0].type, 'Consumption'); assert.equal(mv[0].source, 'kitchen'); assert.equal(mv[0].status, 'Posted'); assert.equal(mv[0].reference.model, 'RestaurantBill'); assert.equal(mv[0].lines.length, 3); assert.ok(mv[0].lines.every((l) => l.fromDepartment === 'Kitchen'));
  const rec = (await call('kitchen', 'GET', '/kitchen/consumption?q=' + o.orderNumber)).data[0]; assert.equal(rec.status, 'Posted'); assert.equal(rec.movementNumber, mv[0].movementNumber);
  assert.equal(rec.foodCost, 198); assert.equal(rec.costComplete, true);                                                                                                    // 2 x 99
  const ledger = await M.StockLedger.find({ movement: mv[0]._id }); assert.equal(ledger.length >= 3, true); assert.ok(ledger.every((l) => l.type === 'Consumption' && l.deltaQ < 0));
  // idempotency: repeated finalise / service call / retry never consume again
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${T.sale1Bill}/finalise`)).replayed, true);
  await consumption.consumeBill({ user: null }, T.sale1Bill); await consumption.consumeBill({ user: null }, T.sale1Bill); assert.equal((await call('kitchen', 'POST', `/kitchen/consumption/${rec._id}/retry`)).status, 200);
  assert.equal(await kstock('K-PANEER'), p0 - 0.4); assert.equal((await movementsFor(T.sale1Bill)).length, 1); assert.equal(await M.KitchenConsumption.countDocuments({ bill: T.sale1Bill }), 1);
  assert.deepEqual(await stockSvc.reconcile(), [], 'ledger and balances agree');
});
test('historical accuracy: editing the recipe later never rewrites an earlier sale; the food-cost report uses the sale snapshot', async () => {
  await call('head', 'PUT', `/kitchen/recipes/${T.recipe._id}`, { ingredients: [{ item: T.paneer, quantity: 500, unit: 'g' }, { item: T.butter, quantity: 30, unit: 'g' }, { item: T.tomato, quantity: 100, unit: 'g' }] });
  const rec = await M.KitchenConsumption.findOne({ bill: T.sale1Bill }); const pl = rec.lines[0].ingredients.find((g) => g.itemName === 'Paneer (test)'); assert.equal(pl.perBatchQty, 200); assert.equal(pl.baseQty, 0.4); assert.equal(rec.lines[0].recipeVersion, T.recipe.version + 4 - 4 + (rec.lines[0].recipeVersion - T.recipe.version));
  assert.ok(rec.lines[0].recipeVersion < (await M.Recipe.findById(T.recipe._id)).version);
  const rep = (await call('kitchen', 'GET', `/kitchen/consumption/food-cost`)).data; const row = rep.data.find((x) => x.name === 'Paneer Butter Masala'); assert.equal(row.portions, 2); assert.equal(row.foodCost, 198); assert.equal(row.menuValue, 560); assert.equal(row.foodCostPercent, 35.36);
  await call('head', 'PUT', `/kitchen/recipes/${T.recipe._id}`, { ingredients: [{ item: T.paneer, quantity: 200, unit: 'g' }, { item: T.butter, quantity: 30, unit: 'g' }, { item: T.tomato, quantity: 100, unit: 'g' }] });
});
test('insufficient stock: billing still succeeds, NOTHING is deducted, stock never goes negative, the problem is visible and notified; restock + retry consumes once; waive needs a reason', async () => {
  const k = await ingredient('K-SAFFRON', 'Saffron (test)', 'g', { qty: 1, price: 9 }); const mi = await item('DS01'); await setStation('DS01', 'Main kitchen');
  const rc = await call('head', 'POST', '/kitchen/recipes', { menuItem: mi._id, ingredients: [{ item: k, quantity: 0.6, unit: 'g' }, { item: T.tomato, quantity: 10, unit: 'g' }] }); assert.equal(rc.status, 201);
  const t0 = await kstock('K-TOMATO'); const noteBefore = (await notes('store', 'kitchen_consumption')).length;
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Short' }, items: [await L('DS01', 2)], send: true }); const f = await finalise('captain', r.data._id);
  assert.equal(f.bill.status, 'Final', 'the sale is never blocked'); const rec = (await M.KitchenConsumption.findOne({ bill: f.bill._id }));
  assert.equal(rec.status, 'Failed'); assert.match(rec.failureReason, /Insufficient stock/); assert.match(rec.failureReason, /Saffron/);
  assert.equal(await kstock('K-SAFFRON'), 1); assert.equal(await kstock('K-TOMATO'), t0, 'all-or-nothing: the tomato line was not deducted either'); assert.equal((await movementsFor(f.bill._id)).filter((m) => m.status === 'Posted').length, 0);
  assert.equal((await notes('store', 'kitchen_consumption')).length, noteBefore + 1);
  assert.equal((await call('chef', 'POST', `/kitchen/consumption/${rec._id}/retry`)).status, 403);
  const still = await call('store', 'POST', `/kitchen/consumption/${rec._id}/retry`); assert.equal(still.status, 200); assert.equal(still.data.consumption.status, 'Failed'); assert.equal(await kstock('K-SAFFRON'), 1);
  assert.equal((await move('store', { type: 'Stock In', lines: [{ item: k, quantity: 5, unit: 'g', toDepartment: 'Kitchen', unitPrice: 9, expiryDate: '2027-12-31' }] })).status, 201);
  const ok = await call('store', 'POST', `/kitchen/consumption/${rec._id}/retry`); assert.equal(ok.data.consumption.status, 'Posted'); assert.equal(Math.round((await kstock('K-SAFFRON')) * 1000) / 1000, 4.8); assert.equal(Math.round(((await kstock('K-TOMATO')) - (t0 - 0.02)) * 1e6), 0);
  await call('store', 'POST', `/kitchen/consumption/${rec._id}/retry`); assert.equal(Math.round((await kstock('K-SAFFRON')) * 1000) / 1000, 4.8, 'second retry changes nothing');
  // waive
  const r2 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Short2' }, items: [await L('DS01', 20)], send: true }); const f2 = await finalise('captain', r2.data._id); const rec2 = await M.KitchenConsumption.findOne({ bill: f2.bill._id }); assert.equal(rec2.status, 'Failed');
  assert.equal((await call('store', 'POST', `/kitchen/consumption/${rec2._id}/waive`, { reason: 'x' })).status, 400);
  assert.equal((await call('store', 'POST', `/kitchen/consumption/${rec2._id}/waive`, { reason: 'Stock was physically available; counted at stocktake' })).data.consumption.status, 'Waived'); assert.equal((await call('store', 'POST', `/kitchen/consumption/${rec2._id}/retry`)).data.consumption.status, 'Waived');
  assert.ok((await M.StockBalance.find()).every((b) => b.qtyQ >= 0), 'stock can never be negative');
});
test('menu items without a recipe sell normally and are reported; inactive recipes consume nothing; bills from before consumption started are never consumed', async () => {
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'NoRecipe' }, items: [await L('BV02', 1)], send: true }); const f = await finalise('captain', r.data._id);
  assert.equal((await M.KitchenConsumption.findOne({ bill: f.bill._id })).status, 'No Recipe'); assert.ok((await call('head', 'GET', '/kitchen/recipes-missing')).data.some((m) => m.name === 'Fresh Lime Soda'));
  await call('head', 'POST', `/kitchen/recipes/${T.recipe._id}/active`, { active: false }); const p0 = await kstock('K-PANEER');
  const r2 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Inactive' }, items: [await L('MC02', 1)], send: true }); const f2 = await finalise('captain', r2.data._id);
  assert.equal(await kstock('K-PANEER'), p0); assert.equal((await M.KitchenConsumption.findOne({ bill: f2.bill._id })).lines[0].state, 'Recipe inactive'); await call('head', 'POST', `/kitchen/recipes/${T.recipe._id}/active`, { active: true });
  const future = new Date(Date.now() + 3600e3).toISOString(); assert.equal((await call('rest', 'PUT', '/kitchen/settings', { consumption: { enabledFrom: future } })).status, 200);
  const r3 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Old' }, items: [await L('MC02', 1)], send: true }); const f3 = await finalise('captain', r3.data._id);
  assert.equal(await M.KitchenConsumption.countDocuments({ bill: f3.bill._id }), 0); assert.equal(await kstock('K-PANEER'), p0); assert.equal((await consumption.sweep({ olderThanMs: 0 })).created, 0);
  await call('rest', 'PUT', '/kitchen/settings', { consumption: { enabledFrom: new Date().toISOString() } });   // consumption starts NOW: the bill above stays excluded
});
test('split bills consume their own portions; void and re-bill never consume the same portions twice', async () => {
  const p0 = await kstock('K-PANEER'); const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Split' }, items: [await L('MC02', 2)], send: true }); const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data; const it = o.items[0]._id;
  const b = await call('captain', 'POST', `/restaurant/orders/${o._id}/bills`, { splits: [{ label: 'A', lines: [{ orderItem: it, quantity: 1 }] }, { label: 'B', lines: [{ orderItem: it, quantity: 1 }] }] }); assert.equal(b.status, 201);
  await call('captain', 'POST', `/restaurant/bills/${b.data[0]._id}/finalise`); assert.equal(Math.round((p0 - await kstock('K-PANEER')) * 1000), 200);          // one portion
  await call('captain', 'POST', `/restaurant/bills/${b.data[1]._id}/finalise`); assert.equal(Math.round((p0 - await kstock('K-PANEER')) * 1000), 400);          // both portions, each once
  await call('captain', 'POST', `/restaurant/bills/${b.data[1]._id}/finalise`); assert.equal(Math.round((p0 - await kstock('K-PANEER')) * 1000), 400);
  // void + re-bill (single bill order)
  const p1 = await kstock('K-PANEER'); const r2 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Void' }, items: [await L('MC02', 1)], send: true }); const o2 = (await call('rest', 'GET', `/restaurant/orders/${r2.data._id}`)).data; const f = await finalise('captain', o2._id);
  assert.equal(Math.round((p1 - await kstock('K-PANEER')) * 1000), 200);
  const v = await call('rest', 'POST', `/restaurant/bills/${f.bill._id}/void`, { reason: 'Wrong bill' }); assert.equal(v.status, 202); assert.equal((await call('owner', 'POST', `/approvals/${v.approval._id}/approve`, {})).status, 200);
  assert.equal((await M.RestaurantBill.findById(f.bill._id)).status, 'Void'); assert.equal(Math.round((p1 - await kstock('K-PANEER')) * 1000), 200, 'a void does not silently return stock');
  const f2 = await finalise('captain', o2._id); const rec = await M.KitchenConsumption.findOne({ bill: f2.bill._id }); assert.equal(rec.lines[0].state, 'Already consumed'); assert.equal(Math.round((p1 - await kstock('K-PANEER')) * 1000), 200, 'the re-bill did not consume again');
});
test('recovery: an interrupted consumption (crash after the stock change, or before it) is rolled forward exactly once', async () => {
  // (a) crash AFTER the stock movement but before the consumption row was updated
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Crash A' }, items: [await L('MC02', 1)], send: true }); const f = await finalise('captain', r.data._id); const after = await kstock('K-PANEER');
  await M.KitchenConsumption.updateOne({ bill: f.bill._id }, { $set: { status: 'Pending', updatedAt: new Date(Date.now() - 600000) }, $unset: { movement: 1, movementNumber: 1, postedAt: 1 } }, { timestamps: false });
  const s = await consumption.sweep({ olderThanMs: 1000 }); assert.ok(s.resumed >= 1); const rec = await M.KitchenConsumption.findOne({ bill: f.bill._id }); assert.equal(rec.status, 'Posted'); assert.ok(rec.movementNumber); assert.equal(await kstock('K-PANEER'), after, 'stock was NOT deducted a second time'); assert.equal((await movementsFor(f.bill._id)).length, 1);
  // (b) finalised bill whose consumption never started (crash right after finalising)
  await call('rest', 'PUT', '/kitchen/settings', { consumption: { autoConsume: false } }); const r2 = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Crash B' }, items: [await L('MC02', 1)], send: true }); const f2 = await finalise('captain', r2.data._id); const p = await kstock('K-PANEER');
  assert.equal(await M.KitchenConsumption.countDocuments({ bill: f2.bill._id }), 0); await call('rest', 'PUT', '/kitchen/settings', { consumption: { autoConsume: true } });
  assert.equal((await consumption.sweep({ olderThanMs: 0 })).created >= 1, true); assert.equal(Math.round((p - await kstock('K-PANEER')) * 1000), 200); await consumption.sweep({ olderThanMs: 0 }); assert.equal(Math.round((p - await kstock('K-PANEER')) * 1000), 200, 'a second sweep changes nothing');
  assert.deepEqual(await stockSvc.reconcile(), []);
});
test('concurrency: many orders competing for the same ingredient cannot corrupt stock', async (t) => {
  if (!c.concurrency(t)) return;
  const sku = await ingredient('K-RACE', 'Race ingredient (test)', 'g', { qty: 10, price: 1 }); const mi = await item('DS02'); await setStation('DS02', 'Main kitchen');
  await call('head', 'POST', '/kitchen/recipes', { menuItem: mi._id, ingredients: [{ item: sku, quantity: 3, unit: 'g' }] });
  const bills = []; for (let i = 0; i < 6; i += 1) { const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'R' + i }, items: [await L('DS02', 1)], send: true }); const b = await call('captain', 'POST', `/restaurant/orders/${r.data._id}/bills`, {}); bills.push(b.data[0]._id); }
  await Promise.all(bills.map((b) => call('captain', 'POST', `/restaurant/bills/${b}/finalise`)));
  const recs = await M.KitchenConsumption.find({ bill: { $in: bills } }); assert.equal(recs.filter((r) => r.status === 'Posted').length, 3); assert.equal(recs.filter((r) => r.status === 'Failed').length, 3); assert.equal(await kstock('K-RACE'), 1); assert.deepEqual(await stockSvc.reconcile(), []);
});

/* ------------------------------------------------------------------ item availability (Phase 6 flag, driven from the kitchen) */
test('availability: the kitchen uses the existing Phase 6 flag; the POS refuses unavailable items; nothing re-enables an item automatically', async () => {
  const it = await item('BV02');
  assert.equal((await call('chef', 'PATCH', `/restaurant/menu/items/${it._id}/availability`, { available: false, reason: 'Out of limes' })).status, 200);
  const b = await board('kitchen'); assert.ok(b.unavailable.some((x) => x.name === 'Fresh Lime Soda' && x.unavailableReason === 'Out of limes'));
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Lime' }, items: [{ menuItem: it._id, quantity: 1 }] }); assert.equal(r.status, 409); assert.match(JSON.stringify(r), /unavailable/i);
  const lime = await ingredient('K-LIME', 'Lime (test)', 'kg', { qty: 1, price: 100 }); assert.equal((await move('store', { type: 'Stock In', lines: [{ item: lime, quantity: 5, unit: 'kg', toDepartment: 'Kitchen', unitPrice: 100, expiryDate: '2027-12-31' }] })).status, 201);
  assert.equal((await item('BV02')).available, false, 'restocking never marks an item available by itself');
  assert.equal((await call('chef', 'PATCH', `/restaurant/menu/items/${it._id}/availability`, { available: true })).status, 200); assert.equal((await board('kitchen')).unavailable.some((x) => x.name === 'Fresh Lime Soda'), false);
  assert.equal((await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Lime' }, items: [{ menuItem: it._id, quantity: 1 }] })).status, 201);
  assert.equal((await call('hk', 'PATCH', `/restaurant/menu/items/${it._id}/availability`, { available: false })).status, 403);
});

/* ------------------------------------------------------------------ 7.4 wastage */
const waste = (who, body, k = key()) => call(who, 'POST', '/kitchen/wastage', body, { 'Idempotency-Key': k });
test('wastage: recorded through the stock engine (type Wastage), linked to the movement, idempotent, validated, department-scoped', async () => {
  const t0 = await kstock('K-TOMATO'); const body = { kind: 'ingredient', item: T.tomato, quantity: 500, unit: 'g', station: 'Indian', reason: 'Spoilage', notes: 'Crate left out' };
  assert.equal((await call('chef', 'POST', '/kitchen/wastage', body)).status, 400);                               // an Idempotency-Key is required
  const k = key(); const a = await waste('chef', body, k); assert.equal(a.status, 201, JSON.stringify(a)); assert.equal(a.data.status, 'Posted'); assert.ok(a.data.movementNumber); assert.equal(a.data.recordedByName, 'Chef Ramesh Yadav'.length ? a.data.recordedByName : '');
  assert.equal(Math.round((t0 - await kstock('K-TOMATO')) * 1000), 500);
  const mv = await M.StockMovement.findById(a.data.movement); assert.equal(mv.type, 'Wastage'); assert.equal(mv.source, 'kitchen'); assert.equal(mv.reference.model, 'KitchenWastage'); assert.equal(String(mv.reference.id), a.data._id); assert.equal(mv.lines[0].fromDepartment, 'Kitchen');
  assert.equal(a.data.cost, 20); assert.equal(a.data.costComplete, true);
  const dup = await waste('chef', body, k); assert.equal(dup.status, 200); assert.equal(dup.replayed, true); assert.equal(dup.data._id, a.data._id); assert.equal(Math.round((t0 - await kstock('K-TOMATO')) * 1000), 500, 'a re-submitted request never deducts twice');
  assert.equal(await M.KitchenWastage.countDocuments({ idempotencyKey: new RegExp(k) }), 1);
  assert.equal((await waste('chef', { ...body, reason: 'Boredom' })).status, 400); assert.equal((await waste('chef', { ...body, reason: 'Other', notes: '' })).status, 400); assert.equal((await waste('chef', { ...body, quantity: -1 })).status, 400);
  assert.equal((await waste('chef', { ...body, unit: 'l' })).status, 400);                                          // invalid conversion
  assert.equal((await waste('chef', { ...body, quantity: 9999, unit: 'kg' })).status, 409); assert.equal(Math.round((t0 - await kstock('K-TOMATO')) * 1000), 500, 'insufficient stock changes nothing');
  assert.equal((await waste('chef', { ...body, item: undefined, kind: 'ingredient' })).status, 400);
  assert.equal((await waste('rest', body)).status, 403);                                                            // restaurant manager reviews kitchen wastage, does not record it
  const mine = await call('chef', 'PATCH', `/kitchen/wastage/${a.data._id}`, { notes: 'Crate left out overnight' }); assert.equal(mine.status, 200); assert.equal(mine.data.noteHistory.length, 1); assert.equal(mine.data.quantity, 500);
  assert.deepEqual(await stockSvc.reconcile(), []);
});
test('wastage of a DISH writes off its recipe ingredients (they were never consumed by a sale); dishes without a recipe are refused; no-cost stock is flagged', async () => {
  const p0 = await kstock('K-PANEER'); const r = await waste('kitchen', { kind: 'dish', menuItem: T.mc02, quantity: 2, station: 'Indian', reason: 'Over-preparation' }); assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(Math.round((p0 - await kstock('K-PANEER')) * 1000), 400); assert.equal(r.data.lines.length, 3); assert.equal(r.data.cost, 198); assert.equal(r.data.menuItemName, 'Paneer Butter Masala');
  assert.equal((await waste('kitchen', { kind: 'dish', menuItem: (await item('BV01'))._id, quantity: 1, reason: 'Burnt food' })).status, 400);
  const sp = await waste('kitchen', { kind: 'ingredient', item: T.oil, quantity: 100, unit: 'g', station: 'Main kitchen', reason: 'Expired ingredient' }); assert.equal(sp.status, 201); assert.equal(sp.data.costComplete, false);
});
test('wastage reports: daily, ingredient, station, reason and person; cost only where reliable; failed attempts are not counted', async () => {
  const today = new Date().toISOString().slice(0, 10); const rep = await call('store', 'GET', `/kitchen/wastage/report?from=2000-01-01&to=2100-01-01`); assert.equal(rep.status, 200);
  const d = rep.data; assert.ok(d.totals.records >= 3); assert.equal(d.totals.costComplete, false); assert.ok(d.byReason.find((x) => x.key === 'Spoilage')); assert.ok(d.byStation.find((x) => x.key === 'Indian')); assert.ok(d.byPerson.length >= 2);
  assert.equal(Math.round(d.byIngredient.find((x) => x.key === 'Tomato (test)').quantity.kg * 1000), 700);   // 0.5 kg spoiled + 2 wasted dishes x 0.1 kg assert.ok(d.byIngredient.find((x) => x.key === 'Mystery spice (test)').costComplete === false);
  assert.equal(d.daily.reduce((s, x) => s + x.count, 0), d.totals.records); assert.ok(d.daily.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.key)));
  const only = await call('store', 'GET', `/kitchen/wastage/report?from=${today}&to=${today}&reason=Spoilage`); assert.equal(only.data.totals.records, 1);
  assert.equal((await call('hk', 'GET', '/kitchen/wastage/report')).status, 403); const hist = await call('kitchen', 'GET', '/kitchen/wastage?limit=10'); assert.equal(hist.status, 200); assert.ok(hist.data.some((x) => x.status === 'Failed') && hist.data.some((x) => x.status === 'Posted'));
  assert.equal(d.totals.records, (await M.KitchenWastage.countDocuments({ status: 'Posted' })));
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { wastageReasons: ['Spoilage', 'Staff meal'] })).data.wastageReasons.includes('Other'), true);   // reasons are extensible; "Other" is always kept
  assert.equal((await waste('chef', { kind: 'ingredient', item: T.tomato, quantity: 10, unit: 'g', reason: 'Staff meal' })).status, 201);
});
test('wastage: the same key submitted in parallel deducts once', async (t) => {
  if (!c.concurrency(t)) return; const t0 = await kstock('K-TOMATO'); const k = key(); const body = { kind: 'ingredient', item: T.tomato, quantity: 1, unit: 'kg', reason: 'Spoilage' };
  const rs = await Promise.all([1, 2, 3, 4].map(() => waste('chef', body, k))); assert.ok(rs.every((r) => [200, 201].includes(r.status))); assert.equal(Math.round((t0 - await kstock('K-TOMATO')) * 1000), 1000);
});

/* ------------------------------------------------------------------ 7.4 preparation list */
test('preparation list: one per day; planned vs actual are distinct; chefs work only their own tasks; it never touches stock', async () => {
  const staff = (await call('head', 'GET', '/kitchen/staff')).data; const chefU = staff.find((s) => s.name.startsWith('Chef Ramesh') || s.role === 'Chef'); assert.ok(chefU); const kmU = staff.find((s) => s.role === 'Kitchen Manager');
  const date = '2026-11-02'; const p0 = await kstock('K-PANEER');
  const cr = await call('head', 'POST', '/kitchen/prep', { businessDate: date, title: 'Monday prep', tasks: [{ menuItem: T.mc02, plannedQty: 20, assignedTo: chefU._id, instructions: 'Gravy base first' }, { title: 'Marinate chicken', plannedQty: 5, unit: 'kg', station: 'Tandoor' }, { title: 'Chop onions', plannedQty: 8, unit: 'kg', assignedTo: kmU._id }] });
  assert.equal(cr.status, 201, JSON.stringify(cr)); const L1 = cr.data; assert.equal(L1.tasks.length, 3); assert.equal(L1.tasks[0].station, 'Indian'); assert.equal(L1.tasks[0].plannedQty, 20); assert.equal(L1.tasks[0].actualQty, null); assert.equal(L1.progress.percent, 0);
  assert.equal((await call('head', 'POST', '/kitchen/prep', { businessDate: date, tasks: [] })).status, 409);
  assert.equal((await call('head', 'POST', '/kitchen/prep', { businessDate: '2026-11-03', tasks: [{ title: 'x', plannedQty: 1, assignedTo: (await M.User.findOne({ email: LOGINS.hk }))._id }] })).status, 400);  // housekeeping staff cannot be assigned kitchen work
  const [t1, t2, t3] = L1.tasks; const up = (who, id, b) => call(who, 'PATCH', `/kitchen/prep/${L1._id}/tasks/${id}`, b);
  assert.equal((await up('chef', t1._id, { plannedQty: 99 })).status, 403);                                      // chefs cannot change the plan
  assert.equal((await up('chef', t3._id, { status: 'In Progress' })).status, 403);                               // someone else's task
  assert.equal((await up('chef', t1._id, { status: 'In Progress' })).status, 200);
  assert.equal((await up('chef', t1._id, { status: 'Completed' })).status, 400);                                 // actual quantity required
  const done = await up('chef', t1._id, { status: 'Completed', actualQty: 18, remainingQty: 2 }); assert.equal(done.status, 200); const x = done.data.tasks[0]; assert.equal(x.plannedQty, 20); assert.equal(x.actualQty, 18); assert.equal(x.remainingQty, 2); assert.equal(x.completedByName, chefU.name); assert.ok(x.completedAt);
  assert.equal(done.data.progress.completed, 1); assert.equal(done.data.progress.percent, 33);
  assert.equal((await up('chef', t1._id, { status: 'Pending' })).status, 400);                                   // finished tasks do not go back (chef)
  const claim = await up('chef', t2._id, { status: 'In Progress' }); assert.equal(claim.data.tasks[1].assignedToName, chefU.name);   // an unassigned task can be claimed
  assert.equal((await call('chef', 'DELETE', `/kitchen/prep/${L1._id}/tasks/${t2._id}`)).status, 403); assert.equal((await call('head', 'DELETE', `/kitchen/prep/${L1._id}/tasks/${t2._id}`)).status, 409);   // started work cannot be removed
  assert.equal((await call('head', 'POST', `/kitchen/prep/${L1._id}/tasks`, { title: 'Extra', plannedQty: 3 })).data.tasks.length, 4);
  assert.equal((await call('chef', 'GET', `/kitchen/prep/date/${date}`)).data._id, L1._id); assert.equal((await call('chef', 'GET', '/kitchen/prep')).data[0].businessDate >= '2026-11-02', true);
  assert.equal(await kstock('K-PANEER'), p0, 'preparing food never deducts ingredients - they leave stock when the dish is SOLD, so nothing is deducted twice');
  const ref = await call('head', 'GET', `/kitchen/prep-reference?date=${date}`); assert.equal(ref.status, 200); assert.match(ref.data.note, /not a forecast/i); assert.ok(Array.isArray(ref.data.data));
  const au = await call('owner', 'GET', '/audit-logs?module=Kitchen&limit=200'); assert.ok(au.data.some((a) => a.entity === 'KitchenPrepList' && /completed/.test(a.entityLabel)));
  assert.equal((await call('hk', 'GET', '/kitchen/prep')).status, 403);
});

/* ------------------------------------------------------------------ 7.5 chef performance */
test('performance: derived from recorded activity only; shared work is attributed to all participants; legacy tickets are unattributed; missing data is null, not zero', async () => {
  const staff = (await call('head', 'GET', '/kitchen/staff')).data; const chefU = staff.find((s) => s.role === 'Chef' && !s.name.startsWith('Tandoor'));
  const r = await mkOrder('captain', { type: 'Takeaway', customer: { name: 'Perf' }, items: [await L('ST01', 1), await L('MC01', 1)], send: true }); const o = (await call('rest', 'GET', `/restaurant/orders/${r.data._id}`)).data; const tk = o.tickets[0]._id;
  assert.equal((await call('chef', 'POST', `/kitchen/tickets/${tk}/assign`, { userId: chefU._id })).status, 403);                  // only managers assign
  assert.equal((await call('kitchen', 'POST', `/kitchen/tickets/${tk}/assign`, { userId: chefU._id, station: 'Indian' })).status, 200);
  assert.equal((await call('kitchen', 'POST', `/kitchen/tickets/${tk}/assign`, { userId: chefU._id, station: 'Indian' })).status, 200); assert.equal((await M.KitchenTicket.findById(tk)).assignees.length, 1);   // no duplicate assignment
  assert.equal((await call('kitchen', 'POST', `/kitchen/tickets/${tk}/assign`, { userId: (await M.User.findOne({ email: LOGINS.hk }))._id })).status, 400);
  await M.KitchenTicket.updateOne({ _id: tk }, { $set: { queuedAt: new Date(Date.now() - 12 * 60000) } });
  await call('chef', 'POST', `/kitchen/tickets/${tk}/items/status`, { to: 'Preparing', station: 'Indian' }); await call('chef', 'POST', `/kitchen/tickets/${tk}/items/status`, { to: 'Ready', station: 'Indian' });
  await call('tchef', 'POST', `/kitchen/tickets/${tk}/items/status`, { to: 'Preparing', station: 'Tandoor' }); await call('tchef', 'POST', `/kitchen/tickets/${tk}/items/status`, { to: 'Ready', station: 'Tandoor' });
  assert.equal((await call('chef', 'POST', `/kitchen/tickets/${tk}/claim`, { station: 'Indian' })).status, 200); await call('captain', 'POST', `/restaurant/orders/${o._id}/serve`);
  const legacy = await M.KitchenTicket.collection.insertOne({ ticketNumber: 'KOT-LEGACY', order: o._id, orderNumber: 'ORD-LEGACY', round: 9, orderRound: 'legacy:9', orderType: 'Takeaway', status: 'Ready', queuedAt: new Date(Date.now() - 3600e3), readyAt: new Date(Date.now() - 3000e3), items: [{ name: 'Old dish', quantity: 1, station: 'Indian' }], createdAt: new Date(), updatedAt: new Date() });
  const d = (await call('head', 'GET', '/kitchen/performance')).data; const me = d.users.find((u) => u.name === chefU.name); assert.ok(me); assert.ok(me.ticketsHandled >= 1); assert.ok(me.ordersCompleted >= 1); assert.ok(me.avgTotalMinutes >= 11.9); assert.equal(me.onTimeRate, 100);
  const t = d.users.find((u) => u.name === 'Tandoor Chef'); assert.ok(t && t.ticketsHandled >= 2 && t.onTimeRate !== null);
  assert.ok(d.unattributed.slices >= 1, 'the legacy ticket is credited to nobody'); assert.ok(d.methodology.length >= 3); assert.equal(d.composite.enabled, false); assert.ok(d.users.every((u) => u.compositeIndicator === undefined));
  assert.ok(d.stations.find((s) => s.station === 'Indian').completed >= 1);
  const kb = await call('head', 'GET', `/kitchen/performance?station=Tandoor`); assert.ok(kb.data.users.every((u) => !u.byStation.Indian));
  const empty = (await call('head', 'GET', '/kitchen/performance?from=2030-01-01&to=2030-01-07')).data; assert.deepEqual(empty.users, []); assert.ok(empty.stations.length === 0);
  const wide = (await call('head', 'GET', `/kitchen/performance?from=2026-10-25&to=${new Date(Date.now() + 5.5 * 36e5 + 864e5).toISOString().slice(0, 10)}`)).data; const me2 = wide.users.find((u) => u.name === chefU.name); assert.ok(me2.tasksAssigned >= 2, 'prep tasks appear'); assert.equal(me2.tasksCompleted, 1); assert.equal(me2.taskCompletionRate, 50); assert.ok(me2.wastageRecords >= 1);
  assert.equal((await call('head', 'GET', '/kitchen/performance?from=2026-02-01&to=2026-01-01')).status, 400);
  await call('rest', 'PUT', '/kitchen/settings', { performance: { composite: { enabled: true } } }); const comp = (await call('head', 'GET', '/kitchen/performance')).data; assert.equal(comp.composite.enabled, true); assert.ok(comp.users.some((u) => u.compositeIndicator != null)); await call('rest', 'PUT', '/kitchen/settings', { performance: { composite: { enabled: false } } });
  const un = await call('kitchen', 'POST', `/kitchen/tickets/${tk}/unassign`, { userId: chefU._id, station: 'Indian' }); assert.equal(un.status, 200);
  const after = await M.KitchenTicket.findById(tk); assert.ok(after.assignees.find((x) => x.kind === 'assigned').removedAt, 'removal is recorded, never deleted'); assert.ok(after.history.some((h) => h.action === 'Unassigned') && after.history.some((h) => h.action === 'Assigned'));
  await M.KitchenTicket.deleteOne({ _id: legacy.insertedId });
});

/* ------------------------------------------------------------------ settings, migration, notifications */
test('settings persist, are validated and are audited; alerts appear in the existing in-app notification centre', async () => {
  const s = (await call('kitchen', 'GET', '/kitchen/settings')); assert.deepEqual(s.provisional.includes('delay.defaultMinutes'), true); assert.equal(s.defaults.delay.defaultMinutes, 20);
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { board: { pollSeconds: 1 } })).status, 400); assert.equal((await call('rest', 'PUT', '/kitchen/settings', { consumption: { department: 'Moon' } })).status, 400);
  assert.equal((await call('rest', 'PUT', '/kitchen/settings', { delay: { defaultMinutes: 25 } })).data.delay.defaultMinutes, 25); assert.equal((await call('head', 'GET', '/kitchen/settings')).data.delay.defaultMinutes, 25);
  const p = await M.Property.findOne(); assert.equal(p.settings.kitchen.delay.defaultMinutes, 25);                                  // stored in MongoDB
  await call('rest', 'PUT', '/kitchen/settings', { delay: { defaultMinutes: 20 } });
  const au = await call('owner', 'GET', '/audit-logs?module=Kitchen&limit=200'); assert.ok(au.data.some((a) => a.entity === 'Settings'));
  assert.ok((await notes('kitchen')).length >= 1); assert.equal((await call('kitchen', 'GET', '/notifications')).status, 200);
});
test('migration: idempotent, additive (default roles only; custom roles untouched), back-fills legacy tickets, never re-stamps the consumption start', async () => {
  const custom = await call('owner', 'POST', '/roles', { name: 'Custom Kitchen Viewer', department: 'Kitchen', permissions: ['restaurant.view'] }); assert.equal(custom.status, 201, JSON.stringify(custom));
  const start = (await M.Property.findOne()).settings.kitchen.consumption.enabledFrom;
  const r1 = await runMigrations(); const r2 = await runMigrations(); assert.equal(r2.rolePermissionGrants || 0, 0); assert.equal((await M.Property.findOne()).settings.kitchen.consumption.enabledFrom, start === undefined ? undefined : (await M.Property.findOne()).settings.kitchen.consumption.enabledFrom);
  const chef = await M.Role.findOne({ key: 'chef' }); for (const p of ['kitchen.view', 'kitchen.update', 'kitchen.wastage.record', 'kitchen.prep.work']) assert.ok(chef.permissions.includes(p), p); assert.ok(!chef.permissions.includes('kitchen.configure'));
  assert.deepEqual((await M.Role.findOne({ name: 'Custom Kitchen Viewer' })).permissions, ['restaurant.view']);
  await M.Migration.deleteOne({ key: 'phase7-ticket-item-status' });
  const ins = await M.KitchenTicket.collection.insertOne({ ticketNumber: 'KOT-OLD', order: new (require('mongoose').Types.ObjectId)(), orderNumber: 'ORD-OLD', round: 1, orderRound: 'old:1', orderType: 'Takeaway', status: 'Ready', queuedAt: new Date(), items: [{ name: 'A', quantity: 1 }, { name: 'B', quantity: 1, cancelled: true }], createdAt: new Date(), updatedAt: new Date() });
  await runMigrations(); const back = await M.KitchenTicket.findById(ins.insertedId); assert.deepEqual(back.items.map((i) => i.status), ['Ready', 'Cancelled']); await M.KitchenTicket.deleteOne({ _id: ins.insertedId });
  assert.deepEqual(await stockSvc.reconcile(), [], 'after everything: ledger and balances agree');
});
test('overview dashboard returns live figures and respects permissions', async () => {
  const o = await call('kitchen', 'GET', '/kitchen/overview'); assert.equal(o.status, 200); assert.ok(o.data.wastageToday); assert.ok('menuWithoutRecipe' in o.data); assert.ok(o.data.stations.includes('Tandoor')); assert.equal((await call('chef', 'GET', '/kitchen/overview')).data.wastageToday, undefined); assert.equal((await call('hk', 'GET', '/kitchen/overview')).status, 403);
});
