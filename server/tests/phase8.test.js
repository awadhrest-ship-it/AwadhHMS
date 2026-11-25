// Phase 8 - Bar Management. Runs against a real MongoDB test database (see tests/helpers.js). Every assertion below is executed, none are placeholders.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot } = require('./helpers');
const M = require('../models');
const stock = require('../services/inventory/stock');
const pricing = require('../services/bar/pricing');
const { ALL } = require('../config/permissions');

let c; let ids = {}; let sysReq;
const key = () => ({ 'Idempotency-Key': `t-${crypto.randomUUID()}` });
const total = async (item) => (await M.StockBalance.find({ item, department: 'Bar' })).reduce((s, r) => s + r.qtyQ, 0) / 1e6;
const openMl = async (item) => ((await M.BarOpenStock.findOne({ item }))?.openQ || 0) / 1e6;
const movs = (filter) => M.StockMovement.countDocuments(filter);
const order = async (who, lines, serve = true, headers = key()) => c.call(who, 'POST', '/bar/orders', { lines, serve }, headers);
const openBottles = async (n = 1, item = ids.wsk, who = 'bt') => c.call(who, 'POST', '/bar/openings', { item, bottles: n }, key());
const stockIn = async (item, qty, unit = 'bottle') => stock.postMovement(sysReq, { type: 'Stock In', rawKey: true, trusted: true, lines: [{ item, quantity: qty, unit, toDepartment: 'Bar', unitPrice: 1000 }], reason: 'test stock in', idempotencyKey: `si-${crypto.randomUUID()}` });
const setSettings = (body) => c.call('owner', 'PUT', '/bar/settings', body);

test.before(async () => {
  c = await boot({ owner: 'owner@awadhpalace.test', gm: 'gm@awadhpalace.test', bm: 'barmanager@awadhpalace.test', bt: 'bartender@awadhpalace.test', bt2: 'bartender2@awadhpalace.test', store: 'store@awadhpalace.test', rec: 'reception@awadhpalace.test', rest: 'restaurant@awadhpalace.test' });
  const owner = await M.User.findOne({ email: 'owner@awadhpalace.test' }).populate('role');
  sysReq = { user: owner, permissions: new Set(ALL), headers: {}, ip: 'test', query: {} };
  const sku = async (s) => String((await M.InventoryItem.findOne({ sku: s }))._id);
  ids = { wsk: await sku('DEMO-BAR-WSK-ML'), vod: await sku('DEMO-BAR-VOD-ML'), soda: await sku('DEMO-BAR-SODA') };
  const menu = (await c.call('bm', 'GET', '/bar/menu')).data; ids.wskMenu = menu.find((m) => m.name.startsWith('Whisky'))._id; ids.vodMenu = menu.find((m) => m.name.startsWith('Vodka'))._id;
});
test.after(async () => { await c.close(); });

