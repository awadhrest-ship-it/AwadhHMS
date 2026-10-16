// End-to-end acceptance test over HTTP. Requires a reachable MongoDB: MONGO_URI=... npm test
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const seed = require('../seed/seed');
const app = require('../app');

let server, base;
const tokens = {};
const call = async (who, method, path, body) => {
  const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch {}
  return { status: r.status, ...json };
};
const login = async (who, email, password = 'Awadh@123') => { const r = await call(null, 'POST', '/auth/login', { email, password }); assert.equal(r.status, 200, `login ${who}`); tokens[who] = r.token; return r; };
const ymd = (n) => new Date(Date.now() + 5.5 * 36e5 + n * 864e5).toISOString().slice(0, 10);

before(async () => {
  process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/awadh_test';
  await seed(process.env.MONGO_URI);
  await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`;
  await login('owner', 'owner@awadhpalace.test'); await login('gm', 'gm@awadhpalace.test'); await login('fom', 'fom@awadhpalace.test');
  await login('rec', 'reception@awadhpalace.test'); await login('hk', 'housekeeping@awadhpalace.test'); await login('acc', 'accounts@awadhpalace.test');
});
after(async () => { server?.close(); await mongoose.disconnect(); });

test('auth: bad password, protected route, /me', async () => {
  assert.equal((await call(null, 'POST', '/auth/login', { email: 'owner@awadhpalace.test', password: 'nope' })).status, 401);
  assert.equal((await call(null, 'GET', '/rooms')).status, 401);
  const me = await call('rec', 'GET', '/auth/me'); assert.equal(me.user.role.key, 'receptionist');
});

test('RBAC + department restriction enforced by backend', async () => {
  assert.equal((await call('rec', 'GET', '/users')).status, 403);
  assert.equal((await call('rec', 'GET', '/audit-logs')).status, 403);
  assert.equal((await call('rec', 'POST', '/rooms', { roomNumber: '999', floor: 9, category: '0'.repeat(24) })).status, 403);
  assert.equal((await call('acc', 'GET', '/reservations')).status, 403);        // accounts has no reservations.view
  assert.equal((await call('hk', 'GET', '/guests')).status, 403);               // housekeeping dept, no guests access
  assert.equal((await call('hk', 'GET', '/rooms')).status, 200);
  assert.equal((await call('owner', 'GET', '/audit-logs')).status, 200);
});

test('users + custom role creation', async () => {
  const roles = await call('gm', 'GET', '/roles'); const rec = roles.data.find((r) => r.key === 'receptionist');
  const role = await call('gm', 'POST', '/roles', { name: 'Night Desk Assistant', permissions: ['rooms.view', 'reservations.view'], department: 'Front Office' });
  assert.equal(role.status, 201);
  const u = await call('gm', 'POST', '/users', { name: 'Test User', email: 'tester@awadhpalace.test', password: 'Password123', role: role.data._id, department: 'Front Office' });
  assert.equal(u.status, 201);
  assert.equal((await call('gm', 'POST', '/users', { name: 'Dup User', email: 'tester@awadhpalace.test', password: 'Password123', role: rec._id, department: 'Front Office' })).status, 409);
  await login('tester', 'tester@awadhpalace.test', 'Password123');
  assert.equal((await call('tester', 'GET', '/reservations')).status, 200);
  assert.equal((await call('tester', 'POST', '/reservations', {})).status, 403);
});

test('rooms: category, room, block/unblock/out-of-order need reason and are audited', async () => {
  const cat = await call('fom', 'POST', '/room-categories', { name: 'Presidential', capacity: 4, basePrice: 9000, extraBedCharge: 1200, amenities: ['Jacuzzi'] }); assert.equal(cat.status, 201);
  const room = await call('fom', 'POST', '/rooms', { roomNumber: '401', floor: 4, category: cat.data._id }); assert.equal(room.status, 201);
  assert.equal((await call('fom', 'PATCH', `/rooms/${room.data._id}/status`, { status: 'Blocked' })).status, 400);
  const blocked = await call('fom', 'PATCH', `/rooms/${room.data._id}/status`, { status: 'Blocked', reason: 'Painting' }); assert.equal(blocked.data.blocked, true);
  const av = await call('fom', 'GET', `/rooms/availability?checkIn=${ymd(10)}&checkOut=${ymd(12)}`);
  assert.ok(!av.data.some((r) => r.roomNumber === '401'), 'blocked room must not be offered');
  const un = await call('fom', 'PATCH', `/rooms/${room.data._id}/status`, { status: 'Vacant & Clean' }); assert.equal(un.data.status, 'Vacant & Clean');
  const ooo = await call('fom', 'PATCH', `/rooms/${room.data._id}/status`, { status: 'Out of Order', reason: 'Leak' }); assert.equal(ooo.data.outOfOrder, true);
  const logs = await call('gm', 'GET', `/audit-logs?entityId=${room.data._id}`); assert.ok(logs.data.length >= 4);
  const cal = await call('fom', 'GET', '/rooms/availability?days=7'); assert.equal(cal.data.dates.length, 7);
});

test('rate plans: create + quote', async () => {
  const cats = (await call('fom', 'GET', '/room-categories')).data; const deluxe = cats.find((c) => c.name === 'Deluxe');
  const plan = await call('fom', 'POST', '/rate-plans', { name: 'Test Long Stay', type: 'Long Stay Rate', rules: [{ label: '4+ nights', minNights: 4, adjustment: { type: 'percent', value: -20 } }] }); assert.equal(plan.status, 201);
  const q = await call('fom', 'POST', '/rate-plans/quote', { categoryId: deluxe._id, ratePlanId: plan.data._id, checkIn: ymd(20), checkOut: ymd(25), adults: 2 });
  assert.equal(q.data.nights, 5); assert.equal(q.data.nightlyRate, 2560); assert.equal(q.data.total, 12800);
});

let guestId, resA, roomX;
test('guests: create, repeat-match conflict, edit', async () => {
  const g = await call('rec', 'POST', '/guests', { firstName: 'Test', lastName: 'Guest', phone: '9000000001', email: 'test.guest@example.com', marketingConsent: true }); assert.equal(g.status, 201); guestId = g.data._id;
  const dup = await call('rec', 'POST', '/guests', { firstName: 'Other', phone: '9000000001' }); assert.equal(dup.status, 409);
  const up = await call('rec', 'PUT', `/guests/${guestId}`, { vip: true, preferences: ['Ground floor'] }); assert.equal(up.data.vip, true);
  const list = await call('rec', 'GET', '/guests?q=9000000001'); assert.equal(list.total, 1, JSON.stringify(list).slice(0, 400));
});

test('reservation → Reserved → double-booking blocked → check-in → check-out → Vacant & Dirty', async () => {
  const rooms = (await call('rec', 'GET', '/rooms')).data; roomX = rooms.find((r) => r.roomNumber === '302'); assert.equal(roomX.status, 'Available');
  const cat = roomX.category._id || roomX.category;
  const body = { guest: guestId, room: roomX._id, checkIn: ymd(0), checkOut: ymd(2), adults: 2, children: 0, source: 'Walk-in', advanceAmount: 1000, advanceMethod: 'Cash' };
  const r1 = await call('rec', 'POST', '/reservations', body); assert.equal(r1.status, 201, JSON.stringify(r1)); resA = r1.data;
  assert.equal(resA.status, 'Confirmed'); assert.equal(resA.paymentStatus, 'Part-paid');
  assert.equal((await call('rec', 'GET', `/rooms/${roomX._id}`)).data.status, 'Reserved');
  // overlapping booking rejected by the server (also concurrent)
  const [c1, c2] = await Promise.all([call('rec', 'POST', '/reservations', { ...body, checkIn: ymd(1), checkOut: ymd(3), advanceAmount: 0 }), call('fom', 'POST', '/reservations', { ...body, checkIn: ymd(1), checkOut: ymd(4), advanceAmount: 0 })]);
  assert.deepEqual([c1.status, c2.status], [409, 409]);
  assert.match(c1.message, /already booked/);
  // turnover on the check-out day is allowed
  const turn = await call('rec', 'POST', '/reservations', { ...body, checkIn: ymd(2), checkOut: ymd(3), advanceAmount: 0 }); assert.equal(turn.status, 201);
  // wrong state transitions
  assert.equal((await call('rec', 'POST', `/reservations/${resA._id}/check-out`, {})).status, 400);
  assert.equal((await call('rec', 'POST', `/reservations/${resA._id}/check-in`, { idVerified: false })).status, 400);
  const ci = await call('rec', 'POST', `/reservations/${resA._id}/check-in`, { idVerified: true, document: { type: 'Aadhaar', number: 'X1234' } }); assert.equal(ci.status, 200, JSON.stringify(ci));
  assert.equal(ci.data.status, 'Checked In'); assert.equal((await call('rec', 'GET', `/rooms/${roomX._id}`)).data.status, 'Occupied');
  // folio: charges posted, advance counted, outstanding blocks checkout
  const bill = await call('rec', 'GET', `/bills/${ci.data.folio._id}`); assert.equal(bill.data.charges.length, 2); assert.equal(bill.data.totalPaid, 1000);
  const due = bill.data.outstanding; assert.ok(due > 0);
  const blockedCo = await call('rec', 'POST', `/reservations/${resA._id}/check-out`, {}); assert.equal(blockedCo.status, 409);
  assert.equal((await call('rec', 'POST', `/bills/${bill.data._id}/payment`, { amount: due, method: 'Crypto' })).status, 400);
  const pay = await call('rec', 'POST', `/bills/${bill.data._id}/payment`, { amount: due, method: 'UPI' }); assert.equal(pay.status, 201); assert.equal(pay.data.outstanding, 0);
  const co = await call('rec', 'POST', `/reservations/${resA._id}/check-out`, {}); assert.equal(co.status, 200); assert.equal(co.data.status, 'Checked Out');
  assert.equal((await call('rec', 'GET', `/rooms/${roomX._id}`)).data.status, 'Vacant & Dirty');
  const g = await call('rec', 'GET', `/guests/${guestId}`); assert.equal(g.data.isRepeat, true); assert.ok(g.data.stays.length >= 1);
});

test('cancellation → approval → audit; rec cannot approve', async () => {
  const room = (await call('rec', 'GET', '/rooms')).data.find((r) => r.roomNumber === '304');
  const r = (await call('rec', 'POST', '/reservations', { guest: guestId, room: room._id, checkIn: ymd(6), checkOut: ymd(8), adults: 1 })).data;
  const c = await call('rec', 'POST', `/reservations/${r._id}/cancel`, { reason: 'Guest changed plans' }); assert.equal(c.status, 202);
  assert.equal((await call('rec', 'GET', `/reservations/${r._id}`)).data.status, 'Confirmed', 'must not cancel before approval');
  assert.equal((await call('rec', 'POST', `/approvals/${c.data._id}/approve`, {})).status, 403);
  assert.equal((await call('gm', 'POST', `/approvals/${c.data._id}/reject`, {})).status, 400);
  const ap = await call('gm', 'POST', `/approvals/${c.data._id}/approve`, { comments: 'ok' }); assert.equal(ap.data.status, 'Approved');
  assert.equal((await call('rec', 'GET', `/reservations/${r._id}`)).data.status, 'Cancelled');
  const logs = await call('owner', 'GET', `/audit-logs?module=Approvals`); assert.ok(logs.data.some((l) => l.action === 'approve'));
  const resLogs = await call('owner', 'GET', `/audit-logs?entityId=${r._id}`); assert.ok(resLogs.data.some((l) => l.newValue?.status === 'Cancelled'));
});

test('price change → approval → applied only after approval → audit', async () => {
  const room = (await call('rec', 'GET', '/rooms')).data.find((r) => r.roomNumber === '305');
  const r = (await call('rec', 'POST', '/reservations', { guest: guestId, room: room._id, checkIn: ymd(9), checkOut: ymd(11), adults: 1 })).data;
  const old = r.nightlyRate;
  const pc = await call('rec', 'POST', `/reservations/${r._id}/price-change`, { nightlyRate: old - 300, reason: 'Corporate discount' }); assert.equal(pc.status, 202);
  assert.equal((await call('rec', 'GET', `/reservations/${r._id}`)).data.nightlyRate, old);
  assert.equal((await call('rec', 'POST', `/reservations/${r._id}/price-change`, { nightlyRate: 1 })).status, 400, 'duplicate pending request rejected');
  await call('owner', 'POST', `/approvals/${pc.data._id}/approve`, {});
  const after = (await call('rec', 'GET', `/reservations/${r._id}`)).data; assert.equal(after.nightlyRate, old - 300); assert.equal(after.totalAmount, (old - 300) * 2);
  const logs = await call('owner', 'GET', `/audit-logs?entityId=${r._id}`); assert.ok(logs.data.some((l) => /Price change approved/.test(l.note || '')));
});

test('editing dates re-validates availability; price from rate-plan change triggers approval', async () => {
  const room = (await call('rec', 'GET', '/rooms')).data.find((r) => r.roomNumber === '307');
  const r = (await call('rec', 'POST', '/reservations', { guest: guestId, room: room._id, checkIn: ymd(12), checkOut: ymd(13), adults: 1 })).data;
  const other = (await call('rec', 'POST', '/reservations', { guest: guestId, room: room._id, checkIn: ymd(14), checkOut: ymd(16), adults: 1 })).data;
  assert.equal((await call('rec', 'PUT', `/reservations/${r._id}`, { checkOut: ymd(15) })).status, 409);
  const ok = await call('rec', 'PUT', `/reservations/${other._id}`, { checkOut: ymd(17) }); assert.equal(ok.status, 200); assert.equal(ok.data.numberOfNights, 3);
  const plans = (await call('rec', 'GET', '/rate-plans')).data; const corp = plans.find((p) => p.type === 'Corporate Rate');
  const rp = await call('rec', 'PUT', `/reservations/${other._id}`, { ratePlan: corp._id }); assert.equal(rp.approvalRequired, true);
});

test('complaints: register, appears in guest history and dashboard count, resolve needs resolution', async () => {
  const c = await call('rec', 'POST', '/complaints', { guest: guestId, category: 'Room', description: 'Remote control not working', priority: 'High' }); assert.equal(c.status, 201);
  assert.equal((await call('rec', 'PUT', `/complaints/${c.data._id}`, { status: 'Resolved' })).status, 400);
  assert.equal((await call('rec', 'PUT', `/complaints/${c.data._id}`, { status: 'Resolved', resolution: 'Replaced remote' })).data.status, 'Resolved');
  assert.equal((await call('rec', 'GET', `/guests/${guestId}`)).data.complaints.length, 1);
  assert.ok((await call('rec', 'GET', '/complaints?status=Open,In%20Progress')).data.length >= 2);
});

test('dashboard figures come from the database; notifications work', async () => {
  const d = await call('owner', 'GET', '/dashboard'); assert.equal(d.status, 200);
  assert.equal(d.data.kpis.totalRooms, 25); // 24 seeded + 401 created in test
  assert.ok(d.data.kpis.arrivals >= 4); assert.ok(d.data.kpis.pendingApprovals >= 0);
  assert.equal((await call('hk', 'GET', '/dashboard')).status, 403);
  const n = await call('gm', 'GET', '/notifications'); assert.ok(n.data.length > 0);
  await call('gm', 'POST', '/notifications/read-all'); assert.equal((await call('gm', 'GET', '/notifications')).unread, 0);
});
