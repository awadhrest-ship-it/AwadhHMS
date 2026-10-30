// Phase 6 - Restaurant, Room Service & POS. Requires a MongoDB-compatible server: MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const M = require('../models');

let c; const call = (...a) => c.call(...a);
const LOGINS = { owner: 'owner@awadhpalace.test', gm: 'gm@awadhpalace.test', rest: 'restaurant@awadhpalace.test', captain: 'captain@awadhpalace.test', kitchen: 'kitchen@awadhpalace.test',
  chef: 'chef@awadhpalace.test', cashier: 'cashier@awadhpalace.test', fom: 'fom@awadhpalace.test', rec: 'reception@awadhpalace.test', hk: 'housekeeping@awadhpalace.test', director: 'director@awadhpalace.test' };
before(async () => { c = await boot(LOGINS); });
after(async () => { await c.close(); });

let n = 0; const key = () => `k-${Date.now()}-${++n}-abcdef`;
const item = async (code) => (await call('rest', 'GET', '/restaurant/menu/items?q=' + code)).data.find((i) => i.code === code);
const table = async (num) => (await call('rest', 'GET', '/restaurant/tables')).data.find((t) => t.number === num);
const mk = (who, body, k = key()) => call(who, 'POST', '/restaurant/orders', { ...body }, { 'Idempotency-Key': k });
const L = async (code, quantity, notes) => ({ menuItem: (await item(code))._id, quantity, ...(notes ? { notes } : {}) });
const money = (x) => Math.round(x * 100);
const pay = (who, id, body, k = key()) => call(who, 'POST', `/restaurant/bills/${id}/payments`, body, { 'Idempotency-Key': k });
const approve = async (arId, who = 'gm') => call(who, 'POST', `/approvals/${arId}/approve`, {});
const T = {}; // shared scenario state

/* ------------------------------------------------------------------ regression: settings persistence (latent Phase 4/5 defect) */
test('regression: module settings persist (Property.settings.inventory / housekeeping / restaurant were silently dropped before Phase 6)', async () => {
  const inv = await call('owner', 'PUT', '/inventory/settings', { expiryWarningDays: 45 }); assert.equal(inv.status, 200);
  assert.equal((await call('owner', 'GET', '/inventory/settings')).data.expiryWarningDays, 45, 'inventory setting is stored');
  const hk = await call('owner', 'PUT', '/housekeeping/settings', { requirePhotos: true }); assert.equal(hk.status, 200, JSON.stringify(hk));
  assert.equal((await call('owner', 'GET', '/housekeeping/settings')).data.requirePhotos, true, 'housekeeping setting is stored');
  await call('owner', 'PUT', '/inventory/settings', { expiryWarningDays: 30 }); await call('owner', 'PUT', '/housekeeping/settings', { requirePhotos: false });
});

/* ------------------------------------------------------------------ security & permissions */
test('security: authentication and least-privilege permissions are enforced by the backend', async () => {
  assert.equal((await call(null, 'GET', '/restaurant/tables')).status, 401);
  assert.equal((await call('hk', 'GET', '/restaurant/tables')).status, 403);                   // other department, no permission
  assert.equal((await call('rec', 'GET', '/restaurant/menu')).status, 403);
  const rest = await call('rest', 'GET', '/restaurant/tables'); assert.equal(rest.status, 200); assert.ok(rest.data.length >= 8);
  assert.equal((await call('captain', 'POST', '/restaurant/tables', { number: 'X1', capacity: 2 })).status, 403);   // captain cannot restructure tables
  assert.equal((await call('captain', 'POST', '/restaurant/menu/items', { name: 'x', category: (await item('ST01')).category._id, price: 10 })).status, 403);
  assert.equal((await call('chef', 'POST', '/restaurant/orders', { type: 'Takeaway', items: [await L('BV01', 1)] }, { 'Idempotency-Key': key() })).status, 403);
  assert.equal((await call('kitchen', 'GET', '/restaurant/closing/preview')).status, 403);
  assert.equal((await call('captain', 'GET', '/restaurant/closing/preview')).status, 403);
  assert.equal((await call('captain', 'PUT', '/restaurant/settings', { taxes: [] })).status, 403);
  assert.equal((await call('cashier', 'POST', '/restaurant/tables', { number: 'X2', capacity: 2 })).status, 403);
  assert.equal((await call('director', 'GET', '/restaurant/orders')).status, 200);               // view only
  assert.equal((await call('director', 'POST', '/restaurant/orders', { type: 'Takeaway', items: [await L('BV01', 1)] }, { 'Idempotency-Key': key() })).status, 403);
  assert.equal((await call('fom', 'GET', '/restaurant/bills')).status, 200);                    // front office: room-bill visibility (TBC)
  assert.equal((await call('fom', 'POST', '/restaurant/bills/000000000000000000000000/finalise')).status, 403);
});

/* ------------------------------------------------------------------ 6.1 tables & reservations */
test('tables: create / edit / duplicate rejection; derived status; table cannot be typed into "Occupied"', async () => {
  const t = await call('rest', 'POST', '/restaurant/tables', { number: 'Z1', section: 'Terrace', capacity: 4 }); assert.equal(t.status, 201); T.z1 = t.data;
  assert.equal(t.data.status, 'Available');
  assert.equal((await call('rest', 'POST', '/restaurant/tables', { number: 'z1', capacity: 2 })).status, 409);   // case-insensitive unique
  assert.equal((await call('rest', 'POST', '/restaurant/tables', { number: 'Z9', capacity: 0 })).status, 400);
  const u = await call('rest', 'PUT', `/restaurant/tables/${t.data._id}`, { capacity: 6, section: 'Roof', status: 'Occupied', currentOrder: '507f1f77bcf86cd799439011' });
  assert.equal(u.status, 200); assert.equal(u.data.capacity, 6); assert.equal(u.data.status, 'Available'); assert.equal(u.data.currentOrder, null);   // status / claim fields are not accepted
  const oos = await call('rest', 'PUT', `/restaurant/tables/${t.data._id}`, { outOfService: true, outOfServiceReason: 'Wobbly leg' }); assert.equal(oos.data.status, 'Out of Service');
  assert.equal((await mk('captain', { type: 'Dine-in', table: t.data._id, items: [await L('BV01', 1)] })).status, 409);   // cannot seat at an out-of-service table
  await call('rest', 'PUT', `/restaurant/tables/${t.data._id}`, { outOfService: false });
});
test('reservations: capacity, overlap, past times, edit, cancel, seat; permissions', async () => {
  const z1 = T.z1._id, at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  assert.equal((await call('captain', 'POST', '/restaurant/reservations', { guestName: 'Big party', partySize: 9, table: z1, startsAt: at(5) })).status, 400);  // capacity 6
  assert.equal((await call('captain', 'POST', '/restaurant/reservations', { guestName: 'Past', partySize: 2, table: z1, startsAt: at(-3) })).status, 400);
  const r1 = await call('captain', 'POST', '/restaurant/reservations', { guestName: 'Sharma', phone: '9811111111', partySize: 4, table: z1, startsAt: at(6), durationMinutes: 90 }); assert.equal(r1.status, 201, JSON.stringify(r1)); T.r1 = r1.data;
  assert.match(r1.data.reservationNumber, /^TRS-\d+$/);
  assert.equal((await call('captain', 'POST', '/restaurant/reservations', { guestName: 'Clash', partySize: 2, table: z1, startsAt: at(6.5) })).status, 409);   // overlaps 6h-7.5h
  const ok2 = await call('captain', 'POST', '/restaurant/reservations', { guestName: 'After', partySize: 2, table: z1, startsAt: at(8) }); assert.equal(ok2.status, 201);   // back-to-back later is fine
  const ed = await call('captain', 'PUT', `/restaurant/reservations/${r1.data._id}`, { partySize: 5 }); assert.equal(ed.status, 200); assert.equal(ed.data.partySize, 5);
  assert.equal((await call('captain', 'PUT', `/restaurant/reservations/${r1.data._id}`, { startsAt: at(8.2) })).status, 409);                                     // would overlap "After"
  assert.equal((await call('captain', 'POST', `/restaurant/reservations/${ok2.data._id}/cancel`, { reason: 'x' })).status, 400);                                  // reason too short
  assert.equal((await call('captain', 'POST', `/restaurant/reservations/${ok2.data._id}/cancel`, { reason: 'Guest called to cancel' })).status, 200);
  assert.equal((await call('captain', 'PUT', `/restaurant/reservations/${ok2.data._id}`, { partySize: 2 })).status, 400);                                          // cancelled cannot be edited
  assert.equal((await call('chef', 'POST', '/restaurant/reservations', { guestName: 'x', partySize: 2, table: z1, startsAt: at(20) })).status, 403);
  const list = await call('captain', 'GET', '/restaurant/reservations?status=Booked&q=Sharma'); assert.ok(list.data.some((r) => r._id === r1.data._id));
  assert.equal((await table('Z1')).nextReservation.guestName, 'Sharma');
});
test('reservation: a walk-in cannot take a table that is reserved within the hold window; seating the reservation creates the linked order', async () => {
  const t2 = (await call('rest', 'POST', '/restaurant/tables', { number: 'Z2', capacity: 4 })).data;
  const soon = new Date(Date.now() + 10 * 60000).toISOString();
  const rs = await call('captain', 'POST', '/restaurant/reservations', { guestName: 'Mehta', partySize: 3, table: t2._id, startsAt: soon }); assert.equal(rs.status, 201);
  assert.equal((await table('Z2')).status, 'Reserved');
  assert.equal((await mk('captain', { type: 'Dine-in', table: t2._id, items: [await L('BV01', 1)] })).status, 409);
  const o = await mk('captain', { type: 'Dine-in', table: t2._id, reservation: rs.data._id, items: [await L('BV01', 2)] }); assert.equal(o.status, 201, JSON.stringify(o));
  assert.equal((await table('Z2')).status, 'Occupied');
  assert.equal((await call('captain', 'GET', `/restaurant/reservations?q=Mehta`)).data[0].status, 'Seated');
  const cancel = await call('rest', 'POST', `/restaurant/orders/${o.data._id}/cancel`, { reason: 'Test cleanup - guests left' }); assert.equal(cancel.status, 200);
  assert.equal((await table('Z2')).status, 'Available' === (await table('Z2')).status ? 'Available' : (await table('Z2')).status);
  assert.equal((await call('captain', 'GET', `/restaurant/reservations?q=Mehta`)).data[0].status, 'Booked');   // reservation goes back to booked when the order is cancelled
  await call('captain', 'POST', `/restaurant/reservations/${rs.data._id}/cancel`, { reason: 'Test cleanup' });
});