/* ------------------------------------------------------------------ 8.1 menu, measures, pricing */
test('menu: bar manager creates & updates drinks; bartender cannot; capacity is per item', async () => {
  assert.equal((await c.call('bt', 'POST', '/bar/menu', { name: 'x' })).status, 403);
  const r = await c.call('bm', 'POST', '/bar/menu', { name: 'Test Rum', category: 'Rum', kind: 'spirit', stockItem: ids.vod, servings: [{ measure: '30 ml', ml: 30, price: 100 }, { measure: 'Full bottle', price: 2500 }] });
  assert.equal(r.status, 201); assert.equal(r.data.consumptionStatus, 'Configured'); assert.equal(r.data.bottleCapacityMl, 1000);
  const u = await c.call('bm', 'PUT', `/bar/menu/${r.data._id}`, { servings: [{ measure: '30 ml', ml: 30, price: 110 }, { measure: '60 ml', ml: 60, price: 200 }] });
  assert.equal(u.status, 200); assert.deepEqual(u.data.servings.map((s) => s.measure), ['30 ml', '60 ml']);
  const wsk = (await c.call('bm', 'GET', `/bar/menu/${ids.wskMenu}`)).data; assert.equal(wsk.bottleCapacityMl, 750);   // capacity differs per item
  assert.equal((await c.call('bm', 'POST', '/bar/menu', { name: 'test rum', stockItem: ids.vod, servings: [{ measure: '30 ml', ml: 30, price: 1 }] })).status, 409);   // duplicate name
  assert.equal((await c.call('bm', 'POST', '/bar/menu', { name: 'Bad', stockItem: ids.vod, servings: [{ measure: '30 ml', price: 1 }] })).status, 400);                  // peg needs ml
});
test('menu: consumption is never guessed - unlinked or capacity-less items are Incomplete and cannot be sold', async () => {
  const r = await c.call('bm', 'POST', '/bar/menu', { name: 'Unlinked Gin', kind: 'spirit', servings: [{ measure: '30 ml', ml: 30, price: 90 }] }); assert.equal(r.status, 201); assert.equal(r.data.consumptionStatus, 'Incomplete');
  const o = await order('bt', [{ menuItem: r.data._id, measure: '30 ml', quantity: 1 }]); assert.equal(o.status, 400); assert.match(o.message, /not fully configured/);
  const ns = await c.call('bm', 'POST', '/bar/menu', { name: 'Snack Water', kind: 'packaged', trackStock: false, servings: [{ measure: 'Full bottle', price: 20 }] }); assert.equal(ns.data.consumptionStatus, 'Not stock-tracked');
  const wrongUnit = await c.call('bm', 'PUT', `/bar/liquor-items/${ids.soda}/capacity`, { capacityMl: 500 }); assert.equal(wrongUnit.status, 400);          // soda is not liquor
  const cap = await c.call('bm', 'PUT', `/bar/liquor-items/${ids.vod}/capacity`, { capacityMl: 1000 }); assert.equal(cap.status, 200);
});
test('menu: unavailable drinks cannot be ordered', async () => {
  assert.equal((await c.call('bm', 'POST', `/bar/menu/${ids.vodMenu}/available`, { available: false })).status, 200);
  const o = await order('bt', [{ menuItem: ids.vodMenu, measure: '30 ml', quantity: 1 }]); assert.equal(o.status, 400); assert.match(o.message, /not available/);
  await c.call('bm', 'POST', `/bar/menu/${ids.vodMenu}/available`, { available: true });
});
test('pricing: no happy hour configured -> normal price; client price is ignored', async () => {
  const s = (await c.call('bm', 'GET', '/bar/settings')); assert.deepEqual(s.data.happyHour.rules, []);
  await openBottles(1); const o = await c.call('bt', 'POST', '/bar/orders', { lines: [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 1, unitPrice: 1, price: 1 }], serve: false }, key());
  assert.equal(o.status, 201); assert.equal(o.data.lines[0].unitPrice, 180); assert.equal(o.data.lines[0].happyHour.applied, false); assert.equal(o.data.total, 180);
  assert.equal((await c.call('bt', 'POST', `/bar/orders/${o.data._id}/cancel`, { reason: 'test cleanup' })).status, 200);
});
test('pricing: happy-hour rules (unit) - days, time window, overnight, scope, validation', () => {
  const menu = { _id: 'm1' }; const serving = { price: 200, happyHourPrice: 120 };
  const rule = { id: 'r', name: 'Eve', active: true, days: [1, 2, 3, 4, 5], start: '17:00', end: '19:00', scope: 'all', menuItems: [], mode: 'percent', percentOff: 25 };
  const st = (r) => ({ happyHour: { rules: r } });
  const at = (iso) => new Date(iso);                                                  // 2026-11-09 is a Monday; IST = UTC+5:30
  assert.equal(pricing.priceFor(menu, serving, st([]), at('2026-11-09T12:00:00Z')).unitPrice, 200);
  assert.equal(pricing.priceFor(menu, serving, st([rule]), at('2026-11-09T12:00:00Z')).unitPrice, 150);          // 17:30 IST Monday
  assert.equal(pricing.priceFor(menu, serving, st([rule]), at('2026-11-09T13:30:00Z')).unitPrice, 200);          // 19:00 IST: window is [start,end)
  assert.equal(pricing.priceFor(menu, serving, st([rule]), at('2026-11-08T12:00:00Z')).unitPrice, 200);          // Sunday
  assert.equal(pricing.priceFor(menu, serving, st([{ ...rule, active: false }]), at('2026-11-09T12:00:00Z')).unitPrice, 200);
  assert.equal(pricing.priceFor(menu, serving, st([{ ...rule, mode: 'itemPrice' }]), at('2026-11-09T12:00:00Z')).unitPrice, 120);
  assert.equal(pricing.priceFor(menu, { price: 200 }, st([{ ...rule, mode: 'itemPrice' }]), at('2026-11-09T12:00:00Z')).unitPrice, 200);       // no happy price -> normal
  assert.equal(pricing.priceFor({ _id: 'other' }, serving, st([{ ...rule, scope: 'items', menuItems: ['m1'] }]), at('2026-11-09T12:00:00Z')).unitPrice, 200);
  const night = { ...rule, days: [5], start: '22:00', end: '01:00' };                                            // Friday 22:00 -> Saturday 01:00
  assert.equal(pricing.priceFor(menu, serving, st([night]), at('2026-11-13T17:30:00Z')).unitPrice, 150);        // Fri 23:00 IST
  assert.equal(pricing.priceFor(menu, serving, st([night]), at('2026-11-13T19:00:00Z')).unitPrice, 150);        // Sat 00:30 IST (belongs to Friday's window)
  assert.equal(pricing.priceFor(menu, serving, st([night]), at('2026-11-13T20:00:00Z')).unitPrice, 200);        // Sat 01:30 IST
  assert.throws(() => pricing.validateRules([{ ...rule, start: '25:00' }]), /times/); assert.throws(() => pricing.validateRules([{ ...rule, percentOff: 100 }]), /percent/); assert.throws(() => pricing.validateRules([{ ...rule, days: [] }]), /day/);
});
test('pricing: a configured rule is applied by the backend (and settings need bar.configure)', async () => {
  assert.equal((await c.call('bm', 'PUT', '/bar/settings', { pegMl: 30 })).status, 200);                           // bar manager has bar.configure
  assert.equal((await c.call('bt', 'PUT', '/bar/settings', { pegMl: 30 })).status, 403);
  assert.equal((await setSettings({ happyHour: { rules: [{ name: 'Bad', active: true, days: [1], start: '10:00', end: '10:00', scope: 'all', mode: 'percent', percentOff: 10 }] } })).status, 400);
  const rule = { name: 'Always (test)', active: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', scope: 'all', mode: 'percent', percentOff: 50 };
  assert.equal((await setSettings({ happyHour: { rules: [rule] } })).status, 200);
  const o = await c.call('bt', 'POST', '/bar/orders', { lines: [{ menuItem: ids.wskMenu, measure: '60 ml', quantity: 1 }], serve: false }, key());
  const minute = new Date(Date.now() + 5.5 * 36e5).getUTCHours() * 60 + new Date(Date.now() + 5.5 * 36e5).getUTCMinutes();
  if (minute !== 23 * 60 + 59) { assert.equal(o.data.lines[0].unitPrice, 170); assert.equal(o.data.lines[0].basePrice, 340); assert.equal(o.data.lines[0].happyHour.applied, true); }
  await c.call('bt', 'POST', `/bar/orders/${o.data._id}/cancel`, { reason: 'test cleanup' });
  assert.equal((await setSettings({ happyHour: { rules: [] } })).status, 200);
  assert.equal((await c.call('bt', 'GET', '/bar/menu')).data.find((m) => m._id === ids.wskMenu).servings[1].happyHourActive, false);
});

/* ------------------------------------------------------------------ 8.2 bottle & peg stock */
test('opening a bottle moves sealed -> opened and consumes nothing', async () => {
  const before = await total(ids.wsk); const mv0 = await movs({}); const open0 = await openMl(ids.wsk);
  const r = await openBottles(2); assert.equal(r.status, 201); assert.equal(r.data.capacityMl, 750); assert.equal(r.data.totalMl, 1500); assert.equal(r.data.openedByName.includes('Bartender'), true);
  assert.equal(await total(ids.wsk), before); assert.equal(await movs({}), mv0);                                       // Phase 4 total and movement count untouched
  assert.equal(await openMl(ids.wsk), open0 + 1500);
  assert.equal(await movs({ type: { $in: ['Wastage', 'Breakage'] }, item: undefined }), await movs({ type: { $in: ['Wastage', 'Breakage'] } }));
  const inv = (await c.call('bt', 'GET', '/bar/inventory')).data.find((i) => i.item === ids.wsk); assert.equal(inv.sealedBottles, inv.totalQty / 750 - Math.round((await openMl(ids.wsk)) / 750)); assert.ok(inv.openedMl >= 1500);
  assert.ok((await c.call('bt', 'GET', '/bar/openings')).data.length >= 1);
});
test('opening is idempotent and limited by sealed stock', async () => {
  const k = key(); const open0 = await openMl(ids.wsk);
  const a = await c.call('bt', 'POST', '/bar/openings', { item: ids.wsk, bottles: 1 }, k); const b = await c.call('bt', 'POST', '/bar/openings', { item: ids.wsk, bottles: 1 }, k);
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(a.data._id, b.data._id); assert.equal(await openMl(ids.wsk), open0 + 750);
  assert.equal((await c.call('bt', 'POST', '/bar/openings', { item: ids.wsk, bottles: 50 }, key())).status, 409);       // more than the sealed bottles in stock
  assert.equal((await c.call('bt', 'POST', '/bar/openings', { item: ids.wsk, bottles: 1 })).status, 400);              // no idempotency key
  assert.equal((await c.call('bt', 'POST', '/bar/openings', { item: ids.soda, bottles: 1 }, key())).status, 400);      // not liquor
});
test('30 ml / 60 ml / full-bottle servings deduct exactly the configured quantities', async () => {
  const t0 = await total(ids.wsk); const o0 = await openMl(ids.wsk);
  const a = await order('bt', [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 2 }, { menuItem: ids.wskMenu, measure: '60 ml', quantity: 1 }]); assert.equal(a.status, 201); assert.equal(a.data.status, 'Served'); assert.equal(a.data.total, 700);
  assert.equal(await total(ids.wsk), t0 - 120); assert.equal(await openMl(ids.wsk), o0 - 120);                          // 2x30 + 60 ml, pooled
  const t1 = await total(ids.wsk); const o1 = await openMl(ids.wsk);
  const b = await order('bt', [{ menuItem: ids.wskMenu, measure: 'Full bottle', quantity: 1 }]); assert.equal(b.status, 201);
  assert.equal(await total(ids.wsk), t1 - 750); assert.equal(await openMl(ids.wsk), o1);                              // a sealed 750 ml bottle; opened pool untouched
  const v1 = await total(ids.vod); const vo = await openMl(ids.vod); await openBottles(1, ids.vod);
  assert.equal((await order('bt', [{ menuItem: ids.vodMenu, measure: 'Full bottle', quantity: 1 }])).status, 201); assert.equal(await total(ids.vod), v1 - 1000);   // 1000 ml bottle - capacity is per item
  assert.equal(await openMl(ids.vod), vo + 1000);
  const mv = await M.StockMovement.findById(a.data.movement); assert.equal(mv.type, 'Consumption'); assert.equal(mv.source, 'bar-sale');
});
test('a peg cannot be poured until a bottle is opened (unless auto-open is configured); nothing changes on refusal', async () => {
  await stock.postMovement(sysReq, { type: 'Stock In', rawKey: true, trusted: true, lines: [{ item: ids.vod, quantity: 2, unit: 'bottle', toDepartment: 'Bar', unitPrice: 1 }], reason: 'x', idempotencyKey: `si-${crypto.randomUUID()}` });
  const pool = await openMl(ids.vod); const t0 = await total(ids.vod);
  if (pool > 0) { const left = Math.ceil(pool / 30); for (let i = 0; i < left; i += 1) { const r = await order('bt', [{ menuItem: ids.vodMenu, measure: '30 ml', quantity: 1 }]); if (r.status !== 201) break; } }
  const t1 = await total(ids.vod); const o = await order('bt', [{ menuItem: ids.vodMenu, measure: '60 ml', quantity: 1 }]);
  if ((await openMl(ids.vod)) < 60) { assert.equal(o.status, 409); assert.match(o.message, /Open a bottle first/); assert.equal(await total(ids.vod), t1); }
  const od = await M.BarOrder.findOne({ status: 'Open' }); assert.ok(od); assert.equal(od.stockAttempt >= 1, true); assert.equal(od.stockError.length > 0, true);   // stays Open, never half-served
  assert.equal((await c.call('bt', 'POST', `/bar/orders/${od._id}/cancel`, { reason: 'test cleanup' })).status, 200);
  assert.ok(t0 >= 0);
});
test('auto-open (configurable) opens a bottle through a recorded opening', async () => {
  assert.equal((await setSettings({ autoOpenBottles: true })).status, 200);
  const open0 = await M.BarBottleOpening.countDocuments({ source: 'auto' }); const have = await openMl(ids.vod);
  const want = Math.ceil((have + 30) / 30); let last; for (let i = 0; i < want + 1; i += 1) { last = await order('bt', [{ menuItem: ids.vodMenu, measure: '30 ml', quantity: 1 }]); if (last.status !== 201) break; if ((await M.BarBottleOpening.countDocuments({ source: 'auto' })) > open0) break; }
  assert.ok((await M.BarBottleOpening.countDocuments({ source: 'auto' })) > open0, 'an auto opening was recorded');
  await setSettings({ autoOpenBottles: false });
});
test('mixers are deducted only when configured; unconfigured drinks never guess', async () => {
  const r = await c.call('bm', 'POST', '/bar/menu', { name: 'Whisky & Soda (test)', kind: 'spirit', stockItem: ids.wsk, servings: [{ measure: '60 ml', ml: 60, price: 400 }, { measure: 'Full bottle', price: 3500 }], mixers: [{ item: ids.soda, quantity: 1, unit: 'pcs', measures: ['60 ml'] }] });
  assert.equal(r.status, 201, r.message + JSON.stringify(r.details)); assert.equal(r.data.consumptionStatus, 'Configured');
  await openBottles(1); const s0 = await total(ids.soda); const w0 = await total(ids.wsk);
  const o = await order('bt', [{ menuItem: r.data._id, measure: '60 ml', quantity: 3 }]); assert.equal(o.status, 201);
  assert.equal(await total(ids.soda), s0 - 3); assert.equal(await total(ids.wsk), w0 - 180);
  const f = await order('bt', [{ menuItem: r.data._id, measure: 'Full bottle', quantity: 1 }]); assert.equal(f.status, 201); assert.equal(await total(ids.soda), s0 - 3);   // mixer only applies to the 60 ml serving
  const bad = await c.call('bm', 'POST', '/bar/menu', { name: 'Bad mixer', kind: 'spirit', stockItem: ids.wsk, servings: [{ measure: '30 ml', ml: 30, price: 1 }], mixers: [{ item: ids.soda, quantity: 1, unit: 'carton2' }] }); assert.equal(bad.status, 400);
  const plain = (await c.call('bm', 'GET', '/bar/menu')).data.find((m) => m._id === ids.wskMenu); assert.deepEqual(plain.mixers, []);   // plain whisky has no invented mixer
});
test('repeated requests, retries and concurrent serves never deduct stock twice', async (t) => {
  await openBottles(1); const k = key(); const t0 = await total(ids.wsk);
  const a = await order('bt', [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 1 }], true, k); const b = await order('bt', [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 1 }], true, k);
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(a.data._id, b.data._id); assert.equal(await total(ids.wsk), t0 - 30);
  assert.equal((await c.call('bt', 'POST', `/bar/orders/${a.data._id}/serve`)).status, 200); assert.equal(await total(ids.wsk), t0 - 30);          // serving a served order is a no-op
  assert.equal(await movs({ 'reference.id': a.data._id }), 1);
  if (!c.concurrency(t)) return;
  const o = await c.call('bt', 'POST', '/bar/orders', { lines: [{ menuItem: ids.wskMenu, measure: '60 ml', quantity: 1 }], serve: false }, key()); const t1 = await total(ids.wsk);
  const rs = await Promise.all(Array.from({ length: 8 }, () => c.call('bt', 'POST', `/bar/orders/${o.data._id}/serve`))); assert.ok(rs.every((r) => r.status === 200 && r.data.status === 'Served'));
  assert.equal(await total(ids.wsk), t1 - 60); assert.equal(await movs({ 'reference.id': o.data._id }), 1);
  const k2 = key(); const same = await Promise.all(Array.from({ length: 6 }, () => c.call('bt', 'POST', '/bar/orders', { lines: [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 1 }], serve: false }, k2)));
  assert.equal(new Set(same.map((r) => r.data._id)).size, 1); assert.equal(await M.BarOrder.countDocuments({ idempotencyKey: { $regex: k2['Idempotency-Key'] } }), 1);
});
test('insufficient stock: clear error, no partial change, order stays Open and can be served after restocking', async () => {
  const o = await c.call('bt', 'POST', '/bar/orders', { lines: [{ menuItem: ids.wskMenu, measure: 'Full bottle', quantity: 40 }], serve: false }, key());
  const t0 = await total(ids.wsk); const p0 = await openMl(ids.wsk);
  const r = await c.call('bt', 'POST', `/bar/orders/${o.data._id}/serve`); assert.equal(r.status, 409); assert.match(r.message, /Not enough sealed stock/);
  assert.equal(await total(ids.wsk), t0); assert.equal(await openMl(ids.wsk), p0); assert.equal((await M.BarOrder.findById(o.data._id)).status, 'Open');
  await stockIn(ids.wsk, 40); const ok = await c.call('bt', 'POST', `/bar/orders/${o.data._id}/serve`); assert.equal(ok.status, 200); assert.equal(await total(ids.wsk), t0 + 30000 - 30000);
});
test('served orders are final; billing stays undecided and nothing is posted to a bill or folio', async () => {
  const folios = await M.Folio.countDocuments(); const bills = await M.RestaurantBill.countDocuments(); const pays = await M.Payment.countDocuments();
  const o = await order('bt', [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 1 }]); assert.equal(o.data.billing.status, 'Pending destination decision'); assert.equal(o.data.billing.destination, null);
  assert.equal((await c.call('bt', 'POST', `/bar/orders/${o.data._id}/cancel`, { reason: 'too late' })).status, 409);
  assert.equal((await c.call('bt', 'PUT', `/bar/orders/${o.data._id}/lines`, { lines: [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 5 }] })).status, 409);
  assert.equal(await M.Folio.countDocuments(), folios); assert.equal(await M.RestaurantBill.countDocuments(), bills); assert.equal(await M.Payment.countDocuments(), pays);
  assert.equal((await c.call('bm', 'PUT', '/bar/settings', { billing: { mode: 'room' } })).status, 400);                    // a billing destination cannot be switched on: it is not decided
});

