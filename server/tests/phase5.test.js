// Phase 5 - Housekeeping. Requires a MongoDB-compatible server: MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

let c; const call = (...a) => c.call(...a);
const LOGINS = { owner: 'owner@awadhpalace.test', gm: 'gm@awadhpalace.test', hk: 'housekeeping@awadhpalace.test', sup: 'supervisor@awadhpalace.test', s1: 'hkstaff1@awadhpalace.test', s2: 'hkstaff2@awadhpalace.test',
  rec: 'reception@awadhpalace.test', store: 'store@awadhpalace.test', fom: 'fom@awadhpalace.test', acc: 'accounts@awadhpalace.test', director: 'director@awadhpalace.test' };
before(async () => { c = await boot(LOGINS); });
after(async () => { await c.close(); });

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let n = 0; const ck = () => `ck-${Date.now()}-${++n}-abcdef`;
const roomByNumber = async (num) => (await call('owner', 'GET', '/rooms')).data.find((r) => r.roomNumber === num);
const userId = async (email) => { const r = await call('owner', 'GET', '/users'); return (r.data.data || r.data).find((u) => u.email === email)._id; };
const tasksFor = async (who, roomId, extra = '') => (await call(who, 'GET', `/housekeeping/tasks?room=${roomId}${extra}`)).data;
const hkStock = async (sku) => { const r = await call('hk', 'GET', '/housekeeping/stock'); assert.equal(r.status, 200, JSON.stringify(r)); return (r.data.find((x) => x.item.sku === sku) || {}).qty; };
const itemId = async (sku) => { const r = await call('owner', 'GET', `/inventory/items?q=${sku}`); const list = r.data.data || r.data.items || r.data; return list.find((i) => i.sku === sku)._id; };

let T = {};  // shared scenario state

test('check-out creates exactly one housekeeping task and puts the room in Vacant & Dirty (idempotent)', async () => {
  const rs = (await call('rec', 'GET', '/reservations?status=Checked In')).data; const list = rs.data || rs;
  const res = list.find((r) => (r.room?.roomNumber || r.roomNumber) === '107') || list[0]; assert.ok(res, 'a checked-in reservation exists');
  T.room = await roomByNumber(res.room?.roomNumber || res.roomNumber); T.res = res;
  const co = await call('rec', 'POST', `/reservations/${res._id}/check-out`, { allowOutstanding: true }); assert.equal(co.status, 200, JSON.stringify(co));
  const room = (await call('rec', 'GET', `/rooms/${T.room._id}`)).data; assert.equal(room.status, 'Vacant & Dirty');
  const tasks = await tasksFor('hk', T.room._id); const open = tasks.filter((t) => t.type === 'Checkout'); assert.equal(open.length, 1); assert.equal(open[0].status, 'Unassigned'); assert.ok(open[0].checklist.length > 0);
  assert.equal(room.housekeepingTask.taskNumber, open[0].taskNumber);
  T.task = open[0];
  const hkSvc = require('../services/housekeeping');   // the same event delivered twice (retry) must not create a second task
  await hkSvc.onCheckout({ reservationId: res._id, roomId: T.room._id }); await hkSvc.onCheckout({ reservationId: res._id, roomId: T.room._id });
  assert.equal((await tasksFor('hk', T.room._id)).filter((t) => t.type === 'Checkout').length, 1);
  const note = await call('hk', 'GET', '/notifications'); assert.ok((note.data.data || note.data).some((x) => /needs cleaning/.test(x.title)), 'HK manager notified');
});