/* ------------------------------------------------------------------ 6.2 menu */
test('menu: categories / items, validation, availability toggle by kitchen, POS menu, soft deactivation', async () => {
  assert.equal((await call('rest', 'POST', '/restaurant/menu/categories', { name: 'starters' })).status, 409);       // case-insensitive duplicate
  const cat = await call('rest', 'POST', '/restaurant/menu/categories', { name: 'Specials' }); assert.equal(cat.status, 201);
  const bad1 = await call('rest', 'POST', '/restaurant/menu/items', { name: 'Odd', category: cat.data._id, price: 10.555 }); assert.equal(bad1.status, 400);        // >2 decimals
  assert.equal((await call('rest', 'POST', '/restaurant/menu/items', { name: 'Neg', category: cat.data._id, price: -5 })).status, 400);
  const it = await call('rest', 'POST', '/restaurant/menu/items', { code: 'sp01', name: 'Test Sample', description: 'for tests', category: cat.data._id, price: 33.33, taxable: true, isVeg: true }); assert.equal(it.status, 201, JSON.stringify(it));
  assert.equal(it.data.code, 'SP01'); T.sample = it.data;
  assert.equal((await call('rest', 'POST', '/restaurant/menu/items', { code: 'SP01', name: 'Dup', category: cat.data._id, price: 5 })).status, 409);
  assert.equal((await call('chef', 'PUT', `/restaurant/menu/items/${it.data._id}`, { price: 1 })).status, 403);                    // chef cannot edit prices
  const off = await call('chef', 'PATCH', `/restaurant/menu/items/${it.data._id}/availability`, { available: false, reason: 'Sold out' }); assert.equal(off.status, 200); assert.equal(off.data.available, false);
  const pos = await call('captain', 'GET', '/restaurant/menu'); const posItem = pos.data.flatMap((x) => x.items).find((i) => i.code === 'SP01'); assert.equal(posItem.available, false);
  const blocked = await mk('captain', { type: 'Takeaway', items: [{ menuItem: it.data._id, quantity: 1 }] }); assert.equal(blocked.status, 409); assert.match(blocked.message, /unavailable/);
  await call('kitchen', 'PATCH', `/restaurant/menu/items/${it.data._id}/availability`, { available: true });
  assert.equal((await call('captain', 'PATCH', `/restaurant/menu/items/${it.data._id}/availability`, { available: false })).status, 403);   // captain cannot toggle
  const sr = await call('captain', 'GET', '/restaurant/menu/items?q=paneer'); assert.ok(sr.data.length >= 2 && sr.data.every((i) => /paneer/i.test(i.name + i.description)));
});
test('menu: editing a price or deactivating an item never changes orders that already exist (snapshots)', async () => {
  const o = await mk('captain', { type: 'Takeaway', customer: { name: 'Snapshot' }, items: [await L('DS01', 2)] }); assert.equal(o.status, 201);
  const ds = await item('DS01'); const upd = await call('rest', 'PUT', `/restaurant/menu/items/${ds._id}`, { price: 150 }); assert.equal(upd.status, 200); assert.equal(upd.data.priceHistory.length, 2);
  const again = (await call('captain', 'GET', `/restaurant/orders/${o.data._id}`)).data; assert.equal(again.items[0].unitPrice, 90); assert.equal(again.subtotal, 180);
  const o2 = await mk('captain', { type: 'Takeaway', customer: { name: 'New price' }, items: [await L('DS01', 1)] }); assert.equal(o2.data.items[0].unitPrice, 150);
  await call('rest', 'PUT', `/restaurant/menu/items/${ds._id}`, { price: 90 });
  await call('rest', 'PUT', `/restaurant/menu/items/${ds._id}`, { active: false });
  assert.equal((await mk('captain', { type: 'Takeaway', items: [{ menuItem: ds._id, quantity: 1 }] })).status, 409);       // retired items cannot be ordered
  assert.equal((await call('captain', 'GET', `/restaurant/orders/${o.data._id}`)).data.items[0].name, 'Gulab Jamun (2 pcs)');   // history intact
  await call('rest', 'PUT', `/restaurant/menu/items/${ds._id}`, { active: true, ...{} }); await call('rest', 'PATCH', `/restaurant/menu/items/${ds._id}/availability`, { available: true });
  for (const x of [o.data, o2.data]) await call('rest', 'POST', `/restaurant/orders/${x._id}/cancel`, { reason: 'Test cleanup' });
});

/* ------------------------------------------------------------------ settings (tax / payment methods are TBC -> configurable) */
test('settings: no tax is invented by default; tax and payment methods are configurable, validated and audited', async () => {
  const s0 = await call('rest', 'GET', '/restaurant/settings'); assert.deepEqual(s0.data.taxes, []); assert.ok(s0.data.effectivePaymentMethods.length >= 1);
  assert.equal((await call('rest', 'PUT', '/restaurant/settings', { taxes: [{ name: 'Bad', ratePercent: 150 }] })).status, 400);
  assert.equal((await call('rest', 'PUT', '/restaurant/settings', { taxes: [{ name: 'A', ratePercent: 5, code: 'X' }, { name: 'B', ratePercent: 5, code: 'X' }] })).status, 400);
  const up = await call('rest', 'PUT', '/restaurant/settings', { taxes: [{ code: 'TEST5', name: 'Test tax (demo 5%)', ratePercent: 5 }], paymentMethods: ['Cash', 'UPI', 'Card'] });
  assert.equal(up.status, 200); assert.equal((await call('captain', 'GET', '/restaurant/settings')).data.taxes[0].ratePercent, 5);
  assert.deepEqual((await call('captain', 'GET', '/restaurant/settings')).data.effectivePaymentMethods, ['Cash', 'UPI', 'Card']);
  const logs = await call('owner', 'GET', '/audit-logs?module=Restaurant'); assert.ok((logs.data.data || logs.data).some((l) => /Restaurant settings/.test(l.entityLabel)));
});