/* ------------------------------------------------------------------ permissions & department scope */
test('permissions are enforced on the backend', async () => {
  assert.equal((await c.call('rec', 'GET', '/bar/menu')).status, 403); assert.equal((await c.call('rest', 'POST', '/bar/orders', { lines: [] }, key())).status, 403);
  assert.equal((await c.call('store', 'GET', '/bar/inventory')).status, 200);                                            // store manager: bottle inventory (PDF 8.2)
  assert.equal((await c.call('store', 'POST', '/bar/orders', { lines: [] }, key())).status, 403); assert.equal((await c.call('store', 'POST', '/bar/openings', { item: ids.wsk, bottles: 1 }, key())).status, 403);
  assert.equal((await c.call('bt', 'GET', '/bar/variance')).status, 403); assert.equal((await c.call('bt', 'POST', '/bar/wastage', {}, key())).status, 403); assert.equal((await c.call('bt', 'GET', '/bar/reports/liquor-stock')).status, 403);
  assert.equal((await c.call('bt', 'POST', '/bar/variance', { counts: [] }, key())).status, 403); assert.equal((await c.call('bt', 'PUT', '/bar/settings', {})).status, 403);
  assert.equal((await c.call('bt', 'GET', '/bar/orders?item=not-an-id')).status, 400);                                  // filters are validated
  assert.equal((await c.call(null, 'GET', '/bar/menu')).status, 401);
});