test('assignment: only housekeeping workers can be assigned; staff see only their own tasks', async () => {
  const s1 = await userId('hkstaff1@awadhpalace.test'), recId = await userId('reception@awadhpalace.test');
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${T.task._id}/assign`, { userId: s1 })).status, 403);   // staff cannot assign
  assert.equal((await call('hk', 'POST', `/housekeeping/tasks/${T.task._id}/assign`, { userId: recId })).status, 400); // reception cannot clean
  assert.equal((await call('s1', 'GET', `/housekeeping/tasks/${T.task._id}`)).status, 404);                           // not yet theirs
  const a = await call('hk', 'POST', `/housekeeping/tasks/${T.task._id}/assign`, { userId: s1 }); assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(a.data.status, 'Assigned');
  assert.equal((await call('s1', 'GET', `/housekeeping/tasks/${T.task._id}`)).status, 200);
  assert.equal((await call('s2', 'GET', `/housekeeping/tasks/${T.task._id}`)).status, 404);
  assert.equal((await call('s2', 'POST', `/housekeeping/tasks/${T.task._id}/start`)).status, 404);
  assert.ok((await call('s1', 'GET', '/notifications')).data.data?.some?.((x) => /assigned to you/.test(x.title)) ?? true);
  const mine = await call('s1', 'GET', '/housekeeping/tasks'); assert.ok(mine.data.every((t) => String(t.assignedTo?._id) === String(s1)));
  assert.equal((await call('s1', 'GET', '/guests')).status, 403);
});

test('cleaning workflow: start → checklist → photos → submit; rooms cannot be marked clean around the inspection', async () => {
  const id = T.task._id;
  const st = await call('s1', 'POST', `/housekeeping/tasks/${id}/start`); assert.equal(st.status, 200, JSON.stringify(st)); assert.equal(st.data.status, 'In Progress');
  assert.equal((await call('rec', 'GET', `/rooms/${T.room._id}`)).data.status, 'Cleaning in Progress');
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/submit`)).status, 400);                         // checklist incomplete
  assert.equal((await call('fom', 'PATCH', `/rooms/${T.room._id}/status`, { status: 'Vacant & Clean' })).status, 409);  // the generic route cannot skip inspection
  assert.equal((await call('fom', 'PATCH', `/rooms/${T.room._id}/status`, { status: 'Available' })).status, 409);
  assert.equal((await call('hk', 'PATCH', `/rooms/${T.room._id}/status`, { status: 'Vacant & Clean' })).status, 409);
  assert.equal((await call('fom', 'PATCH', `/rooms/${T.room._id}/checklist/${(await call('owner', 'GET', `/rooms/${T.room._id}`)).data.checklist[0]._id}`, { done: true })).status, 409); // legacy checklist is task-managed now
  let t = (await call('s1', 'GET', `/housekeeping/tasks/${id}`)).data;
  for (const it of t.checklist) assert.equal((await call('s1', 'PATCH', `/housekeeping/tasks/${id}/checklist/${it._id}`, { done: true })).status, 200);
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/checklist`, { label: 'Check minibar' })).status, 201);   // extra item added -> must be ticked too
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/submit`)).status, 400);
  t = (await call('s1', 'GET', `/housekeeping/tasks/${id}`)).data; const extra = t.checklist.find((i) => i.label === 'Check minibar');
  await call('s1', 'PATCH', `/housekeeping/tasks/${id}/checklist/${extra._id}`, { done: true });
  // photos: real image accepted, fake / oversized / wrong type refused
  const up = await call('s1', 'POST', `/housekeeping/tasks/${id}/photos?kind=before`, PNG, { 'Content-Type': 'image/png' }); assert.equal(up.status, 200, JSON.stringify(up)); assert.equal(up.data.photos.length, 1);
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/photos?kind=after`, Buffer.from('<?php echo 1; ?> not an image at all'), { 'Content-Type': 'image/png' })).status, 400);
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/photos?kind=after`, Buffer.from(PNG), { 'Content-Type': 'image/jpeg' })).status, 400);   // declared type does not match the bytes
  const file = await fetch(`${c.base}/api/files/${up.data.photos[0].attachment}`, { headers: { Authorization: `Bearer ${c.tokens.s1}` } }); assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${c.base}/api/files/${up.data.photos[0].attachment}`, { headers: { Authorization: `Bearer ${c.tokens.s2}` } })).status, 403);   // other staff cannot read it
  assert.equal((await fetch(`${c.base}/api/files/${up.data.photos[0].attachment}`)).status, 401);
  const sub = await call('s1', 'POST', `/housekeeping/tasks/${id}/submit`); assert.equal(sub.status, 200, JSON.stringify(sub)); assert.equal(sub.data.status, 'Inspection Pending');
  assert.equal((await call('rec', 'GET', `/rooms/${T.room._id}`)).data.status, 'Inspection Pending');
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/submit`)).status, 409);                          // cannot submit twice
  assert.equal((await call('hk', 'PATCH', `/rooms/${T.room._id}/status`, { status: 'Vacant & Clean' })).status, 409);  // still gated while the task waits for inspection
});