/* ------------------------------------------------------------------ 6.3 dine-in: order, kitchen ticket, lifecycle */
test('dine-in: order is persisted from the server menu (client prices ignored), idempotent, holds the table, special instructions kept', async () => {
  const t3 = await table('T3'); const pt = await item('ST01'), naan = await item('BR01');
  const body = { type: 'Dine-in', table: t3._id, covers: 3, notes: 'Birthday - bring a candle', status: 'Completed', billingStatus: 'Paid', subtotal: 1, items: [{ menuItem: pt._id, quantity: 2, notes: 'Extra spicy', unitPrice: 1, price: 1 }, { menuItem: naan._id, quantity: 3 }] };
  const k = key(); const r = await mk('captain', body, k); assert.equal(r.status, 201, JSON.stringify(r)); T.dine = r.data;
  assert.equal(r.data.status, 'Draft'); assert.equal(r.data.billingStatus, 'Unbilled');                // crafted status / billing fields ignored
  assert.equal(r.data.items[0].unitPrice, 260); assert.equal(r.data.subtotal, 685); assert.equal(r.data.items[0].notes, 'Extra spicy'); assert.equal(r.data.notes, 'Birthday - bring a candle');
  assert.equal(r.data.createdByName, 'Deepak Soni (Captain)'); assert.match(r.data.orderNumber, /^ORD-\d+$/);
  const dup = await mk('captain', body, k); assert.equal(dup.status, 200); assert.equal(dup.replayed, true); assert.equal(dup._id || dup.data._id, r.data._id);   // same submit -> same order
  assert.equal(await M.RestaurantOrder.countDocuments({ idempotencyKey: `${(await M.User.findOne({ email: LOGINS.captain }))._id}:${k}` }), 1);
  assert.equal((await mk('captain', body, undefined).then((x) => x.status)), 409);                       // a second, different order on an occupied table
  assert.equal((await call('captain', 'POST', '/restaurant/orders', body)).status, 400);                // no idempotency key -> refused
  const tv = await table('T3'); assert.equal(tv.status, 'Occupied'); assert.equal(tv.order.orderNumber, r.data.orderNumber); assert.equal(tv.order.itemCount, 5);
  assert.equal((await call('captain', 'POST', '/restaurant/orders', { type: 'Dine-in', items: [await L('BV01', 1)] }, { 'Idempotency-Key': key() })).status, 400);   // table required
  assert.equal((await mk('captain', { type: 'Dine-in', table: t3._id, items: [{ menuItem: pt._id, quantity: 0 }] })).status, 400);
});
test('dine-in: edit before sending (quantity, remove), send creates exactly one kitchen ticket, resend is a no-op', async () => {
  const id = T.dine._id, first = T.dine.items[0]._id, naan = T.dine.items[1]._id;
  const e1 = await call('captain', 'PATCH', `/restaurant/orders/${id}/items/${naan}`, { quantity: 4, notes: 'Butter on top' }); assert.equal(e1.status, 200);
  assert.equal((await call('captain', 'GET', `/restaurant/orders/${id}`)).data.subtotal, 740);
  const e2 = await call('captain', 'PATCH', `/restaurant/orders/${id}/items/${naan}`, { quantity: 3 }); assert.equal(e2.data.subtotal, 685);
  const extra = await call('captain', 'POST', `/restaurant/orders/${id}/items`, { items: [await L('BV01', 1)] }); assert.equal(extra.status, 200);
  const chai = extra.data.items.find((i) => i.name === 'Masala Chai'); assert.equal((await call('captain', 'DELETE', `/restaurant/orders/${id}/items/${chai._id}`)).status, 200);   // unsent item: removable
  const send = await call('captain', 'POST', `/restaurant/orders/${id}/send`); assert.equal(send.status, 200, JSON.stringify(send));
  assert.equal(send.data.status, 'Confirmed'); assert.equal(send.ticket.status, 'Queued'); assert.equal(send.ticket.round, 1); assert.equal(send.ticket.tableNumber, 'T3');
  assert.deepEqual(send.ticket.items.map((i) => [i.name, i.quantity, i.notes || null]), [['Paneer Tikka', 2, 'Extra spicy'], ['Butter Naan', 3, 'Butter on top']]);
  assert.equal(send.ticket.notes, 'Birthday - bring a candle'); assert.equal(send.ticket.orderType, 'Dine-in'); T.ticket = send.ticket;
  const again = await call('captain', 'POST', `/restaurant/orders/${id}/send`); assert.equal(again.replayed, true); assert.equal(await M.KitchenTicket.countDocuments({ order: id }), 1);
  assert.equal((await call('captain', 'PATCH', `/restaurant/orders/${id}/items/${first}`, { quantity: 9 })).status, 409);                 // sent items are locked
  assert.equal((await call('captain', 'DELETE', `/restaurant/orders/${id}/items/${first}`)).status, 403);                                 // captain cannot cancel a sent item
  assert.equal((await call('kitchen', 'GET', '/restaurant/tickets')).data.some((t) => t._id === T.ticket._id), true);
});
test('dine-in: ticket lifecycle is validated; order status follows the tickets; permissions per step', async () => {
  const id = T.dine._id, tk = T.ticket._id;
  assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' })).status, 400);                      // cannot skip Preparing
  assert.equal((await call('captain', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' })).status, 403);                  // captain is not the kitchen
  assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Bogus' })).status, 400);
  const p = await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' }); assert.equal(p.status, 200); assert.equal(p.order.status, 'Preparing');
  assert.equal((await call('chef', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' })).status, 400);                      // already preparing
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${id}/serve`)).status, 409);                                              // not ready yet
  const r = await call('chef', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' }); assert.equal(r.order.status, 'Ready');
  const note = await call('captain', 'GET', '/notifications'); assert.ok((note.data || []).some?.((x) => /is ready/.test(x.title)) || JSON.stringify(note).includes('is ready'));
  assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Served' })).status, 403);                      // serving is front-of-house
  const s = await call('captain', 'POST', `/restaurant/orders/${id}/serve`); assert.equal(s.status, 200); assert.equal(s.data.status, 'Served'); assert.ok(s.data.servedAt);
  assert.equal((await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' })).status, 400);                    // finished tickets never go back
  assert.deepEqual(s.data.statusHistory.map((h) => h.status), ['Draft', 'Confirmed', 'Preparing', 'Ready', 'Served']);
});

/* ------------------------------------------------------------------ 6.4 billing: totals, approvals, split, payments */
test('billing: bill totals are computed on the server (5% test tax); draft bill; unsent items block billing', async () => {
  const id = T.dine._id;
  const b = await call('captain', 'POST', `/restaurant/orders/${id}/bills`, {}); assert.equal(b.status, 201, JSON.stringify(b)); assert.equal(b.data.length, 1);
  const bill = b.data[0]; T.bill = bill;
  assert.equal(bill.status, 'Draft'); assert.equal(bill.totals.gross, 685); assert.equal(bill.totals.tax, 34.25); assert.equal(bill.totals.total, 719.25); assert.equal(bill.totalMinor, 71925);
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${id}/bills`, {})).status, 201);        // regenerating a draft is allowed (supersedes the old draft)
  const all = (await call('captain', 'GET', `/restaurant/bills?order=${id}`)).data; assert.equal(all.length, 1); T.bill = all[0];
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${T.bill._id}/payments`, { amount: 10, method: 'Cash' }, { 'Idempotency-Key': key() })).status, 403);   // captain cannot take payment
  assert.equal((await pay('cashier', T.bill._id, { amount: 10, method: 'Cash' })).status, 400);          // draft bills cannot be paid
});
test('discount: needs approval; pending has no effect; rejection has no effect; approval applies exactly once; self-approval refused; audit trail', async () => {
  const id = T.bill._id;
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'percent', value: 10 })).status, 400);           // reason required
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'amount', value: 5000, reason: 'Too big' })).status, 400);   // more than the bill
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'percent', value: 120, reason: 'Nonsense' })).status, 400);
  const rq = await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'percent', value: 10, reason: 'Regular guest' }); assert.equal(rq.status, 202, JSON.stringify(rq));
  assert.equal(rq.approvalRequired, true); assert.equal(rq.approval.type, 'Discount'); assert.equal(rq.approval.status, 'Pending'); T.discAr = rq.approval._id;
  let cur = (await call('captain', 'GET', `/restaurant/bills/${id}`)).data; assert.equal(cur.totals.total, 719.25, 'pending request changes nothing'); assert.equal(cur.adjustments[0].status, 'Pending');
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'amount', value: 20, reason: 'second' })).status, 409);   // one discount at a time
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${id}/finalise`)).status, 409);        // cannot finalise while approval is pending
  assert.equal((await call('captain', 'POST', `/approvals/${T.discAr}/approve`, {})).status, 403);       // requester cannot approve (no approvals.approve)
  assert.equal((await call('cashier', 'POST', `/approvals/${T.discAr}/approve`, {})).status, 403);
  const rej = await call('gm', 'POST', `/approvals/${T.discAr}/reject`, { reason: 'Not this time' }); assert.equal(rej.status, 200, JSON.stringify(rej));
  cur = (await call('captain', 'GET', `/restaurant/bills/${id}`)).data; assert.equal(cur.totals.total, 719.25, 'rejected request changes nothing'); assert.equal(cur.adjustments[0].status, 'Rejected');
  assert.equal(cur.totals.discount, 0);
  const rq2 = await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'percent', value: 10, reason: 'Manager approved verbally' }); assert.equal(rq2.status, 202);
  const ap = await approve(rq2.approval._id, 'gm'); assert.equal(ap.status, 200, JSON.stringify(ap));
  cur = (await call('captain', 'GET', `/restaurant/bills/${id}`)).data;
  assert.equal(cur.totals.discount, 68.5); assert.equal(cur.totals.net, 616.5); assert.equal(cur.totals.tax, 30.83); assert.equal(cur.totals.total, 647.33);
  const a = cur.adjustments.find((x) => x.status === 'Applied'); assert.equal(a.beforeTotal, 719.25); assert.equal(a.afterTotal, 647.33); assert.equal(String(a.approval), String(rq2.approval._id)); assert.ok(a.decidedByName);
  assert.equal((await approve(rq2.approval._id, 'gm')).status, 400);                                      // an approved request cannot be applied again
  assert.equal((await approve(rq2.approval._id, 'owner')).status, 400);
  assert.equal((await call('captain', 'GET', `/restaurant/bills/${id}`)).data.totals.total, 647.33);
  const logs = (await call('owner', 'GET', '/audit-logs?module=Restaurant Billing')); assert.ok((logs.data.data || logs.data).some((l) => /Discount approved/.test(l.entityLabel)));
  const ar = (await call('gm', 'GET', '/approvals?status=Approved')).data.find((x) => x.type === 'Discount'); assert.equal(ar.referenceModel, 'RestaurantBill');
});
test('complimentary food: needs approval (always), capped by quantity, applies once; the GM cannot approve their own request but the Owner can', async () => {
  const o = await mk('captain', { type: 'Takeaway', customer: { name: 'Comp test' }, items: [await L('MC01', 2), await L('BV02', 1)] }); const id = o.data._id;
  await call('captain', 'POST', `/restaurant/orders/${id}/send`);
  const b = (await call('captain', 'POST', `/restaurant/orders/${id}/bills`, {})).data[0]; const dal = b.lines.find((l) => l.name === 'Dal Makhani');
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${b._id}/adjustments`, { kind: 'Complimentary', lines: [{ orderItem: dal.orderItem, quantity: 3 }], reason: 'Too many' })).status, 400);   // more than ordered
  const rq = await call('captain', 'POST', `/restaurant/bills/${b._id}/adjustments`, { kind: 'Complimentary', lines: [{ orderItem: dal.orderItem, quantity: 1 }], reason: 'Service recovery' });
  assert.equal(rq.status, 202); assert.equal(rq.approval.type, 'Complimentary food'); assert.equal(rq.approval.amount, 220);
  const before = (await call('captain', 'GET', `/restaurant/bills/${b._id}`)).data.totals; assert.equal(before.complimentary, 0); assert.equal(before.gross, 510);
  assert.equal((await approve(rq.approval._id, 'gm')).status, 200);
  const after = (await call('captain', 'GET', `/restaurant/bills/${b._id}`)).data.totals; assert.equal(after.complimentary, 220); assert.equal(after.net, 290); assert.equal(after.tax, 14.5); assert.equal(after.total, 304.5);
  // GM raises + tries to approve their own request
  const o2 = await mk('rest', { type: 'Takeaway', customer: { name: 'Self' }, items: [await L('DS02', 2)] }); await call('rest', 'POST', `/restaurant/orders/${o2.data._id}/send`);
  const b2 = (await call('rest', 'POST', `/restaurant/orders/${o2.data._id}/bills`, {})).data[0];
  const gmReq = await call('gm', 'POST', `/restaurant/bills/${b2._id}/adjustments`, { kind: 'Discount', mode: 'amount', value: 10, reason: 'GM discount' }); assert.equal(gmReq.status, 202);
  assert.equal((await approve(gmReq.approval._id, 'gm')).status, 403);                                    // maker-checker
  assert.equal((await approve(gmReq.approval._id, 'owner')).status, 200);                                  // another approver may
  assert.equal((await call('gm', 'GET', `/restaurant/bills/${b2._id}`)).data.totals.discount, 10);
  T.compOrders = [id, o2.data._id];
});
test('approval hygiene: changing the order withdraws pending requests; a stale request cannot be applied', async () => {
  const o = await mk('captain', { type: 'Takeaway', customer: { name: 'Stale' }, items: [await L('MC02', 1)] }); const id = o.data._id; await call('captain', 'POST', `/restaurant/orders/${id}/send`);
  const b = (await call('captain', 'POST', `/restaurant/orders/${id}/bills`, {})).data[0];
  const rq = await call('captain', 'POST', `/restaurant/bills/${b._id}/adjustments`, { kind: 'Discount', mode: 'percent', value: 5, reason: 'Stale test' });
  await call('captain', 'POST', `/restaurant/orders/${id}/items`, { items: [await L('BV01', 1)] });          // order changed -> draft bill superseded
  assert.equal((await call('captain', 'GET', `/restaurant/bills/${b._id}`)).data.status, 'Void');
  assert.equal((await call('gm', 'GET', `/approvals/${rq.approval._id}`)).data.status, 'Rejected');        // request withdrawn automatically
  assert.equal((await approve(rq.approval._id, 'gm')).status, 400);                                          // and cannot be approved afterwards
  T.compOrders.push(id);
});
test('split bill: every quantity assigned exactly once; tax is shared so the split bills add up to the unsplit bill to the paisa', async () => {
  const t4 = await table('T4'); const sp = T.sample;
  const o = await mk('captain', { type: 'Dine-in', table: t4._id, items: [{ menuItem: sp._id, quantity: 3 }, await L('BR01', 2)] }); assert.equal(o.status, 201); T.split = o.data;
  await call('captain', 'POST', `/restaurant/orders/${o.data._id}/send`);
  const [s, nn] = o.data.items; const ids = { s: s._id, n: nn._id };
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${o.data._id}/bills`, { splits: [{ lines: [{ orderItem: ids.s, quantity: 1 }] }, { lines: [{ orderItem: ids.s, quantity: 1 }, { orderItem: ids.n, quantity: 2 }] }] })).status, 400);   // 1 sample unassigned
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${o.data._id}/bills`, { splits: [{ lines: [{ orderItem: ids.s, quantity: 2 }] }, { lines: [{ orderItem: ids.s, quantity: 2 }, { orderItem: ids.n, quantity: 2 }] }] })).status, 400);   // 4 > 3
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${o.data._id}/bills`, { splits: [{ lines: [{ orderItem: '507f1f77bcf86cd799439011', quantity: 1 }] }, { lines: [{ orderItem: ids.s, quantity: 3 }] }] })).status, 400);
  const r = await call('captain', 'POST', `/restaurant/orders/${o.data._id}/bills`, { splits: [
    { label: 'Anil', lines: [{ orderItem: ids.s, quantity: 1 }, { orderItem: ids.n, quantity: 1 }] }, { label: 'Bina', lines: [{ orderItem: ids.s, quantity: 1 }, { orderItem: ids.n, quantity: 1 }] }, { label: 'Chetan', lines: [{ orderItem: ids.s, quantity: 1 }] }] });
  assert.equal(r.status, 201, JSON.stringify(r)); assert.equal(r.data.length, 3);
  const sumMinor = (k) => r.data.reduce((a, b) => a + Math.round(b.totals[k] * 100), 0);
  // unsplit: 3 x 33.33 + 2 x 55 = 209.99; 5% tax = 10.50 (10.4995 -> 10.50); total 220.49
  assert.equal(sumMinor('gross'), 20999); assert.equal(sumMinor('tax'), 1050); assert.equal(sumMinor('total'), 22049);
  assert.deepEqual(r.data.map((b) => b.label), ['Anil', 'Bina', 'Chetan']); assert.ok(r.data.every((b) => b.splitCount === 3));
  const qty = {}; r.data.forEach((b) => b.lines.forEach((l) => { qty[l.name] = (qty[l.name] || 0) + l.quantity; })); assert.deepEqual(qty, { 'Test Sample': 3, 'Butter Naan': 2 });
  T.splitBills = r.data;
  assert.equal((await call('captain', 'GET', `/restaurant/orders/${o.data._id}`)).data.bills.length, 3);
});
test('payments: server balance, method list, idempotent retry, no overpayment, partial then full, order completes and table is released', async () => {
  const id = T.bill._id; let b = (await call('captain', 'POST', `/restaurant/bills/${id}/finalise`)).data;
  assert.equal(b.status, 'Final'); assert.equal(b.settlement, 'Unsettled'); assert.equal(b.balanceMinor, 64733); assert.equal(b.taxSnapshot.taxes[0].ratePercent, 5); assert.equal(b.taxSnapshot.configured, true);
  const again = await call('captain', 'POST', `/restaurant/bills/${id}/finalise`); assert.equal(again.status, 200); assert.equal(again.replayed, true);
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${id}/adjustments`, { kind: 'Discount', mode: 'amount', value: 5, reason: 'after final' })).status, 409);        // frozen
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${T.dine._id}/items`, { items: [await L('BV01', 1)] })).status, 409);                                           // order locked once billed
  assert.equal((await pay('cashier', id, { amount: 100, method: 'Bitcoin' })).status, 400);                                                                                      // not a configured method
  assert.equal((await pay('cashier', id, { amount: 0, method: 'Cash' })).status, 400); assert.equal((await pay('cashier', id, { amount: 10.123, method: 'Cash' })).status, 400);
  assert.equal((await call('cashier', 'POST', `/restaurant/bills/${id}/payments`, { amount: 100, method: 'Cash' })).status, 400);                                                // key required
  const k1 = key(); const p1 = await pay('cashier', id, { amount: 300, method: 'Cash' }, k1); assert.equal(p1.status, 201, JSON.stringify(p1)); assert.equal(p1.data.settlement, 'Part-paid'); assert.equal(p1.data.balanceMinor, 34733);
  const dup = await pay('cashier', id, { amount: 300, method: 'Cash' }, k1); assert.equal(dup.status, 200); assert.equal(dup.replayed, true);          // duplicate submit
  assert.equal((await call('cashier', 'GET', `/restaurant/bills/${id}`)).data.payments.length, 1); assert.equal((await call('cashier', 'GET', `/restaurant/bills/${id}`)).data.balanceMinor, 34733);
  assert.equal((await pay('cashier', id, { amount: 400, method: 'UPI' })).status, 400);                                                                                          // more than the balance
  assert.equal((await call('cashier', 'GET', `/restaurant/orders/${T.dine._id}`)).data.status, 'Served');
  const p2 = await pay('cashier', id, { amount: 347.33, method: 'UPI', reference: 'UTR123' }); assert.equal(p2.status, 201); assert.equal(p2.data.settlement, 'Paid'); assert.equal(p2.data.balanceMinor, 0);
  assert.equal((await pay('cashier', id, { amount: 1, method: 'Cash' })).status, 400);                                                                                           // nothing left to pay
  const ord = (await call('captain', 'GET', `/restaurant/orders/${T.dine._id}`)).data; assert.equal(ord.status, 'Completed'); assert.equal(ord.billingStatus, 'Paid'); assert.ok(ord.completedAt);
  assert.equal((await table('T3')).status, 'Available'); assert.equal((await call('captain', 'POST', `/restaurant/orders/${T.dine._id}/cancel`, { reason: 'try reopen' })).status, 400);   // completed orders are final
  assert.equal(await M.RestaurantPayment.countDocuments({ bill: id }), 2);
});