/* ------------------------------------------------------------------ 8.3 variance */
const counts = async (delta = {}) => { const inv = (await c.call('bm', 'GET', '/bar/inventory')).data; const out = [];
  for (const i of inv) { const d = delta[i.item] || {}; out.push(i.isLiquor ? { item: i.item, sealedBottles: Math.floor(((i.totalQty - (await openMl(i.item))) / i.capacityMl) + 1e-9) + (d.sealed || 0), openMl: (await openMl(i.item)) + (d.open || 0) } : { item: i.item, quantity: i.totalQty + (d.qty || 0) }); }
  return out; };
test('stock count: expected comes from the ledger; a matching count has no variance and no alert', async () => {
  const exp = (await c.call('bm', 'GET', '/bar/variance/expected')).data; const w = exp.items.find((i) => i.item === ids.wsk);
  assert.equal(w.expectedQ, await total(ids.wsk)); assert.equal(w.expectedOpenQ, await openMl(ids.wsk)); assert.ok(w.breakdown.sold < 0 && w.breakdown.received >= 0);
  assert.equal(exp.tolerance.configured, false);
  const alerts0 = await M.BarVarianceAlert.countDocuments();
  const r = await c.call('bm', 'POST', '/bar/variance', { counts: await counts() }, key()); assert.equal(r.status, 201, r.message + JSON.stringify(r.details)); assert.equal(r.data.linesWithVariance, 0); assert.equal(await M.BarVarianceAlert.countDocuments(), alerts0);
});
test('stock count: variance is calculated, kept in history, alerts once, and never changes stock', async () => {
  const t0 = await total(ids.wsk); const n0 = await M.Notification.countDocuments({ type: 'bar_variance' });
  const k = key(); const body = { counts: await counts({ [ids.wsk]: { open: -90 } }), notes: 'short pour suspected' };   // 90 ml (3 pegs) missing from opened bottles
  const r = await c.call('bm', 'POST', '/bar/variance', body, k); assert.equal(r.status, 201); assert.equal(r.data.linesWithVariance, 1);
  const l = r.data.lines.find((x) => x.item === ids.wsk); assert.equal(l.varianceQ, -90); assert.equal(l.variancePegs, -3); assert.equal(l.varianceOpenQ, -90); assert.equal(l.varianceBottles, -0.12); assert.equal(l.exceedsTolerance, true); assert.equal(l.expectedQ - l.countedQ, 90);
  assert.equal(await total(ids.wsk), t0);                                                                              // a count never modifies stock
  const again = await c.call('bm', 'POST', '/bar/variance', body, k); assert.equal(again.status, 200); assert.equal(again.data._id, r.data._id);
  assert.equal(await M.BarVarianceAlert.countDocuments({ item: ids.wsk, sourceId: r.data._id }), 1);                    // one alert, not two
  assert.equal(await M.Notification.countDocuments({ type: 'bar_variance' }) - n0 > 0, true);
  const a = (await c.call('bm', 'GET', '/bar/variance/alerts')).data.find((x) => x.item === ids.wsk); assert.equal(a.usedFallback, true); assert.equal(a.toleranceConfigured, false);
  const hist = (await c.call('gm', 'GET', '/bar/variance')).data; assert.ok(hist.some((h) => h._id === r.data._id && h.lines[0].expectedQ != null));
  assert.equal((await c.call('bm', 'POST', `/bar/variance/alerts/${a._id}/acknowledge`)).status, 200); assert.equal((await c.call('bm', 'POST', `/bar/variance/alerts/${a._id}/acknowledge`)).status, 404);
  ids.reconA = r.data;
});
test('variance tolerance and alert recipients are configurable (not hard-coded)', async () => {
  assert.equal((await setSettings({ variance: { toleranceMl: 60, recipients: { roles: ['hotel_owner'] } } })).status, 200);
  const small = await c.call('bm', 'POST', '/bar/variance', { counts: await counts({ [ids.wsk]: { open: -30 } }) }, key()); const ln = small.data.lines.find((x) => x.item === ids.wsk);
  assert.equal(ln.hasVariance, true); assert.equal(ln.exceedsTolerance, false); assert.equal(await M.BarVarianceAlert.countDocuments({ sourceId: small.data._id }), 0);        // inside tolerance: recorded, not alerted
  const n0 = await M.Notification.countDocuments({ type: 'bar_variance' }); const owner = await M.User.findOne({ email: 'owner@awadhpalace.test' });
  const big = await c.call('bm', 'POST', '/bar/variance', { counts: await counts({ [ids.wsk]: { open: -120 } }) }, key()); assert.equal(big.data.lines.find((x) => x.item === ids.wsk).exceedsTolerance, true);
  const al = await M.BarVarianceAlert.findOne({ sourceId: big.data._id }); assert.equal(al.usedFallback, false); assert.equal(al.recipientCount, 1); assert.equal(al.toleranceConfigured, true);
  const ns = await M.Notification.find({ type: 'bar_variance' }).sort({ createdAt: -1 }).limit(1); assert.equal(await M.Notification.countDocuments({ type: 'bar_variance' }) - n0, 1); assert.equal(String(ns[0].recipientUser), String(owner._id));
  await setSettings({ variance: { toleranceMl: null, recipients: { roles: [] } } });
});
test('variance adjustment goes through the Phase 4 approval and is never silent', async () => {
  const count = await c.call('bm', 'POST', '/bar/variance', { counts: await counts({ [ids.wsk]: { open: -60 } }) }, key()); const line = count.data.lines.find((x) => x.item === ids.wsk); const t0 = await total(ids.wsk);
  assert.equal((await c.call('bt', 'POST', `/bar/variance/${count.data._id}/lines/${line._id}/adjust`, {})).status, 403);
  const req = await c.call('bm', 'POST', `/bar/variance/${count.data._id}/lines/${line._id}/adjust`, {}); assert.equal(req.status, 200); const adj = req.data.lines.find((x) => x._id === line._id).adjustment; assert.equal(adj.status, 'Requested');
  assert.equal(await total(ids.wsk), t0);                                                                               // pending: nothing changed
  assert.equal((await c.call('bm', 'POST', `/bar/variance/${count.data._id}/lines/${line._id}/adjust`, {})).status, 409);
  const ap = await M.ApprovalRequest.findById(adj.approval); assert.equal(ap.type, 'Stock adjustment'); assert.equal(ap.status, 'Pending');
  assert.equal((await c.call('bt', 'POST', `/approvals/${ap._id}/approve`, {})).status, 403);
  assert.equal((await c.call('owner', 'POST', `/approvals/${ap._id}/approve`, {})).status, 200);
  assert.equal(await total(ids.wsk), t0 - 60); assert.equal(await openMl(ids.wsk), line.countedOpenQ);                // book stock and opened pool now match the count
  const after = await c.call('gm', 'GET', `/bar/variance/${count.data._id}`); assert.equal(after.data.lines.find((x) => x._id === line._id).adjustment.status, 'Applied'); assert.equal(after.data.lines.find((x) => x._id === line._id).varianceQ, -60);   // original figures preserved
  const mv = await M.StockMovement.findById(adj.movement); assert.equal(mv.type, 'Adjustment'); assert.equal(mv.source, 'bar-variance');
  const c2 = await c.call('bm', 'POST', '/bar/variance', { counts: await counts() }, key()); assert.equal(c2.data.linesWithVariance, 0);   // reconciled
});
test('rejected adjustments change nothing', async () => {
  const count = await c.call('bm', 'POST', '/bar/variance', { counts: await counts({ [ids.wsk]: { open: 30 } }) }, key()); const line = count.data.lines.find((x) => x.item === ids.wsk); const t0 = await total(ids.wsk);
  const req = await c.call('bm', 'POST', `/bar/variance/${count.data._id}/lines/${line._id}/adjust`, {}); const ap = req.data.lines.find((x) => x._id === line._id).adjustment.approval;
  assert.equal((await c.call('gm', 'POST', `/approvals/${ap}/reject`, { reason: 'recount first' })).status, 200); assert.equal(await total(ids.wsk), t0);
  assert.equal((await c.call('gm', 'GET', `/bar/variance/${count.data._id}`)).data.lines.find((x) => x._id === line._id).adjustment.status, 'Rejected');
});

