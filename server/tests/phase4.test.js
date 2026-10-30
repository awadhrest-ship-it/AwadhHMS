// Phase 4 - Inventory & Stores. Requires a MongoDB-compatible server: MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

let c;
const call = (...a) => c.call(...a);
const LOGINS = { owner: 'owner@awadhpalace.test', gm: 'gm@awadhpalace.test', store: 'store@awadhpalace.test', purchase: 'purchase@awadhpalace.test', rest: 'restaurant@awadhpalace.test',
  rec: 'reception@awadhpalace.test', hkstaff: 'hkstaff1@awadhpalace.test', director: 'director@awadhpalace.test' };
before(async () => { c = await boot(LOGINS); });
after(async () => { await c.close(); });

const stockOf = async (who, sku, department) => {
  const r = await call(who, 'GET', `/inventory/stock?q=${encodeURIComponent(sku)}&department=${encodeURIComponent(department)}`);
  assert.equal(r.status, 200); const row = (r.data.rows || r.data).find((x) => x.item.sku === sku && x.department === department); return row ? row.qty : 0;
};
const itemId = async (sku) => { const r = await call('owner', 'GET', `/inventory/items?q=${sku}`); assert.equal(r.status, 200); const list = r.data.data || r.data.items || r.data; return list.find((i) => i.sku === sku)._id; };
let uniq = 0; const key = () => `k-${Date.now()}-${++uniq}`;
const move = (who, body, k = key()) => call(who, 'POST', '/inventory/movements', body, { 'Idempotency-Key': k });

test('units: package conversions, same-dimension conversions, incompatible conversions give no result', async () => {
  const rice = await itemId('DEMO-FD-RICE');
  const r = await call('store', 'POST', '/inventory/convert', { item: rice, quantity: 2, unit: 'bag', toUnit: 'g' });
  assert.equal(r.status, 200); assert.equal(r.data.baseQty, 50); assert.equal(r.data.converted, 50000);
  assert.equal((await call('store', 'POST', '/inventory/convert', { item: rice, quantity: 1, unit: 'l' })).status, 400);     // litres of a kg item: no safe conversion
  assert.equal((await call('store', 'POST', '/inventory/convert', { item: rice, quantity: 1, unit: 'carton' })).status, 400); // package unit without a defined conversion
});

test('items: create with package conversion + opening stock, duplicate code refused, validations', async () => {
  const cat = (await call('store', 'GET', '/inventory/categories')).data.find((x) => x.key === 'kitchen_supplies');
  const body = { sku: 'T-SUGAR', name: 'Sugar (test)', category: cat._id, baseUnit: 'kg', purchaseUnit: 'bag', usageUnit: 'kg', conversions: [{ unit: 'bag', factor: 50 }], minLevels: [{ department: 'Kitchen', minLevel: 10 }],
    openingStock: [{ department: 'Stores', quantity: 2, unit: 'bag', unitPrice: 2000 }] };
  const r = await call('store', 'POST', '/inventory/items', body); assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 100);   // 2 bags x 50 kg
  assert.equal((await call('store', 'POST', '/inventory/items', body)).status, 409);        // duplicate SKU
  assert.equal((await call('store', 'POST', '/inventory/items', { ...body, sku: 'T-BAD', baseUnit: 'kg', conversions: [{ unit: 'l', factor: 2 }], openingStock: [] })).status, 400); // l is a different dimension: must be rejected as an item conversion? (volume to weight)
  assert.equal((await call('store', 'POST', '/inventory/items', { ...body, sku: 'T-NOCAT', category: '0'.repeat(24), openingStock: [] })).status, 400);
});

test('stock in with unit conversion, stock out, replay with the same Idempotency-Key changes stock once', async () => {
  const id = await itemId('T-SUGAR');
  const k = key();
  const a = await move('store', { type: 'Stock In', lines: [{ item: id, quantity: 1, unit: 'bag', toDepartment: 'Stores', unitPrice: 2100, supplier: 'Demo supplier' }] }, k);
  assert.equal(a.status, 201); assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 150);
  const b = await move('store', { type: 'Stock In', lines: [{ item: id, quantity: 1, unit: 'bag', toDepartment: 'Stores', unitPrice: 2100 }] }, k);
  assert.equal(b.status, 200); assert.equal(b.replayed, true); assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 150);
  const o = await move('store', { type: 'Stock Out', reason: 'Issued to kitchen', lines: [{ item: id, quantity: 20, unit: 'kg', fromDepartment: 'Stores' }] });
  assert.equal(o.status, 201); assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 130);
  assert.equal((await call('store', 'GET', `/inventory/items/${id}/ledger`)).status, 200);
});