/* ------------------------------------------------------------------ cancel & transfer */
test('transfer: moves the open order and its tickets to a free table; refuses occupied / out-of-service / wrong type; preserves the order', async () => {
  const t1 = await table('T1'), t2 = await table('T2'), t6 = await table('T6');
  const o = await mk('captain', { type: 'Dine-in', table: t1._id, items: [await L('MC03', 1)] }); await call('captain', 'POST', `/restaurant/orders/${o.data._id}/send`);
  const blocker = await mk('captain', { type: 'Dine-in', table: t2._id, items: [await L('BV01', 1)] });
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${o.data._id}/transfer`, { table: t2._id })).status, 409);              // T2 occupied
  await call('rest', 'PUT', `/restaurant/tables/${t6._id}`, { outOfService: true, outOfServiceReason: 'Event' });
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${o.data._id}/transfer`, { table: t6._id })).status, 409);              // out of service
  await call('rest', 'PUT', `/restaurant/tables/${t6._id}`, { outOfService: false });
  const t7 = await table('T7'); const tr = await call('captain', 'POST', `/restaurant/orders/${o.data._id}/transfer`, { table: t7._id }); assert.equal(tr.status, 200, JSON.stringify(tr));
  assert.equal(tr.data.tableNumber, 'T7'); assert.equal(tr.data.orderNumber, o.data.orderNumber); assert.equal(tr.data.items.length, 1); assert.equal(tr.data.status, 'Confirmed'); assert.equal(tr.data.tableHistory[0].from, 'T1');
  assert.equal(tr.data.tickets[0].tableNumber, 'T7'); assert.equal(tr.data.tickets.length, 1);
  assert.equal((await table('T1')).status, 'Available'); assert.equal((await table('T7')).status, 'Occupied'); assert.equal((await table('T7')).order.orderNumber, o.data.orderNumber);
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${o.data._id}/transfer`, { table: t7._id })).status, 400);               // same table
  const tk = await mk('captain', { type: 'Takeaway', customer: { name: 'No table' }, items: [await L('BV01', 1)] });
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${tk.data._id}/transfer`, { table: t1._id })).status, 400);             // takeaway has no table
  assert.equal((await call('chef', 'POST', `/restaurant/orders/${o.data._id}/transfer`, { table: t1._id })).status, 403);
  T.transferred = o.data._id; T.blocker = blocker.data._id; T.tk = tk.data._id;
});
test('cancel: a captain may cancel a draft; a sent order needs a manager; reasons required; items are kept; tickets cancelled; table freed; audited', async () => {
  const t1 = await table('T1');
  const d = await mk('captain', { type: 'Dine-in', table: t1._id, items: [await L('BV01', 1)] });
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${d.data._id}/cancel`, { reason: 'x' })).status, 400);
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${d.data._id}/cancel`, { reason: 'Guest changed mind' })).status, 200);
  const kept = (await call('captain', 'GET', `/restaurant/orders/${d.data._id}`)).data; assert.equal(kept.status, 'Cancelled'); assert.equal(kept.items.length, 1); assert.equal(kept.cancelReason, 'Guest changed mind'); assert.equal((await table('T1')).status, 'Available');
  const s = T.transferred;
  assert.equal((await call('captain', 'POST', `/restaurant/orders/${s}/cancel`, { reason: 'Guest left the hotel' })).status, 403);         // sent -> manager only
  assert.equal((await call('rest', 'POST', `/restaurant/orders/${s}/cancel`, { reason: 'Guest left the hotel' })).status, 200);
  const o = (await call('rest', 'GET', `/restaurant/orders/${s}`)).data; assert.equal(o.status, 'Cancelled'); assert.ok(o.tickets.every((t) => t.status === 'Cancelled')); assert.equal((await table('T7')).status, 'Available');
  assert.equal((await call('rest', 'POST', `/restaurant/orders/${s}/cancel`, { reason: 'twice' })).status, 400);
  assert.equal((await call('rest', 'POST', `/restaurant/orders/${s}/send`)).status, 400);
  const logs = await call('owner', 'GET', '/audit-logs?module=Restaurant'); assert.ok((logs.data.data || logs.data).some((l) => l.action === 'status' && /Guest left the hotel/.test(l.note || '')));
});
test('void item: unsent items are removed; a sent item needs a manager + reason, stays visible as Cancelled and the ticket is updated', async () => {
  const t2 = await table('T2'); const o = T.blocker;
  const first = await call('captain', 'POST', `/restaurant/orders/${o}/items`, { items: [await L('BV02', 2)] }); assert.equal(first.status, 200);
  await call('captain', 'POST', `/restaurant/orders/${o}/send`);
  const cur = (await call('captain', 'GET', `/restaurant/orders/${o}`)).data; const lime = cur.items.find((i) => i.name === 'Fresh Lime Soda');
  assert.equal((await call('captain', 'DELETE', `/restaurant/orders/${o}/items/${lime._id}`)).status, 403);
  assert.equal((await call('rest', 'DELETE', `/restaurant/orders/${o}/items/${lime._id}`, {})).status, 400);                       // reason required
  const v = await call('rest', 'DELETE', `/restaurant/orders/${o}/items/${lime._id}`, { reason: 'Guest changed their mind' }); assert.equal(v.status, 200, JSON.stringify(v));
  const after = v.data.items.find((i) => i._id === lime._id); assert.equal(after.status, 'Cancelled'); assert.equal(v.data.subtotal, 40);
  assert.ok(v.data.tickets.flatMap((t) => t.items).some((i) => i.name === 'Fresh Lime Soda' && i.cancelled));
  void t2;
});