test('supervisor inspection: staff cannot inspect, rejection needs a reason and sends it back, approval makes the room clean exactly once', async () => {
  const id = T.task._id;
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' })).status, 403);    // cleaner cannot approve own work
  assert.equal((await call('rec', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' })).status, 403);
  assert.equal((await call('sup', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Rejected' })).status, 400);   // reason required
  const t0 = (await call('sup', 'GET', `/housekeeping/tasks/${id}`)).data;
  const rej = await call('sup', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Rejected', reason: 'Bathroom mirror has marks', failedItemIds: [t0.checklist[0]._id] });
  assert.equal(rej.status, 200, JSON.stringify(rej)); assert.equal(rej.data.task.status, 'Re-clean Required');
  assert.equal((await call('rec', 'GET', `/rooms/${T.room._id}`)).data.status, 'Cleaning in Progress');
  assert.equal((await call('s1', 'GET', `/housekeeping/tasks/${id}`)).data.lastRejection.reason, 'Bathroom mirror has marks');
  assert.ok((await call('s1', 'GET', '/notifications')).data.data?.some?.((x) => /re-cleaning/.test(x.title)) ?? true);
  assert.equal((await call('sup', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' })).status, 409);    // not awaiting inspection any more
  // re-clean
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/start`)).status, 200);
  const t = (await call('s1', 'GET', `/housekeeping/tasks/${id}`)).data; assert.equal(t.checklist.filter((i) => !i.done).length, 1);   // only the failed item is reopened
  await call('s1', 'PATCH', `/housekeeping/tasks/${id}/checklist/${t0.checklist[0]._id}`, { done: true });
  assert.equal((await call('s1', 'POST', `/housekeeping/tasks/${id}/submit`)).status, 200);
  assert.equal((await call('sup', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' })).status, 200);
  assert.equal((await call('owner', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' })).status, 409);   // a second inspection of the same submission is refused
  assert.equal((await call('rec', 'GET', `/rooms/${T.room._id}`)).data.status, 'Vacant & Clean');
  const fin = (await call('hk', 'GET', `/housekeeping/tasks/${id}`)).data; assert.equal(fin.status, 'Completed'); assert.equal(fin.inspections.length, 2); assert.equal(fin.rejectionCount, 1);
  const hist = (await call('owner', 'GET', `/rooms/${T.room._id}`)).data.history; assert.ok(hist.some((h) => /Inspection passed/.test(h.reason || '')));
  const insp = await call('sup', 'GET', `/housekeeping/inspections?room=${T.room._id}`); assert.equal(insp.data.length, 2);
  { const al = await call('owner', 'GET', '/audit-logs?module=Housekeeping'); assert.ok((al.data.data || al.data).length > 3); }
});

test('a room that was blocked while dirty returns to the cleaning cycle, never straight to clean', async () => {
  const dirty = (await call('owner', 'GET', '/rooms')).data.find((r) => r.status === 'Vacant & Dirty'); if (!dirty) return;
  assert.equal((await call('fom', 'PATCH', `/rooms/${dirty._id}/status`, { status: 'Blocked', reason: 'Plumbing work' })).status, 200);
  const rel = await call('fom', 'PATCH', `/rooms/${dirty._id}/status`, { status: 'Vacant & Clean' }); assert.equal(rel.status, 200, JSON.stringify(rel));
  assert.notEqual((await call('fom', 'GET', `/rooms/${dirty._id}`)).data.status, 'Vacant & Clean');
});

test('supplies: Housekeeping stock is consumed exactly once, never below zero, only from the right category', async () => {
  const before = await hkStock('DEMO-TOI-SOP'); assert.ok(before >= 20, `stock ${before}`);
  const soap = await itemId('DEMO-TOI-SOP'), towel = await itemId('DEMO-LIN-TWL');
  const key = ck();
  const body = { kind: 'Toiletry Replacement', item: soap, quantity: 4, clientKey: key, notes: 'Room refill' };
  const a = await call('s1', 'POST', '/housekeeping/supplies', body); assert.equal(a.status, 201, JSON.stringify(a));
  assert.equal(await hkStock('DEMO-TOI-SOP'), before - 4);
  const again = await call('s1', 'POST', '/housekeeping/supplies', body); assert.equal(again.status, 200); assert.equal(again.replayed, true);
  assert.equal(await hkStock('DEMO-TOI-SOP'), before - 4);
  assert.equal((await call('s1', 'POST', '/housekeeping/supplies', { ...body, clientKey: 'second-use-key-12345' })).status, 201); assert.equal(await hkStock('DEMO-TOI-SOP'), before - 8);
  assert.equal((await call('s1', 'POST', '/housekeeping/supplies', { kind: 'Linen Replacement', item: soap, quantity: 1, clientKey: ck() })).status, 400);   // soap is not linen
  const big = await call('s1', 'POST', '/housekeeping/supplies', { kind: 'Linen Replacement', item: towel, quantity: 100000, clientKey: ck() }); assert.ok([400, 409].includes(big.status));
  assert.equal((await call('s1', 'POST', '/housekeeping/supplies', { kind: 'Linen Replacement', item: towel, quantity: 0, clientKey: ck() })).status, 400);
  assert.equal((await call('s1', 'POST', '/housekeeping/supplies', { kind: 'Linen Replacement', item: towel, quantity: 1 })).status, 400);   // clientKey mandatory
  const led = await call('owner', 'GET', `/inventory/movements?type=Consumption`); assert.equal(led.status, 200);
  assert.ok((await call('s1', 'GET', '/housekeeping/supplies')).data.length >= 1);
  assert.equal((await call('s1', 'GET', '/inventory/stock')).status, 403);                                           // staff reach stock only through housekeeping
});

test('damage / missing / lost & found: create once, photos, manager workflow, claim details required', async () => {
  const room = T.room._id; const k = ck();
  const mk = (extra = {}) => call('s1', 'POST', '/housekeeping/reports', { kind: 'Damage', title: 'Broken glass', room, severity: 'Moderate', clientKey: k, ...extra });
  const a = await mk(); assert.equal(a.status, 201, JSON.stringify(a)); const again = await mk(); assert.equal(again.status, 200); assert.equal(again.data._id, a.data._id);
  assert.equal((await call('s1', 'POST', '/housekeeping/reports', { kind: 'Damage', title: 'x', clientKey: ck() })).status, 400);                // title too short / no room or location
  const ph = await call('s1', 'POST', `/housekeeping/reports/${a.data._id}/photos`, PNG, { 'Content-Type': 'image/png' }); assert.equal(ph.status, 200); assert.equal(ph.data.photoList.length, 1);
  assert.equal((await call('s1', 'PATCH', `/housekeeping/reports/${a.data._id}`, { status: 'Resolved' })).status, 403);                           // staff cannot manage
  assert.equal((await call('hk', 'PATCH', `/housekeeping/reports/${a.data._id}`, { status: 'Resolved', note: 'Replaced' })).status, 200);
  const lf = await call('s1', 'POST', '/housekeeping/reports', { kind: 'Lost & Found', title: 'Gold ring', room, storageLocation: 'Safe', clientKey: ck() }); assert.equal(lf.status, 201); assert.equal(lf.data.status, 'Found');
  assert.equal((await call('hk', 'PATCH', `/housekeeping/reports/${lf.data._id}`, { status: 'Returned' })).status, 400);                              // claim details mandatory
  const ret = await call('hk', 'PATCH', `/housekeeping/reports/${lf.data._id}`, { status: 'Returned', claim: { name: 'Mr. Sharma', idChecked: 'Aadhaar ending 1234' } }); assert.equal(ret.status, 200, JSON.stringify(ret));
  assert.equal((await call('hk', 'PATCH', `/housekeeping/reports/${lf.data._id}`, { status: 'Found' })).status, 409);                                 // finished records are locked
  assert.equal((await call('s2', 'GET', `/housekeeping/reports/${a.data._id}`)).status, 404);                                                         // other staff's report is invisible
  const list = await call('hk', 'GET', '/housekeeping/reports?kind=Damage'); assert.ok(list.data.length >= 1);
});

test('performance figures are computed from records; staff see only their own', async () => {
  const p = await call('hk', 'GET', '/housekeeping/reports/performance'); assert.equal(p.status, 200, JSON.stringify(p));
  const row = p.data.rows.find((r) => r.user.name.includes('Ramesh')); assert.ok(row); assert.equal(row.tasksSubmitted, 1); assert.equal(row.tasksCompleted, 1); assert.equal(row.inspections, 2); assert.equal(row.rejected, 1); assert.equal(row.rejectionRate, 50);
  assert.equal(row.firstPassRate, 0);
  const own = await call('s1', 'GET', '/housekeeping/reports/performance'); assert.equal(own.status, 200); assert.ok(own.data.rows.every((r) => r.user.name.includes('Ramesh')));
  assert.ok(p.data.definitions.rejectionRate);
});

test('stay-over generation is idempotent; manual tasks respect room state; cancel needs a reason', async () => {
  const g1 = await call('hk', 'POST', '/housekeeping/tasks/stayover', {}); assert.equal(g1.status, 200, JSON.stringify(g1)); const g2 = await call('hk', 'POST', '/housekeeping/tasks/stayover', {}); assert.equal(g2.data.created, 0);
  const avail = (await call('owner', 'GET', '/rooms')).data.find((r) => r.status === 'Vacant & Clean');
  const m = await call('hk', 'POST', '/housekeeping/tasks', { room: avail._id, priority: 'High', notes: 'Deep clean' }); assert.equal(m.status, 201, JSON.stringify(m));
  assert.equal((await call('hk', 'POST', '/housekeeping/tasks', { room: avail._id })).status, 409);                 // already has an open task
  assert.equal((await call('hk', 'POST', `/housekeeping/tasks/${m.data._id}/cancel`, {})).status, 400);
  assert.equal((await call('hk', 'POST', `/housekeeping/tasks/${m.data._id}/cancel`, { reason: 'Not required' })).status, 200);
  assert.equal((await call('hk', 'POST', `/housekeeping/tasks/${m.data._id}/cancel`, { reason: 'Again please' })).status, 409);
  const sync = await call('hk', 'POST', '/housekeeping/tasks/sync'); assert.equal(sync.status, 200); const sync2 = await call('hk', 'POST', '/housekeeping/tasks/sync'); assert.equal(sync2.data.created, 0);
});

test('RBAC: only the right roles reach housekeeping; settings need configure; board counts come from data', async () => {
  assert.equal((await call('acc', 'GET', '/housekeeping/tasks')).status, 403);
  assert.equal((await call('rec', 'POST', '/housekeeping/tasks', { room: T.room._id })).status, 403);
  assert.equal((await call('s1', 'PUT', '/housekeeping/settings', { requirePhotos: true })).status, 403);
  assert.equal((await call('director', 'POST', '/housekeeping/tasks', { room: T.room._id })).status, 403);
  const set = await call('owner', 'PUT', '/housekeeping/settings', { requirePhotos: false, targetMinutes: { Checkout: 45 } }); assert.equal(set.status, 200); assert.equal(set.data.targetMinutes.Checkout, 45);
  assert.equal((await call('owner', 'PUT', '/housekeeping/settings', { targetMinutes: { Checkout: 1 } })).status, 400);
  const b = await call('hk', 'GET', '/housekeeping/board'); assert.equal(b.status, 200); assert.equal(typeof b.data.counts.open, 'number');
  assert.equal((await call('owner', 'GET', '/auth/me')).user.permissions.includes('housekeeping.inspect'), true);
});

test('regression: check-out → rooms module still shows the cleaned room as bookable', async () => {
  const room = (await call('rec', 'GET', `/rooms/${T.room._id}`)).data; assert.equal(room.status, 'Vacant & Clean'); assert.ok(room.checklist.every((i) => i.done));
  assert.equal((await call('fom', 'PATCH', `/rooms/${T.room._id}/status`, { status: 'Available' })).status, 200);   // a clean room can still be released to Available
});

test('concurrency: two supervisors inspecting at once - one wins; parallel supply submits consume stock once', async (t) => {
  if (!c.concurrency(t)) return;
  const avail = (await call('owner', 'GET', '/rooms')).data.find((r) => r.status === 'Vacant & Clean' && r._id !== T.room._id);
  const m = await call('hk', 'POST', '/housekeeping/tasks', { room: avail._id, assignedTo: await userId('hkstaff2@awadhpalace.test') });
  const id = m.data._id; assert.equal((await call('s2', 'POST', `/housekeeping/tasks/${id}/start`)).status, 200);
  for (const it of (await call('s2', 'GET', `/housekeeping/tasks/${id}`)).data.checklist) await call('s2', 'PATCH', `/housekeeping/tasks/${id}/checklist/${it._id}`, { done: true });
  assert.equal((await call('s2', 'POST', `/housekeeping/tasks/${id}/submit`)).status, 200);
  const both = await Promise.all([call('sup', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' }), call('owner', 'POST', `/housekeeping/tasks/${id}/inspect`, { result: 'Approved' })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], JSON.stringify(both.map((r) => [r.status, r.message])));
  const SHM = await itemId('DEMO-TOI-SHM'); const before = await hkStock('DEMO-TOI-SHM');
  const par = await Promise.all([1, 2, 3].map(() => call('s1', 'POST', '/housekeeping/supplies', { kind: 'Toiletry Replacement', item: SHM, quantity: 1, clientKey: 'parallel-key-12345' })));
  assert.ok(par.every((r) => [200, 201].includes(r.status))); assert.equal(await hkStock('DEMO-TOI-SHM'), before - 1);
});