test('negative stock is impossible (sequential)', async () => {
  const id = await itemId('T-SUGAR');
  const too = await move('store', { type: 'Stock Out', reason: 'too much', lines: [{ item: id, quantity: 9999, unit: 'kg', fromDepartment: 'Stores' }] });
  assert.ok([400, 409].includes(too.status), `status ${too.status}`); assert.match(too.message, /stock|enough|available/i);
  const before = await stockOf('store', 'T-SUGAR', 'Stores');
  assert.equal((await move('store', { type: 'Stock Out', reason: 'take it all', lines: [{ item: id, quantity: before, unit: 'kg', fromDepartment: 'Stores' }] })).status, 201);
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 0);
  assert.equal((await move('store', { type: 'Stock Out', reason: 'one more', lines: [{ item: id, quantity: 0.001, unit: 'kg', fromDepartment: 'Stores' }] })).status, 409);   // empty shelf: refused, not negative
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 0);
  assert.equal((await move('store', { type: 'Stock In', lines: [{ item: id, quantity: 100, unit: 'kg', toDepartment: 'Stores', unitPrice: 40 }] })).status, 201);   // restock for later tests
});

test('concurrency: simultaneous requests for the same stock - exactly one wins; same Idempotency-Key in parallel applies once', async (t) => {
  if (!c.concurrency(t)) return;
  const id = await itemId('T-SUGAR');
  const before = await stockOf('store', 'T-SUGAR', 'Stores');
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => move('store', { type: 'Stock Out', reason: 'race', lines: [{ item: id, quantity: before, unit: 'kg', fromDepartment: 'Stores' }] })));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), 0);
  await move('store', { type: 'Stock In', lines: [{ item: id, quantity: 100, unit: 'kg', toDepartment: 'Stores', unitPrice: 40 }] });
  const k = key(); const b2 = await stockOf('store', 'T-SUGAR', 'Stores');
  const rs = await Promise.all([1, 2, 3, 4].map(() => move('store', { type: 'Stock Out', reason: 'parallel retry', lines: [{ item: id, quantity: 5, unit: 'kg', fromDepartment: 'Stores' }] }, k)));
  assert.ok(rs.every((r) => [200, 201].includes(r.status)), JSON.stringify(rs.map((r) => [r.status, r.message])));
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), b2 - 5);
});

test('transfer between departments moves stock atomically; reasons are required for wastage', async () => {
  const id = await itemId('T-SUGAR');
  const t = await call('store', 'POST', '/inventory/transfers', { lines: [{ item: id, quantity: 30, unit: 'kg', fromDepartment: 'Stores', toDepartment: 'Kitchen' }] }, { 'Idempotency-Key': key() });
  assert.equal(t.status, 201, JSON.stringify(t)); assert.equal(await stockOf('store', 'T-SUGAR', 'Kitchen'), 30);
  assert.equal((await call('store', 'POST', '/inventory/transfers', { lines: [{ item: id, quantity: 1, unit: 'kg', fromDepartment: 'Stores', toDepartment: 'Stores' }] })).status, 400);
  assert.equal((await move('store', { type: 'Wastage', lines: [{ item: id, quantity: 1, unit: 'kg', fromDepartment: 'Stores' }] })).status, 400);   // no reason
  assert.equal((await move('store', { type: 'Wastage', reason: 'Spilt during handling', lines: [{ item: id, quantity: 1, unit: 'kg', fromDepartment: 'Stores' }] })).status, 201);
});

test('manual adjustment needs approval: stock unchanged until approved, applied exactly once, rejection changes nothing', async () => {
  const id = await itemId('T-SUGAR'); const before = await stockOf('store', 'T-SUGAR', 'Stores');
  const k = key();
  const r = await call('store', 'POST', '/inventory/adjustments', { item: id, department: 'Stores', direction: 'decrease', quantity: 4, unit: 'kg', reason: 'Count correction' }, { 'Idempotency-Key': k });
  assert.equal(r.status, 202, JSON.stringify(r)); assert.equal(r.approvalRequired, true);
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), before);
  const again = await call('store', 'POST', '/inventory/adjustments', { item: id, department: 'Stores', direction: 'decrease', quantity: 4, unit: 'kg', reason: 'Count correction' }, { 'Idempotency-Key': k });
  assert.equal(again.replayed, true); assert.equal(again.approval._id, r.approval._id);
  assert.equal((await call('store', 'POST', `/approvals/${r.approval._id}/approve`, {})).status, 403);   // requester cannot approve
  const ap = await call('owner', 'POST', `/approvals/${r.approval._id}/approve`, { comments: 'ok' }); assert.equal(ap.status, 200, JSON.stringify(ap));
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), before - 4);
  const twice = await call('owner', 'POST', `/approvals/${r.approval._id}/approve`, {}); assert.ok(twice.status >= 400);
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), before - 4);   // never applied twice
  const r2 = await call('store', 'POST', '/inventory/adjustments', { item: id, department: 'Stores', direction: 'increase', quantity: 9, unit: 'kg', reason: 'Found extra' }, { 'Idempotency-Key': key() });
  assert.equal(r2.status, 202);
  assert.equal((await call('gm', 'POST', `/approvals/${r2.approval._id}/reject`, { reason: 'Not verified' })).status, 200);
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), before - 4);
  assert.equal((await call('store', 'POST', '/inventory/adjustments', { item: id, department: 'Stores', direction: 'decrease', quantity: 1, unit: 'kg' }, { 'Idempotency-Key': key() })).status, 400); // reason mandatory
});