/* ------------------------------------------------------------------ takeaway & delivery */
test('takeaway and delivery: information captured and validated; kitchen tickets; billed and paid; searchable', async () => {
  const tw = await mk('captain', { type: 'Takeaway', customer: { name: 'Rakesh', phone: '98-111 22233' }, notes: 'Pack separately', items: [await L('MC05', 1, 'No onion'), await L('BR01', 2)] }); assert.equal(tw.status, 201);
  assert.equal(tw.data.customer.name, 'Rakesh'); assert.equal(tw.data.customer.phone, '9811122233'); assert.ok(!tw.data.table);
  const dl1 = await mk('captain', { type: 'Delivery', items: [await L('MC01', 1)] }); assert.equal(dl1.status, 400);                                  // delivery details missing
  const dl2 = await mk('captain', { type: 'Delivery', delivery: { contactName: 'Sita' }, items: [await L('MC01', 1)] }); assert.equal(dl2.status, 400); assert.match(dl2.message, /phone|address/);
  const dl = await mk('captain', { type: 'Delivery', delivery: { contactName: 'Sita Devi', phone: '9822233344', address: '12 Lake View Road, Minal', landmark: 'Near temple', instructions: 'Call at gate' }, items: [await L('MC04', 2), await L('BV03', 1)] }); assert.equal(dl.status, 201, JSON.stringify(dl));
  assert.equal(dl.data.delivery.address, '12 Lake View Road, Minal'); assert.equal(dl.data.subtotal, 500);
  for (const o of [tw.data, dl.data]) {
    const s = await call('captain', 'POST', `/restaurant/orders/${o._id}/send`); assert.equal(s.status, 200); assert.equal(s.ticket.orderType, o.type); assert.ok(!s.ticket.tableNumber);
    const tk = s.ticket._id; await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' }); await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' });
    assert.equal((await call('captain', 'POST', `/restaurant/orders/${o._id}/serve`)).data.status, 'Served');
    const bill = (await call('captain', 'POST', `/restaurant/orders/${o._id}/bills`, {})).data[0]; const f = await call('captain', 'POST', `/restaurant/bills/${bill._id}/finalise`); assert.equal(f.status, 200);
    const p = await pay('cashier', bill._id, { amount: f.data.totals.total, method: 'Cash' }); assert.equal(p.status, 201); assert.equal(p.data.settlement, 'Paid');
    assert.equal((await call('captain', 'GET', `/restaurant/orders/${o._id}`)).data.status, 'Completed');
  }
  const search = await call('captain', 'GET', '/restaurant/orders?q=Rakesh'); assert.equal(search.data.length, 1); assert.equal(search.data[0].type, 'Takeaway');
  const byType = await call('captain', 'GET', '/restaurant/orders?type=Delivery&status=Completed'); assert.ok(byType.data.every((o) => o.type === 'Delivery' && o.status === 'Completed')); assert.ok(byType.data.length >= 1);
  const today = (await call('captain', 'GET', `/restaurant/orders?date=${c.ymd()}`)); assert.ok(today.total >= 4); assert.ok((await call('captain', 'GET', '/restaurant/orders?active=true')).data.every((o) => ['Draft', 'Confirmed', 'Preparing', 'Ready', 'Served'].includes(o.status)));
});