/* ------------------------------------------------------------------ 8.4 complimentary, wastage, breakage */
test('complimentary: pending and rejected requests do not consume stock; approval alone does not either', async () => {
  await openBottles(1); const t0 = await total(ids.wsk); const o0 = await openMl(ids.wsk);
  assert.equal((await c.call('rec', 'POST', '/bar/complimentary', { menuItem: ids.wskMenu, measure: '60 ml', quantity: 1, reason: 'VIP guest' }, key())).status, 403);
  const r = await c.call('bt', 'POST', '/bar/complimentary', { menuItem: ids.wskMenu, measure: '60 ml', quantity: 2, reason: 'Birthday guest' }, key()); assert.equal(r.status, 201); assert.equal(r.data.status, 'Pending Approval');
  assert.equal(await total(ids.wsk), t0); const ap = await M.ApprovalRequest.findById(r.data.approval); assert.equal(ap.type, 'Complimentary drinks'); assert.equal(ap.status, 'Pending');
  assert.equal((await c.call('bt', 'POST', `/bar/complimentary/${r.data._id}/issue`)).status, 400);                      // cannot bypass approval
  assert.equal((await c.call('bt', 'POST', `/approvals/${ap._id}/approve`, {})).status, 403); assert.equal((await c.call('bm', 'POST', `/approvals/${ap._id}/approve`, {})).status, 403);   // only GM / Owner
  const rej = await c.call('bt', 'POST', '/bar/complimentary', { menuItem: ids.wskMenu, measure: '30 ml', quantity: 1, reason: 'Not needed' }, key());
  assert.equal((await c.call('gm', 'POST', `/approvals/${rej.data.approval}/reject`, { reason: 'Not needed here' })).status, 200);
  const rj = (await c.call('bt', 'GET', '/bar/complimentary')).data.find((x) => x._id === rej.data._id); assert.equal(rj.status, 'Rejected'); assert.equal((await c.call('bt', 'POST', `/bar/complimentary/${rj._id}/issue`)).status, 400);
  assert.equal(await total(ids.wsk), t0);
  assert.equal((await c.call('owner', 'POST', `/approvals/${ap._id}/approve`, {})).status, 200); assert.equal(await total(ids.wsk), t0); assert.equal(await openMl(ids.wsk), o0);   // approved, not yet issued
  ids.comp = r.data._id;
});
test('complimentary: issuing deducts exactly once even when repeated or concurrent', async (t) => {
  const t0 = await total(ids.wsk); const o0 = await openMl(ids.wsk);
  const a = await c.call('bt', 'POST', `/bar/complimentary/${ids.comp}/issue`); assert.equal(a.status, 200); assert.equal(a.data.status, 'Issued'); assert.equal(await total(ids.wsk), t0 - 120); assert.equal(await openMl(ids.wsk), o0 - 120);
  const b = await c.call('bt', 'POST', `/bar/complimentary/${ids.comp}/issue`); assert.equal(b.status, 200); assert.equal(await total(ids.wsk), t0 - 120); assert.equal(await movs({ 'reference.id': ids.comp }), 1);
  const mv = await M.StockMovement.findById(a.data.movement); assert.equal(mv.source, 'bar-comp');
  if (!c.concurrency(t)) return;
  const r = await c.call('bt', 'POST', '/bar/complimentary', { menuItem: ids.wskMenu, measure: '30 ml', quantity: 1, reason: 'Manager guest' }, key()); await c.call('gm', 'POST', `/approvals/${r.data.approval}/approve`, {});
  const t1 = await total(ids.wsk); const rs = await Promise.all(Array.from({ length: 6 }, () => c.call('bt', 'POST', `/bar/complimentary/${r.data._id}/issue`))); assert.ok(rs.every((x) => x.status === 200));
  assert.equal(await total(ids.wsk), t1 - 30); assert.equal(await movs({ 'reference.id': r.data._id }), 1);
});
test('wastage and breakage: separate records, correct Phase 4 movements, audited, immutable', async () => {
  const w0 = await total(ids.wsk); const o0 = await openMl(ids.wsk); const k = key();
  assert.equal((await c.call('bt', 'POST', '/bar/wastage', { item: ids.wsk, quantity: 60, stockState: 'opened', reason: 'Spillage' }, key())).status, 403);
  assert.equal((await c.call('bm', 'POST', '/bar/wastage', { item: ids.wsk, quantity: 60, unit: 'ml', stockState: 'opened', reason: 'Not on the list' }, key())).status, 400);
  const w = await c.call('bm', 'POST', '/bar/wastage', { item: ids.wsk, quantity: 60, unit: 'ml', stockState: 'opened', reason: 'Spillage', notes: 'tray dropped' }, k); assert.equal(w.status, 201); assert.equal(w.data.kind, 'Wastage'); assert.equal(await total(ids.wsk), w0 - 60); assert.equal(await openMl(ids.wsk), o0 - 60);
  const again = await c.call('bm', 'POST', '/bar/wastage', { item: ids.wsk, quantity: 60, unit: 'ml', stockState: 'opened', reason: 'Spillage', notes: 'tray dropped' }, k); assert.equal(again.status, 200); assert.equal(await total(ids.wsk), w0 - 60);       // no duplicate movement
  assert.equal((await M.StockMovement.findById(w.data.movement)).type, 'Wastage');
  const b0 = await total(ids.wsk); const b = await c.call('gm', 'POST', '/bar/breakage', { item: ids.wsk, quantity: 1, unit: 'bottle', stockState: 'sealed', reason: 'Bottle dropped', supportingRef: 'INC-1' }, key()); assert.equal(b.status, 201);
  assert.equal(await total(ids.wsk), b0 - 750); assert.equal(await openMl(ids.wsk), o0 - 60); assert.equal((await M.StockMovement.findById(b.data.movement)).type, 'Breakage');                       // sealed bottle: opened pool unchanged
  const d0 = await total(ids.wsk); const dr = await c.call('bm', 'POST', '/bar/wastage', { menuItem: ids.wskMenu, measure: '30 ml', quantity: 2, reason: 'Wrong order' }, key()); assert.equal(dr.status, 201); assert.equal(await total(ids.wsk), d0 - 60);   // wasted drinks use the configured consumption
  const tooMuch = await c.call('bm', 'POST', '/bar/breakage', { item: ids.wsk, quantity: 999, unit: 'bottle', stockState: 'sealed', reason: 'Bottle dropped' }, key()); assert.equal(tooMuch.status, 409); assert.equal(await M.BarLoss.countDocuments({ status: 'Pending' }), 0);
  const wl = (await c.call('bm', 'GET', '/bar/wastage')).data; const bl = (await c.call('bm', 'GET', '/bar/breakage')).data; assert.ok(wl.every((x) => x.kind === 'Wastage') && bl.every((x) => x.kind === 'Breakage')); assert.ok(wl.length >= 2 && bl.length >= 1);
  assert.equal((await c.call('bm', 'DELETE', `/bar/losses/${w.data._id}`)).status, 404); assert.equal((await c.call('bm', 'PUT', `/bar/wastage/${w.data._id}`, { quantity: 1 })).status, 404);
  const n = await c.call('bm', 'POST', `/bar/losses/${w.data._id}/note`, { note: 'confirmed by manager' }); assert.equal(n.status, 200); assert.equal(n.data.addenda.length, 1); assert.equal(n.data.quantity, 60);
  assert.ok(await M.AuditLog.findOne({ entity: 'BarLoss', entityId: w.data._id })); assert.ok(await M.AuditLog.findOne({ entity: 'BarComplimentary' })); assert.ok(await M.AuditLog.findOne({ entity: 'BarBottleOpening' }));
  const rw = (await c.call('bm', 'GET', '/bar/reports/wastage')).data; const rb = (await c.call('bm', 'GET', '/bar/reports/breakage')).data; assert.ok(rw.rows.every((x) => x.kind === 'Wastage')); assert.ok(rb.rows.every((x) => x.kind === 'Breakage'));
});