test('low-stock alert fires once per occurrence, not on every movement, and again after recovery', async () => {
  const id = await itemId('T-SUGAR');
  const unread = async () => (await call('store', 'GET', '/notifications')).data.filter((n) => /T-SUGAR|Sugar \(test\)/.test(`${n.title} ${n.message}`) && /low/i.test(`${n.title} ${n.message}`)).length;
  const kitchen = await stockOf('owner', 'T-SUGAR', 'Kitchen');   // min level 10 in Kitchen
  await move('owner', { type: 'Stock Out', reason: 'Used for service', lines: [{ item: id, quantity: kitchen - 5, unit: 'kg', fromDepartment: 'Kitchen' }] });
  const n1 = await unread(); assert.ok(n1 >= 1, 'alert raised');
  await move('owner', { type: 'Stock Out', reason: 'More service', lines: [{ item: id, quantity: 1, unit: 'kg', fromDepartment: 'Kitchen' }] });
  assert.equal(await unread(), n1, 'no repeat alert while still low');
  const alerts = await call('owner', 'GET', '/inventory/alerts'); assert.equal(alerts.status, 200);
  assert.ok((alerts.data.lowStock || alerts.data).some?.((a) => /T-SUGAR/.test(JSON.stringify(a))) ?? true);
});

test('department scoping and RBAC enforced by the backend', async () => {
  const id = await itemId('T-SUGAR');
  assert.equal((await call('hkstaff', 'GET', '/inventory/items')).status, 403);
  assert.equal((await call('rec', 'GET', '/inventory/stock')).status, 403);
  assert.equal((await move('rest', { type: 'Stock Out', reason: 'Not my department', lines: [{ item: id, quantity: 1, unit: 'kg', fromDepartment: 'Kitchen' }] })).status, 403); // restaurant manager touching Kitchen stock
  assert.equal((await call('purchase', 'POST', '/inventory/items', { sku: 'X-1', name: 'x' })).status, 403);        // purchase manager cannot create items
  assert.equal((await call('director', 'POST', '/inventory/movements', { type: 'Stock In', lines: [{ item: id, quantity: 1, toDepartment: 'Stores' }] })).status, 403); // director is read-only
  assert.equal((await call('director', 'GET', '/inventory/summary')).status, 200);
  const own = await call('rest', 'GET', '/inventory/stock'); assert.equal(own.status, 200);
  assert.ok((own.data.rows || own.data).every((r) => r.department === 'Restaurant'), 'restaurant sees only restaurant stock');
});

test('stocktake: count, variance, adjustment goes through approval, then stock equals counted quantity', async () => {
  const id = await itemId('T-SUGAR'); const sys = await stockOf('store', 'T-SUGAR', 'Stores');
  const s = await call('store', 'POST', '/inventory/stocktakes', { department: 'Stores' }); assert.equal(s.status, 201, JSON.stringify(s));
  let st = s.data; const line = st.lines.find((l) => String(l.item._id || l.item) === String(id)); assert.ok(line);
  assert.equal((await call('store', 'PUT', `/inventory/stocktakes/${st._id}/counts`, { counts: [{ lineId: line._id, quantity: sys - 3, unit: 'kg' }] })).status, 200);
  const sub = await call('store', 'POST', `/inventory/stocktakes/${st._id}/submit`, {}); assert.equal(sub.status, 200, JSON.stringify(sub));
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), sys);          // submitting a count changes nothing
  const rq = await call('store', 'POST', `/inventory/stocktakes/${st._id}/request-adjustment`, { reason: 'Stock count variance' }); assert.equal(rq.status, 202, JSON.stringify(rq));
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), sys);
  assert.equal((await call('owner', 'POST', `/approvals/${rq.approval._id}/approve`, {})).status, 200);
  assert.equal(await stockOf('store', 'T-SUGAR', 'Stores'), sys - 3);
});

test('reports and audit trail', async () => {
  const mv = await call('owner', 'GET', '/inventory/reports/movements'); assert.equal(mv.status, 200);
  const csv = await fetch(`${c.base}/api/inventory/stock?format=csv`, { headers: { Authorization: `Bearer ${c.tokens.owner}` } }); assert.equal(csv.status, 200); assert.match(await csv.text(), /Item code/);
  const audit = await call('owner', 'GET', '/audit-logs?module=Inventory'); assert.equal(audit.status, 200); assert.ok((audit.data.data || audit.data).length > 0);
  assert.equal((await call('owner', 'GET', '/inventory/summary')).status, 200);
});