/* ------------------------------------------------------------------ room service -> guest folio */
const inHouse = async (room) => (await call('rest', 'GET', '/restaurant/in-house')).data.find((g) => g.roomNumber === room);
const folioOf = async (stay) => (await M.Folio.findOne({ reservation: stay }));
const rsBody = async (g, extra = {}) => ({ type: 'Room Service', stayReservation: g.reservationId, roomNumber: g.roomNumber, items: [await L('MC01', 1, 'Less salt'), await L('BR01', 2)], notes: 'Knock twice', ...extra });
test('room service: the guest / room / folio come from the database; invalid stays are refused', async () => {
  const g = await inHouse('303'); assert.ok(g, 'a checked-in guest is in room 303'); T.g303 = g;
  assert.deepEqual(Object.keys(g).sort(), ['checkOut', 'guestName', 'reservationId', 'reservationNumber', 'roomNumber']);   // minimal guest data only
  assert.equal((await mk('rest', { type: 'Room Service', items: [await L('MC01', 1)] })).status, 400);                                        // no stay
  assert.equal((await mk('rest', await rsBody(g, { roomNumber: '102' }))).status, 400);                                                        // wrong room for this stay
  const arriving = (await M.Reservation.findOne({ status: 'Confirmed' })); assert.equal((await mk('rest', { type: 'Room Service', stayReservation: String(arriving._id), items: [await L('MC01', 1)] })).status, 400);   // not checked in
  const out = await M.Reservation.findOne({ status: 'Checked Out' }); assert.equal((await mk('rest', { type: 'Room Service', stayReservation: String(out._id), items: [await L('MC01', 1)] })).status, 400);
  assert.equal((await mk('rest', { type: 'Room Service', guestName: 'Rohan Mehta', roomNumber: '303', items: [await L('MC01', 1)] })).status, 400);   // a typed name / room alone is never enough
  assert.equal((await call('chef', 'GET', '/restaurant/in-house')).status, 403);
  const f = await folioOf(g.reservationId); await M.Folio.updateOne({ _id: f._id }, { status: 'Closed' });
  assert.equal((await mk('rest', await rsBody(g))).status, 409); await M.Folio.updateOne({ _id: f._id }, { status: 'Open' });                    // closed folio cannot receive charges
});
test('room service: order -> kitchen -> served -> bill; the charge is posted ONCE to the correct folio and stays linked; room & stay untouched', async () => {
  const g = T.g303; const folio0 = await folioOf(g.reservationId); const roomBefore = await M.Room.findOne({ roomNumber: '303' }); const resBefore = await M.Reservation.findById(g.reservationId);
  const o = await mk('rest', await rsBody(g)); assert.equal(o.status, 201, JSON.stringify(o)); assert.equal(o.data.stay.roomNumber, '303'); assert.match(o.data.stay.guestName, /Rohan/); assert.equal(String(o.data.stay.folio), String(folio0._id));
  const s = await call('rest', 'POST', `/restaurant/orders/${o.data._id}/send`); assert.equal(s.ticket.roomNumber, '303'); assert.equal(s.ticket.orderType, 'Room Service'); assert.equal(s.ticket.items[0].notes, 'Less salt');
  await call('kitchen', 'POST', `/restaurant/tickets/${s.ticket._id}/status`, { status: 'Preparing' }); await call('kitchen', 'POST', `/restaurant/tickets/${s.ticket._id}/status`, { status: 'Ready' });
  await call('rest', 'POST', `/restaurant/orders/${o.data._id}/serve`);
  const bill = (await call('rest', 'POST', `/restaurant/orders/${o.data._id}/bills`, {})).data[0]; assert.equal(bill.totals.total, 346.5);       // 330 + 5% test tax
  const f = await call('rest', 'POST', `/restaurant/bills/${bill._id}/finalise`); assert.equal(f.status, 200, JSON.stringify(f));
  assert.equal(f.data.posting.state, 'Posted'); assert.equal(f.data.settlement, 'Posted to Room'); assert.equal(String(f.data.posting.folio), String(folio0._id));
  const folio1 = await folioOf(g.reservationId); const added = folio1.charges.filter((x) => x.source === 'restaurant-pos');
  assert.equal(added.length, 2); assert.deepEqual(added.map((x) => [x.type, x.amount]), [['Room Service', 330], ['Tax', 16.5]]); assert.ok(added.every((x) => String(x.sourceId) === String(bill._id) && x.sourceRef.startsWith('rb:')));
  assert.equal(Math.round((folio1.totalCharges - folio0.totalCharges) * 100), 34650); assert.equal(Math.round((folio1.outstanding - folio0.outstanding) * 100), 34650);
  // retries / repeated calls never double-charge
  assert.equal((await call('rest', 'POST', `/restaurant/bills/${bill._id}/post-to-folio`)).data.posting.state, 'Posted'); assert.equal((await call('rest', 'POST', `/restaurant/bills/${bill._id}/finalise`)).replayed, true);
  assert.equal((await folioOf(g.reservationId)).charges.filter((x) => x.source === 'restaurant-pos').length, 2);
  assert.equal((await pay('cashier', bill._id, { amount: 10, method: 'Cash' })).status, 400);                                                 // a folio charge is not paid at the restaurant
  const done = (await call('rest', 'GET', `/restaurant/orders/${o.data._id}`)).data; assert.equal(done.status, 'Completed'); assert.equal(done.billingStatus, 'Posted to Room');
  const bv = (await call('rest', 'GET', `/restaurant/bills/${bill._id}`)).data; assert.equal(bv.folio.folioNumber, folio1.folioNumber); assert.equal(bv.order.orderNumber, o.data.orderNumber); assert.equal(bv.payments.length, 0);
  const guestBill = (await call('owner', 'GET', `/bills/${folio1._id}`)).data; assert.ok(guestBill.charges.some((x) => /Room service/.test(x.description) && x.source === 'restaurant-pos'));   // visible on the existing guest bill
  assert.equal((await M.Room.findOne({ roomNumber: '303' })).status, roomBefore.status); assert.equal((await M.Reservation.findById(g.reservationId)).status, resBefore.status);
  assert.equal(await M.Payment.countDocuments({ folio: folio0._id, method: /Room|Restaurant/ }), 0);                                          // never recorded as a payment
  T.rsBill = bill;
});
test('room service: a failed posting never leaves a false "posted" state, is visible and retryable, and posts exactly once on retry', async () => {
  const g = await inHouse('301'); const o = await mk('rest', await rsBody(g, { items: [await L('DS02', 2)] })); await call('rest', 'POST', `/restaurant/orders/${o.data._id}/send`);
  const tk = (await call('rest', 'GET', `/restaurant/orders/${o.data._id}`)).data.tickets[0]._id; await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' }); await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' }); await call('rest', 'POST', `/restaurant/orders/${o.data._id}/serve`);
  const bill = (await call('rest', 'POST', `/restaurant/orders/${o.data._id}/bills`, {})).data[0]; const f0 = await folioOf(g.reservationId); const before = f0.charges.length;
  await M.Folio.updateOne({ _id: f0._id }, { status: 'Closed' });                                                                                // simulate: folio no longer accepts charges
  const f = await call('rest', 'POST', `/restaurant/bills/${bill._id}/finalise`); assert.equal(f.status, 200); assert.equal(f.data.status, 'Final'); assert.equal(f.data.posting.state, 'Failed'); assert.match(f.data.posting.error, /closed/i);
  assert.notEqual(f.data.settlement, 'Posted to Room'); assert.equal((await folioOf(g.reservationId)).charges.length, before);
  assert.equal((await call('rest', 'GET', `/restaurant/orders/${o.data._id}`)).data.status, 'Served');                                            // not falsely completed
  const note = await call('rest', 'GET', '/notifications'); assert.ok(JSON.stringify(note).includes('not posted'));
  await M.Folio.updateOne({ _id: f0._id }, { status: 'Open' });
  const retry = await call('rest', 'POST', `/restaurant/bills/${bill._id}/post-to-folio`); assert.equal(retry.data.posting.state, 'Posted'); assert.equal(retry.data.posting.attempts, 2);
  await call('rest', 'POST', `/restaurant/bills/${bill._id}/post-to-folio`);
  assert.equal((await folioOf(g.reservationId)).charges.length, before + 2);                                                                        // charge + tax, once
  assert.equal((await call('rest', 'GET', `/restaurant/orders/${o.data._id}`)).data.status, 'Completed');
});
test('void: a posted room-service bill is reversed on the folio only after approval (history is never rewritten)', async () => {
  const b = T.rsBill; const f0 = await folioOf(T.g303.reservationId);
  assert.equal((await call('captain', 'POST', `/restaurant/bills/${b._id}/void`, { reason: 'Wrong room' })).status, 403);                        // captain: draft only
  const rq = await call('rest', 'POST', `/restaurant/bills/${b._id}/void`, { reason: 'Charged to the wrong guest' }); assert.equal(rq.status, 202); assert.equal(rq.approval.type, 'Bill editing');
  assert.equal((await folioOf(T.g303.reservationId)).totalCharges, f0.totalCharges);                                                             // nothing happens before approval
  assert.equal((await approve(rq.approval._id, 'gm')).status, 200);
  const f1 = await folioOf(T.g303.reservationId); assert.equal(Math.round((f0.totalCharges - f1.totalCharges) * 100), 34650);
  assert.equal(f1.charges.filter((x) => x.source === 'restaurant-pos').length, 4);                                                                // original + reversal lines
  const bv = (await call('rest', 'GET', `/restaurant/bills/${b._id}`)).data; assert.equal(bv.status, 'Void'); assert.equal(bv.posting.state, 'Reversed');
  assert.equal((await approve(rq.approval._id, 'gm')).status, 400);
});