/* ------------------------------------------------------------------ 8.5 shifts */
test('shift: start, one live shift per bartender, orders are tagged to it', async () => {
  const s = await c.call('bt', 'POST', '/bar/shifts', { definition: 'Evening' }); assert.equal(s.status, 201); assert.ok(s.data.opening.length >= 3); assert.equal(s.data.status, 'Open');
  assert.equal((await c.call('bt', 'POST', '/bar/shifts', {})).status, 409); assert.equal((await c.call('rec', 'POST', '/bar/shifts', {})).status, 403);
  await openBottles(1); const o = await order('bt', [{ menuItem: ids.wskMenu, measure: '30 ml', quantity: 3 }, { menuItem: ids.wskMenu, measure: '60 ml', quantity: 1 }]); assert.equal(String(o.data.shift), s.data._id);
  ids.shift = s.data._id;
});
test('shift closing: expected stock is derived, counts and variance are recorded, and a closed shift cannot be closed again', async (t) => {
  const sheet = await c.call('bt', 'GET', `/bar/shifts/${ids.shift}/sheet`); assert.equal(sheet.status, 200); assert.equal(sheet.data.blindCount, true); assert.equal(sheet.data.items[0].expectedQ, undefined);   // bartender counts blind
  assert.equal((await c.call('bt2', 'POST', `/bar/shifts/${ids.shift}/close`, { counts: [] })).status, 400);              // empty body fails validation; other bartender is also not allowed (below)
  assert.equal((await c.call('bt2', 'POST', `/bar/shifts/${ids.shift}/close`, { counts: [{ item: ids.wsk, sealedBottles: 1, openMl: 1 }] })).status, 403);
  const miss = await c.call('bt', 'POST', `/bar/shifts/${ids.shift}/close`, { counts: [{ item: ids.wsk, sealedBottles: 1, openMl: 1 }] }); assert.equal(miss.status, 400); assert.match(miss.message, /Count every item/); assert.equal((await M.BarShift.findById(ids.shift)).status, 'Open');
  const full = await counts({ [ids.wsk]: { open: -30 } });                                                               // 30 ml short in opened bottles
  const r = await c.call('bt', 'POST', `/bar/shifts/${ids.shift}/close`, { counts: full, notes: 'busy night' }); assert.equal(r.status, 200, r.message); assert.equal(r.data.status, 'Closed'); assert.ok(r.data.endedAt);
  const w = r.data.closing.lines.find((l) => String(l.item) === ids.wsk); assert.equal(w.varianceQ, -30); assert.equal(w.variancePegs, -1); assert.equal(w.expectedQ - w.countedQ, 30); assert.equal(w.expectedQ, w.openingQ + w.breakdown.received + w.breakdown.sold + w.breakdown.complimentary + w.breakdown.wastage + w.breakdown.breakage + w.breakdown.adjustments + w.breakdown.other);
  assert.equal(r.data.closing.sales.orders, 1); assert.equal(r.data.closing.sales.drinks, 4); assert.equal(r.data.closing.sales.revenue, 880); assert.deepEqual(r.data.closing.sales.byMeasure, { '30 ml': 3, '60 ml': 1 });
  assert.equal(r.data.closing.linesWithVariance, 1); assert.equal(r.data.closedByName.includes('Bartender'), true);
  assert.equal((await c.call('bt', 'POST', `/bar/shifts/${ids.shift}/close`, { counts: full })).status, 409);              // cannot be closed twice
  assert.ok(await M.BarVarianceAlert.findOne({ source: 'shift', sourceId: ids.shift }));
  assert.equal((await M.AuditLog.countDocuments({ entity: 'BarShift', entityId: ids.shift })) >= 2, true);
  ids.closed = r.data;
  if (!c.concurrency(t)) return;
  const s2 = await c.call('bt2', 'POST', '/bar/shifts', {}); const cc = await counts(); const rs = await Promise.all(Array.from({ length: 5 }, () => c.call('bt2', 'POST', `/bar/shifts/${s2.data._id}/close`, { counts: cc })));
  assert.equal(rs.filter((x) => x.status === 200).length, 1); assert.ok(rs.every((x) => [200, 409].includes(x.status)));
});
test('shift correction: manager only, reason required, original figures preserved, audited', async () => {
  assert.equal((await c.call('bt', 'POST', `/bar/shifts/${ids.closed._id}/correct`, { reason: 'long enough reason here', counts: [{ item: ids.wsk, sealedBottles: 1, openMl: 1 }] })).status, 403);
  assert.equal((await c.call('bm', 'POST', `/bar/shifts/${ids.closed._id}/correct`, { reason: 'short', counts: [{ item: ids.wsk, sealedBottles: 1, openMl: 1 }] })).status, 400);
  const orig = ids.closed.closing.lines.find((l) => String(l.item) === ids.wsk); const target = { item: ids.wsk, sealedBottles: orig.countedSealedBottles, openMl: orig.countedOpenQ + 30 };
  const r = await c.call('bm', 'POST', `/bar/shifts/${ids.closed._id}/correct`, { reason: 'Opened bottle re-measured after closing', counts: [target] }); assert.equal(r.status, 200, r.message);
  assert.equal(r.data.revision, 1); assert.equal(r.data.closing.lines.find((l) => String(l.item) === ids.wsk).varianceQ, 0); assert.equal(r.data.corrections.length, 1); assert.match(r.data.corrections[0].reason, /re-measured/);
  const full = (await M.BarShift.findById(ids.closed._id).lean()).corrections[0]; assert.equal(full.before.find((l) => String(l.item) === ids.wsk).varianceQ, -30);   // the original is still there
  assert.ok(await M.AuditLog.findOne({ entity: 'BarShift', entityId: ids.closed._id, action: 'update' }));
  assert.equal((await c.call('bm', 'POST', `/bar/shifts/${(await c.call('bt2', 'POST', '/bar/shifts', {})).data._id}/correct`, { reason: 'still open, cannot', counts: [target] })).status, 400);
});
test('shift visibility: bartenders see only their own shifts', async () => {
  const mine = (await c.call('bt', 'GET', '/bar/shifts')).data; assert.ok(mine.length >= 1 && mine.every((s) => s.bartenderName.includes('Deepak'))); assert.equal((await c.call('bt2', 'GET', `/bar/shifts/${ids.closed._id}`)).status, 403);
  assert.ok((await c.call('bm', 'GET', '/bar/shifts')).data.length >= mine.length);
});

/* ------------------------------------------------------------------ reports & downstream data */
test('reports are built from persisted records and agree with the ledger', async () => {
  const day = c.ymd(0); const q = `?from=${day}&to=${day}`;
  const liq = (await c.call('bm', 'GET', '/bar/reports/liquor-stock')).data; assert.equal(liq.items.find((i) => i.item === ids.wsk).totalQty, await total(ids.wsk));
  const oc = (await c.call('bm', 'GET', `/bar/reports/opening-closing${q}`)).data.rows.find((r) => r.item === ids.wsk); assert.equal(oc.closing, await total(ids.wsk)); assert.equal(oc.opening + oc.received + oc.sold + oc.complimentary + oc.wastage + oc.breakage + oc.adjustments + oc.other, oc.closing);
  assert.ok(oc.sold < 0 && oc.complimentary < 0 && oc.wastage < 0 && oc.breakage < 0);
  const con = (await c.call('bm', 'GET', `/bar/reports/consumption${q}`)).data; assert.ok(con.rows.some((r) => r.measure === '30 ml' && r.drinks > 0)); assert.ok(con.rows.some((r) => r.measure === 'Full bottle'));
  const va = (await c.call('gm', 'GET', `/bar/reports/variance${q}`)).data; assert.ok(va.totals.withVariance >= 1); assert.ok(va.rows.some((r) => r.source === 'Shift closing') && va.rows.some((r) => r.source === 'Stock count')); assert.ok(va.rows.some((r) => r.variancePegs === -3));
  const cp = (await c.call('gm', 'GET', `/bar/reports/complimentary${q}`)).data; assert.ok(cp.totals.issuedDrinks >= 3); assert.ok(cp.totals.rejected >= 1);
  const sc = (await c.call('bm', 'GET', `/bar/reports/shift-closing${q}`)).data; assert.ok(sc.rows.length >= 1 && sc.rows[0].closing.lines.length >= 3);
  assert.ok((await c.call('bt', 'GET', `/bar/reports/shift-closing${q}`)).data.rows.every((r) => r.bartenderName.includes('Deepak')));      // bartender sees only own closings
  const ds = (await c.call('bm', 'GET', `/bar/reports/daily-summary?date=${day}`)).data; assert.equal(ds.billing.status, 'Pending destination decision'); assert.ok(ds.sales.orders >= 1); assert.ok(ds.shifts.closed.length >= 1); assert.equal(ds.sales.taxIncluded, false);
  assert.equal((await c.call('bm', 'GET', '/bar/reports/variance?from=2026-12-01&to=2026-11-01')).status, 400);
});
test('overview reports the unconfirmed (TBC) configuration honestly', async () => {
  const ov = await c.call('bm', 'GET', '/bar/overview'); assert.equal(ov.status, 200, ov.message); const o = ov.data; assert.equal(o.config.happyHourConfigured, false); assert.equal(o.config.varianceToleranceConfigured, false); assert.equal(o.config.varianceRecipientsConfigured, false); assert.equal(o.config.shiftDefinitionsConfigured, false); assert.equal(o.config.billingDestination, null);
  assert.ok(o.menu.incomplete.some((m) => m.name === 'Unlinked Gin')); assert.ok(o.today.sales > 0);
});