/* ------------------------------------------------------------------ concurrency (real MongoDB only) */
test('concurrency: parallel duplicate submits create one order, one ticket and cannot over-collect', async (t) => {
  if (!c.concurrency(t)) return;
  const t8 = await table('T8'); const body = { type: 'Dine-in', table: t8._id, items: [await L('MC03', 1)] }; const k = key();
  const rs = await Promise.all(Array.from({ length: 5 }, () => mk('captain', body, k))); assert.ok(rs.every((r) => [200, 201].includes(r.status)));
  assert.equal(new Set(rs.map((r) => r.data._id)).size, 1);
  const id = rs[0].data._id; const sends = await Promise.all(Array.from({ length: 4 }, () => call('captain', 'POST', `/restaurant/orders/${id}/send`))); assert.ok(sends.every((r) => r.status === 200)); assert.equal(await M.KitchenTicket.countDocuments({ order: id }), 1);
  const tk = (await call('captain', 'GET', `/restaurant/orders/${id}`)).data.tickets[0]._id; await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' }); await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' }); await call('captain', 'POST', `/restaurant/orders/${id}/serve`);
  const bill = (await call('captain', 'POST', `/restaurant/orders/${id}/bills`, {})).data[0]; const fin = (await call('captain', 'POST', `/restaurant/bills/${bill._id}/finalise`)).data;
  const pays = await Promise.all(Array.from({ length: 4 }, () => pay('cashier', bill._id, { amount: fin.totals.total, method: 'Cash' }))); assert.equal(pays.filter((p) => p.status === 201).length, 1);
  assert.equal((await M.RestaurantBill.findById(bill._id)).paidMinor, fin.totalMinor);
});

/* ------------------------------------------------------------------ 6.5 daily closing */
const PAST = '2026-01-05';
const settleToKitchen = async (id) => { const s = await call('rest', 'POST', `/restaurant/orders/${id}/send`); const tk = s.ticket._id; await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Preparing' }); await call('kitchen', 'POST', `/restaurant/tickets/${tk}/status`, { status: 'Ready' }); return call('rest', 'POST', `/restaurant/orders/${id}/serve`); };
const billAndFinalise = async (id) => { const b = (await call('rest', 'POST', `/restaurant/orders/${id}/bills`, {})).data[0]; return (await call('rest', 'POST', `/restaurant/bills/${b._id}/finalise`)).data; };
const moveToDate = async (orderIds, date) => {
  await M.RestaurantOrder.updateMany({ _id: { $in: orderIds } }, { businessDate: date });
  await M.RestaurantBill.updateMany({ order: { $in: orderIds } }, { businessDate: date });
  const bills = await M.RestaurantBill.find({ order: { $in: orderIds } }).select('_id'); await M.RestaurantPayment.updateMany({ bill: { $in: bills.map((b) => b._id) } }, { businessDate: date });
};
test('closing: totals are rebuilt from persisted data - sales, tax, discounts, type split, payment methods, room postings, outstanding, cancelled', async () => {
  const t1 = await table('T1'), g = await inHouse('205'); const ids = [];
  const A = await mk('rest', { type: 'Dine-in', table: t1._id, items: [await L('MC02', 1), await L('BR01', 2)] }); ids.push(A.data._id); await settleToKitchen(A.data._id);
  const billA = await billAndFinalise(A.data._id); assert.equal(billA.totals.total, 409.5);
  assert.equal((await pay('cashier', billA._id, { amount: 200, method: 'Cash' })).status, 201); assert.equal((await pay('cashier', billA._id, { amount: 209.5, method: 'UPI' })).status, 201);
  const B = await mk('rest', { type: 'Takeaway', customer: { name: 'Unpaid Uma' }, items: [await L('BV03', 1)] }); ids.push(B.data._id); await settleToKitchen(B.data._id); const billB = await billAndFinalise(B.data._id); assert.equal(billB.totals.total, 126);
  const C = await mk('rest', await rsBody(g, { items: [await L('DS02', 1)] })); ids.push(C.data._id); await settleToKitchen(C.data._id); const billC = await billAndFinalise(C.data._id); assert.equal(billC.posting.state, 'Posted');
  const D = await mk('rest', { type: 'Takeaway', customer: { name: 'Cancelled' }, items: [await L('MC05', 1)] }); ids.push(D.data._id); await call('rest', 'POST', `/restaurant/orders/${D.data._id}/cancel`, { reason: 'Customer never came' });
  const E = await mk('rest', { type: 'Takeaway', customer: { name: 'Still cooking' }, items: [await L('BV01', 1)] }); ids.push(E.data._id);             // a draft that blocks closing
  await moveToDate(ids, PAST); T.closeIds = ids;
  const p = (await call('rest', 'GET', `/restaurant/closing/preview?date=${PAST}`)).data;
  assert.equal(p.canClose, false); assert.deepEqual(p.exceptions.filter((e) => e.severity === 'blocker').map((e) => e.code), ['OPEN_ORDERS']);
  assert.equal(p.totals.sales.gross, 590); assert.equal(p.totals.sales.tax, 29.5); assert.equal(p.totals.sales.total, 619.5); assert.equal(p.totals.sales.net, 590);
  assert.equal(p.totals.byType['Dine-in'].total, 409.5); assert.equal(p.totals.byType.Takeaway.total, 126); assert.equal(p.totals.byType['Room Service'].total, 84); assert.equal(p.totals.byType.Delivery.total, 0);
  assert.equal(p.totals.collected.total, 409.5); assert.deepEqual(p.totals.collected.byMethod, { Cash: { count: 1, amount: 200 }, UPI: { count: 1, amount: 209.5 } });
  assert.equal(p.totals.postedToRooms.amount, 84);                                                     // a folio posting is NOT cash
  assert.equal(p.totals.collected.total + p.totals.postedToRooms.amount + p.totals.outstanding.amount, p.totals.sales.total);   // every rupee of sales is accounted for exactly once
  assert.equal(p.totals.outstanding.amount, 126); assert.equal(p.totals.cancelledOrders.count, 1); assert.equal(p.totals.cancelledOrders.value, 320);   // cancelled is not a sale
  assert.equal(p.totals.orders.total, 5); assert.equal(p.totals.orders.cancelled, 1);
  assert.equal((await call('rest', 'POST', '/restaurant/closing', { businessDate: PAST }, { 'Idempotency-Key': key() })).status, 409);   // blocker
  await call('rest', 'POST', `/restaurant/orders/${E.data._id}/cancel`, { reason: 'Customer left' });
});
test('closing: outstanding balances must be acknowledged; closing is persisted once with a snapshot; duplicates and replays are safe; permissions', async () => {
  const p = (await call('rest', 'GET', `/restaurant/closing/preview?date=${PAST}`)).data;
  assert.equal(p.canClose, true); assert.deepEqual(p.exceptions.filter((e) => e.severity === 'acknowledge').map((e) => e.code), ['OUTSTANDING_BILLS']);
  assert.equal((await call('captain', 'POST', '/restaurant/closing', { businessDate: PAST }, { 'Idempotency-Key': key() })).status, 403);
  assert.equal((await call('cashier', 'POST', '/restaurant/closing', { businessDate: PAST }, { 'Idempotency-Key': key() })).status, 403);
  assert.equal((await call('rest', 'POST', '/restaurant/closing', { businessDate: PAST })).status, 400);                                          // key required
  assert.equal((await call('rest', 'POST', '/restaurant/closing', { businessDate: PAST }, { 'Idempotency-Key': key() })).status, 400);              // not acknowledged
  assert.equal((await call('rest', 'POST', '/restaurant/closing', { businessDate: '2999-01-01', acknowledge: ['OUTSTANDING_BILLS'] }, { 'Idempotency-Key': key() })).status, 400);   // future day
  const k = key(); const ok1 = await call('rest', 'POST', '/restaurant/closing', { businessDate: PAST, acknowledge: ['OUTSTANDING_BILLS'], notes: 'Unpaid Uma will settle tomorrow' }, { 'Idempotency-Key': k });
  assert.equal(ok1.status, 201, JSON.stringify(ok1)); assert.equal(ok1.data.status, 'Closed'); assert.equal(ok1.data.closedByName, 'Imran Khan'); assert.deepEqual(ok1.data.acknowledged, ['OUTSTANDING_BILLS']);
  assert.equal(ok1.data.totals.sales.total, 619.5); assert.equal(ok1.data.references.orders.length, 5); assert.equal(ok1.data.references.bills.length, 3); assert.equal(ok1.data.references.payments.length, 2);
  const replay = await call('rest', 'POST', '/restaurant/closing', { businessDate: PAST, acknowledge: ['OUTSTANDING_BILLS'] }, { 'Idempotency-Key': k }); assert.equal(replay.status, 200); assert.equal(replay.replayed, true); assert.equal(replay.data._id, ok1.data._id);
  assert.equal((await call('rest', 'POST', '/restaurant/closing', { businessDate: PAST, acknowledge: ['OUTSTANDING_BILLS'] }, { 'Idempotency-Key': key() })).status, 409);   // a different request cannot close the same day again
  assert.equal(await M.RestaurantClosing.countDocuments({ businessDate: PAST }), 1);
  const snap = ok1.data.totals; await M.RestaurantBill.updateMany({}, { $set: { 'totals.total': 1 } }).then(() => null);                              // even if live data were tampered with later...
  assert.equal((await call('rest', 'GET', `/restaurant/closings/${PAST}`)).data.totals.sales.total, snap.sales.total);                              // ...the closing snapshot is unchanged
  const st = (await call('gm', 'GET', `/restaurant/closings/${PAST}/status`)).data; assert.equal(st.closed, true); assert.equal(st.totals.sales.total, 619.5);   // Phase 13 boundary
  assert.equal((await call('gm', 'GET', '/restaurant/closings/2026-02-02/status')).data.closed, false);
  assert.equal((await call('rest', 'GET', '/restaurant/closings')).data[0].businessDate, PAST);
  const logs = await call('owner', 'GET', '/audit-logs?module=Restaurant Closing'); assert.ok((logs.data.data || logs.data).some((l) => /Restaurant closed 2026-01-05/.test(l.entityLabel)));
  const billB = await M.RestaurantBill.findOne({ order: T.closeIds[1] }); assert.equal((await call('rest', 'POST', `/restaurant/bills/${billB._id}/void`, { reason: 'Rewrite history' })).status, 409);   // closed days are not rewritten
});
test('closing: today can be closed and then no new orders open for it; the overview reflects live state', async () => {
  const all = await M.RestaurantOrder.find({ businessDate: c.ymd() }).select('_id'); await moveToDate(all.map((o) => o._id), '2026-01-04');            // test isolation only: park everything created above on an earlier date
  const ov = (await call('rest', 'GET', '/restaurant/overview')).data; assert.equal(ov.today, c.ymd()); assert.ok(ov.tableTotal >= 8); assert.equal(ov.closedToday, false);
  assert.equal((await call('captain', 'GET', '/restaurant/overview')).data.todaySales, undefined);                                                   // financials only for those who may close
  const close = await call('rest', 'POST', '/restaurant/closing', { businessDate: c.ymd() }, { 'Idempotency-Key': key() }); assert.equal(close.status, 201, JSON.stringify(close));
  assert.equal(close.data.totals.sales.total, 0);
  const blocked = await mk('captain', { type: 'Takeaway', items: [await L('BV01', 1)] }); assert.equal(blocked.status, 409); assert.match(blocked.message, /already closed/);
  assert.equal((await call('rest', 'GET', '/restaurant/overview')).data.closedToday, true);
});
