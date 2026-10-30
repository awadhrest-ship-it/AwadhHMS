/**
 * Development seed. ALL values are demo data (names, rates, statuses, passwords).
 * Run:  npm run seed   (from repo root)   -- WARNING: wipes the collections it seeds.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const M = require('../models');
const { PERMISSIONS, DEFAULT_ROLES } = require('../config/permissions');
const { todayStr, toDate, addDays } = require('../utils/dates');
const { quote } = require('../services/pricing');

const DEMO_PASSWORD = 'Awadh@123';
const T = () => toDate(todayStr());
const d = (n) => addDays(T(), n);

async function run(uri) {
  if (mongoose.connection.readyState !== 1) await connectDB(uri);
  await Promise.all(Object.values(M).map((m) => m.deleteMany({})));

  await M.Permission.insertMany(PERMISSIONS.map(([code, label, module]) => ({ code, label, module })));
  const roles = {};
  for (const r of DEFAULT_ROLES) roles[r.key] = await M.Role.create({ ...r, isSystem: true });

  const property = await M.Property.create({
    name: 'Awadh Palace', location: 'Minal', totalRoomsApprox: '10-25',
    facilities: ['Rooms', 'Restaurant', 'Bar', 'Room Service', 'Banquet Hall', 'Conference Hall', 'Laundry', 'Parking', 'Travel Desk', 'Airport Pickup/Drop'],
    departments: ['Management', 'Front Office', 'Housekeeping', 'Restaurant', 'Kitchen', 'Bar', 'Accounts', 'Stores', 'Purchase', 'Maintenance', 'Sales'],
  });

  /* ---- users (demo credentials) ---- */
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const mk = (name, email, role, department) => M.User.create({ name, email, password: hash, role: roles[role]._id, department });
  const u = {
    owner: await mk('Vishal Singh', 'owner@awadhpalace.test', 'hotel_owner', 'Management'),
    director: await mk('Rajeev Singh', 'director@awadhpalace.test', 'director', 'Management'),
    gm: await mk('Anita Mishra', 'gm@awadhpalace.test', 'general_manager', 'Management'),
    fom: await mk('Sandeep Tiwari', 'fom@awadhpalace.test', 'front_office_manager', 'Front Office'),
    rec: await mk('Priya Dubey', 'reception@awadhpalace.test', 'receptionist', 'Front Office'),
    rec2: await mk('S. Yadav', 'reception2@awadhpalace.test', 'receptionist', 'Front Office'),
    sales: await mk('Neeraj Pal', 'sales@awadhpalace.test', 'sales_manager', 'Sales'),
    acc: await mk('Mahesh Gupta', 'accounts@awadhpalace.test', 'accounts_manager', 'Accounts'),
    hk: await mk('Kavita Rao', 'housekeeping@awadhpalace.test', 'housekeeping_manager', 'Housekeeping'),
    rest: await mk('Imran Khan', 'restaurant@awadhpalace.test', 'restaurant_manager', 'Restaurant'),
  };

  /* ---- room categories & rooms ---- */
  const cats = {};
  const catDefs = [
    ['Standard', 'Comfortable double room with city view', 2, 2200, 500, ['AC', 'TV', 'Wi-Fi', 'Hot water']],
    ['Deluxe', 'Spacious room with sitting area', 3, 3200, 700, ['AC', 'TV', 'Wi-Fi', 'Hot water', 'Mini fridge', 'Work desk']],
    ['Suite', 'Two-room suite with lounge', 4, 5500, 900, ['AC', 'Smart TV', 'Wi-Fi', 'Hot water', 'Mini fridge', 'Bathtub', 'Sofa lounge']],
  ];
  for (const [name, description, capacity, basePrice, extraBedCharge, amenities] of catDefs) cats[name] = await M.RoomCategory.create({ name, description, capacity, basePrice, extraBedCharge, amenities });
  const layout = { 1: ['Standard', 'Deluxe', 'Suite', 'Standard', 'Deluxe', 'Standard', 'Deluxe', 'Standard'], 2: ['Deluxe', 'Suite', 'Standard', 'Deluxe', 'Suite', 'Standard', 'Deluxe', 'Standard'], 3: ['Suite', 'Standard', 'Deluxe', 'Suite', 'Standard', 'Deluxe', 'Suite', 'Standard'] };
  const rooms = {};
  for (const [floor, list] of Object.entries(layout)) {
    for (let i = 0; i < list.length; i++) {
      const number = `${floor}0${i + 1}`; const c = cats[list[i]];
      rooms[number] = await M.Room.create({ roomNumber: number, floor: Number(floor), category: c._id, capacity: c.capacity, extraBedCharge: c.extraBedCharge, amenities: c.amenities, status: 'Available' });
    }
  }

  /* ---- rate plans (demo values; combination/priority rules TBC) ---- */
  const plans = {
    roomOnly: await M.RatePlan.create({ name: 'Room Only', type: 'Room Only', mealPlan: 'None', rules: [
      { label: 'Weekend uplift (Fri-Sat)', daysOfWeek: [5, 6], adjustment: { type: 'percent', value: 10 } }] }),
    breakfast: await M.RatePlan.create({ name: 'Room with Breakfast', type: 'Room with Breakfast', mealPlan: 'Breakfast', defaultAdjustment: { type: 'flat', value: 300 }, rules: [
      { label: 'Weekend uplift (Fri-Sat)', daysOfWeek: [5, 6], adjustment: { type: 'flat', value: 400 } }] }),
    corporate: await M.RatePlan.create({ name: 'Corporate Rate', type: 'Corporate Rate', mealPlan: 'Breakfast', defaultAdjustment: { type: 'percent', value: -12 } }),
    agent: await M.RatePlan.create({ name: 'Travel Agent Rate', type: 'Travel Agent Rate', defaultAdjustment: { type: 'percent', value: -15 } }),
    group: await M.RatePlan.create({ name: 'Group Booking Rate', type: 'Group Booking Rate', defaultAdjustment: { type: 'percent', value: -10 }, rules: [{ label: '3+ guests', minGuests: 3, adjustment: { type: 'percent', value: -10 } }] }),
    longStay: await M.RatePlan.create({ name: 'Long Stay Rate', type: 'Long Stay Rate', defaultAdjustment: { type: 'percent', value: 0 }, rules: [{ label: '5+ nights', minNights: 5, adjustment: { type: 'percent', value: -18 } }] }),
    special: await M.RatePlan.create({ name: 'Festival Special Package', type: 'Special Package', mealPlan: 'Breakfast + Dinner', defaultAdjustment: { type: 'flat', value: 900 } }),
  };

  /* ---- guests ---- */
  const G = {};
  const gdefs = [
    ['rahul', 'Rahul', 'Verma', '9876543210', 'rahul.verma@example.com', { name: 'Sharma Textiles', designation: 'Buyer' }, ['Ground floor', 'Vegetarian meals', 'Extra pillows'], { vip: true, marketingConsent: true }],
    ['meera', 'Meera', 'Joshi', '9811122233', 'meera.j@example.com', null, ['Quiet room'], { marketingConsent: true }],
    ['amit', 'Amit', 'Sharma', '9822233344', null, { name: 'Kanpur Steel Works' }, [], {}],
    ['sunita', 'Sunita', 'Rao', '9833344455', 'sunita.rao@example.com', null, ['Late checkout when possible'], { vip: true }],
    ['neha', 'Neha', 'Gupta', '9844455566', 'neha.g@example.com', null, [], { marketingConsent: true }],
    ['vikas', 'Vikas', 'Pandey', '9855566677', null, null, ['Vegetarian meals'], {}],
    ['anita', 'Anita', 'Das', '9866677788', 'anita.das@example.com', null, [], {}],
    ['rohan', 'Rohan', 'Mehta', '9877788899', 'rohan.m@example.com', { name: 'Mehta Logistics' }, ['High floor'], {}],
    ['faisal', 'Faisal', 'Ahmed', '9888899900', null, null, [], { blacklist: true, blacklistReason: 'Damage to room property (demo)' }],
    ['kiran', 'Kiran', 'Patel', '9899900011', 'kiran.p@example.com', null, ['Extra bed'], {}],
  ];
  let gi = 1;
  for (const [key, firstName, lastName, phone, email, corp, preferences, extra] of gdefs) {
    G[key] = await M.Guest.create({ guestId: `G-${String(gi++).padStart(4, '0')}`, firstName, lastName, phone, email, corporate: corp || undefined, preferences,
      documents: key === 'rahul' ? [{ type: 'Aadhaar', number: 'XXXX-XXXX-4421', fileName: 'rahul_id.jpg' }] : [], ...extra });
  }
  await M.Counter.updateOne({ _id: 'G' }, { seq: gi - 1 }, { upsert: true });
  G.rahul.communicationPreferences = { whatsapp: true, sms: false, email: true }; await G.rahul.save();

  /* ---- reservations via the same pricing logic used at runtime ---- */
  const folioFor = async (res, extra = {}) => {
    const f = await M.Folio.create({ folioNumber: await M.Counter.next('FOL', 4), reservation: res._id, guest: res.guest, room: res.room, ...extra });
    res.folio = f._id; await res.save(); return f;
  };
  const book = async ({ guest, room, cat, inDay, outDay, status, plan, adults = 2, children = 0, advance = 0, source = 'Walk-in', by = u.rec, extraBed = false, requests }) => {
    const category = room ? rooms[room].category : cats[cat]._id;
    const q = await quote({ categoryId: category, ratePlanId: plan?._id, checkIn: d(inDay), checkOut: d(outDay), adults, children, extraBed, source });
    const res = await M.Reservation.create({
      reservationNumber: await M.Counter.next('RES', 4), guest: G[guest]._id, room: room ? rooms[room]._id : undefined, roomCategory: category,
      checkIn: d(inDay), checkOut: d(outDay), adults, children, extraBed, ratePlan: plan?._id, nightlyRate: q.nightlyRate, rateBreakdown: q.breakdown,
      numberOfNights: q.nights, extraBedAmount: q.extraBedAmount, subtotal: q.subtotal, taxAmount: q.taxAmount, totalAmount: q.total, advanceAmount: advance,
      status, source, createdBy: by._id, specialRequests: requests,
    });
    const folio = await folioFor(res);
    if (advance > 0) await M.Payment.create({ folio: folio._id, guest: G[guest]._id, reservation: res._id, amount: advance, kind: 'Advance', method: 'UPI', receivedBy: by._id });
    if (['Checked In', 'Checked Out'].includes(status)) {
      q.breakdown.forEach((b) => folio.charges.push({ type: 'Room', description: `Room charge ${b.date.toISOString().slice(0, 10)}`, date: b.date, unitPrice: b.rate, amount: b.rate, postedBy: by._id, source: 'check-in' }));
      if (q.extraBedAmount) folio.charges.push({ type: 'Extra Bed', description: 'Extra bed', amount: q.extraBedAmount, postedBy: by._id, source: 'check-in' });
      res.checkedInAt = d(inDay); res.checkedInBy = by._id; res.idVerified = true;
    }
    return { res, folio };
  };
  const settle = async ({ res, folio }, paid) => {
    if (paid > 0) await M.Payment.create({ folio: folio._id, guest: res.guest, reservation: res._id, amount: paid, method: 'Cash', receivedBy: u.rec._id, receivedAt: new Date() });
    await folio.recalc(); await folio.save();
    const due = Math.max(res.totalAmount, folio.totalCharges);
    res.paymentStatus = folio.totalPaid <= 0 ? 'Pending' : folio.totalPaid >= due ? 'Paid' : 'Part-paid'; await res.save();
  };
  const setRoom = (n, status, reason) => M.Room.updateOne({ roomNumber: n }, { status, statusReason: reason });

  // Current stays
  const b1 = await book({ guest: 'neha', room: '102', inDay: -2, outDay: 0, status: 'Checked In', plan: plans.roomOnly, advance: 2000 }); b1.res.status = 'Checked In'; await b1.res.save(); await settle(b1, b1.folio.charges.reduce((s, c) => s + c.amount, 0));
  const b2 = await book({ guest: 'vikas', room: '205', inDay: -3, outDay: 0, status: 'Checked In', plan: plans.breakfast, adults: 1 }); await settle(b2, 6000);
  const b3 = await book({ guest: 'anita', room: '107', inDay: -1, outDay: 0, status: 'Checked In', plan: plans.roomOnly }); await settle(b3, b3.folio.charges.reduce((s, c) => s + c.amount, 0));
  const b4 = await book({ guest: 'rohan', room: '303', inDay: -1, outDay: 2, status: 'Checked In', plan: plans.corporate, source: 'Corporate' }); await settle(b4, 3000);
  const b5 = await book({ guest: 'kiran', room: '301', inDay: -2, outDay: 3, status: 'Checked In', plan: plans.longStay, extraBed: true }); await settle(b5, 4000);
  for (const [n, who] of [['102', b1], ['205', b2], [b3.res.room && (await M.Room.findById(b3.res.room)).roomNumber, b3], ['303', b4], ['301', b5]]) { await setRoom(n, 'Occupied'); await M.Folio.updateOne({ _id: who.folio._id }, { room: who.res.room }); }

  // Today's arrivals (confirmed) + pending assignment
  const a1 = await book({ guest: 'rahul', room: '204', inDay: 0, outDay: 2, status: 'Confirmed', plan: plans.breakfast, advance: 6400 }); await settle(a1, 0);
  const a2 = await book({ guest: 'meera', room: '108', inDay: 0, outDay: 1, status: 'Confirmed', plan: plans.roomOnly, advance: 1000, adults: 1 }); await settle(a2, 0);
  const a3 = await book({ guest: 'amit', cat: 'Suite', inDay: 0, outDay: 2, status: 'Pending', plan: plans.corporate, source: 'Corporate', advance: 0 }); await settle(a3, 0);
  const a4 = await book({ guest: 'sunita', room: '104', inDay: 0, outDay: 3, status: 'Confirmed', plan: plans.roomOnly, advance: 5000 }); await settle(a4, 0);
  for (const n of ['204', '108', '104']) await setRoom(n, 'Reserved');

  // Upcoming + history
  const f1 = await book({ guest: 'rohan', room: '202', inDay: 3, outDay: 5, status: 'Confirmed', plan: plans.corporate, source: 'Corporate' }); await settle(f1, 0);
  const f2 = await book({ guest: 'meera', room: '305', inDay: 5, outDay: 8, status: 'Confirmed', plan: plans.agent, source: 'Travel Agent' }); await settle(f2, 0);
  const c1 = await book({ guest: 'kiran', room: '201', inDay: 2, outDay: 4, status: 'Cancelled', plan: plans.roomOnly }); c1.res.cancelledAt = new Date(); c1.res.cancellationReason = 'Change of plans (demo)'; await c1.res.save();
  const h1 = await book({ guest: 'rahul', room: '204', inDay: -50, outDay: -48, status: 'Checked Out', plan: plans.breakfast }); await settle(h1, h1.folio.charges.reduce((s, c) => s + c.amount, 0));
  const h2 = await book({ guest: 'rahul', room: '301', inDay: -200, outDay: -198, status: 'Checked Out', plan: plans.roomOnly }); await settle(h2, h2.folio.charges.reduce((s, c) => s + c.amount, 0));
  const h3 = await book({ guest: 'neha', room: '103', inDay: -30, outDay: -28, status: 'Checked Out', plan: plans.roomOnly }); await settle(h3, h3.folio.charges.reduce((s, c) => s + c.amount, 0) - 1500);
  G.neha.outstandingBalance = 1500; await G.neha.save();
  for (const x of [h1, h2, h3]) { await M.Payment.updateMany({ folio: x.folio._id }, { receivedAt: addDays(new Date(), -30) }); }
  // Housekeeping-style states shown in the grid (set by later phases in reality; demo values here)
  await setRoom('105', 'Vacant & Dirty'); await setRoom('106', 'Vacant & Clean'); await setRoom('101', 'Available');
  await setRoom('203', 'Maintenance Required', 'AC compressor (demo)'); await setRoom('207', 'Cleaning in Progress'); await setRoom('206', 'Inspection Pending');
  await M.Room.updateOne({ roomNumber: '208' }, { status: 'Out of Order', outOfOrder: true, statusReason: 'AC failure (demo)', statusBeforeHold: 'Available' });
  await M.Room.updateOne({ roomNumber: '306' }, { status: 'Blocked', blocked: true, statusReason: 'Reserved for owner family (demo)', statusBeforeHold: 'Available' });
  await M.Room.updateMany({ status: 'Available', roomNumber: { $in: ['302', '304', '305', '307', '308', '101', '107'] } }, { status: 'Available' });

  /* ---- complaints ---- */
  const complaint = async (guest, room, category, description, priority, status, by, extra = {}) => M.Complaint.create({ complaintNumber: await M.Counter.next('CMP', 4), guest: G[guest]._id, room: room ? rooms[room]._id : undefined, category, description, priority, status, createdBy: by._id, ...extra });
  await complaint('rahul', '204', 'Room', 'Air conditioning was noisy during the night (previous stay).', 'Medium', 'Resolved', u.rec, { resolution: 'Technician serviced the unit; guest offered a quiet room next time.', resolvedAt: addDays(new Date(), -47), resolvedBy: u.fom._id });
  await complaint('neha', '102', 'Housekeeping', 'Bathroom towels not replaced since yesterday.', 'High', 'Open', u.rec);
  await complaint('rohan', '303', 'Noise', 'Loud music from the banquet area after 11 pm.', 'Medium', 'In Progress', u.rec2, { assignedTo: u.fom._id });
  await complaint('vikas', '205', 'Billing', 'Charged for extra breakfast not consumed.', 'Low', 'Closed', u.rec, { resolution: 'Charge reversed after review.', resolvedAt: addDays(new Date(), -1), resolvedBy: u.gm._id });

  /* ---- pending approvals (via same collection used at runtime) ---- */
  const mkApproval = async (type, res, label, amount, payload, by, comments) => {
    res.pendingApproval = true; await res.save();
    return M.ApprovalRequest.create({ requestNumber: await M.Counter.next('APR', 4), type, referenceModel: 'Reservation', referenceId: res._id, referenceLabel: label, amount, payload, requestedBy: by._id, approverRoles: ['general_manager', 'hotel_owner'], comments });
  };
  await mkApproval('Booking cancellation', f2.res, f2.res.reservationNumber, f2.res.totalAmount, { reason: 'Travel agent withdrew the group (demo)' }, u.rec, 'Travel agent withdrew the group (demo)');
  await mkApproval('Booking price change', f1.res, f1.res.reservationNumber, 400, { directRate: f1.res.nightlyRate - 200, oldRate: f1.res.nightlyRate }, u.fom, 'Loyal corporate client requested better rate (demo)');

  /* ---- notifications & audit samples ---- */
  await M.Notification.create({ type: 'approval_request', title: 'Booking cancellation awaiting approval', message: `${f2.res.reservationNumber} - Travel agent withdrew the group`, link: '/approvals', severity: 'warning', recipientPermission: 'approvals.approve' });
  await M.Notification.create({ type: 'approval_request', title: 'Booking price change awaiting approval', message: `${f1.res.reservationNumber} - requested by Sandeep Tiwari`, link: '/approvals', severity: 'warning', recipientPermission: 'approvals.approve' });
  await M.Notification.create({ type: 'pending_checkin', title: 'Booking needs a room', message: `${a3.res.reservationNumber} (Amit Sharma, Suite) has no room assigned`, link: `/reservations/${a3.res._id}`, severity: 'warning', recipientPermission: 'reservations.checkin' });
  await M.Notification.create({ type: 'complaint', title: 'New high complaint', message: 'Bathroom towels not replaced since yesterday.', link: '/complaints', severity: 'urgent', recipientPermission: 'complaints.edit' });
  await M.Notification.create({ type: 'pending_payment', title: 'Payment due at departure', message: 'Vikas Pandey - room 205 has an outstanding balance', link: '/bills', severity: 'warning', recipientPermission: 'bills.payment' });
  const logs = [
    ['create', 'Reservations', 'Reservation', a1.res, u.rec, 'RES created'], ['status', 'Rooms', 'Room', null, u.hk, 'Room 208 set Out of Order'],
    ['create', 'Complaints', 'Complaint', null, u.rec, 'Complaint registered'],
  ];
  await M.AuditLog.insertMany([
    { user: u.rec._id, userName: u.rec.name, userRole: 'Receptionist', action: 'create', module: 'Reservations', entity: 'Reservation', entityId: a1.res._id, entityLabel: a1.res.reservationNumber, newValue: { status: 'Confirmed', room: '204' }, timestamp: new Date(Date.now() - 36e5 * 5) },
    { user: u.fom._id, userName: u.fom.name, userRole: 'Front Office Manager', action: 'status', module: 'Rooms', entity: 'Room', entityId: rooms['208']._id, entityLabel: '208', oldValue: { status: 'Available' }, newValue: { status: 'Out of Order' }, note: 'AC failure (demo)', timestamp: new Date(Date.now() - 36e5 * 4) },
    { user: u.rec._id, userName: u.rec.name, userRole: 'Receptionist', action: 'status', module: 'Front Desk', entity: 'Reservation', entityId: b5.res._id, entityLabel: b5.res.reservationNumber, oldValue: { status: 'Confirmed' }, newValue: { status: 'Checked In', room: '301' }, note: 'Check-in', timestamp: new Date(Date.now() - 36e5 * 3) },
    { user: u.rec._id, userName: u.rec.name, userRole: 'Receptionist', action: 'create', module: 'Approvals', entity: 'ApprovalRequest', entityLabel: 'Booking cancellation', newValue: { reservation: f2.res.reservationNumber }, timestamp: new Date(Date.now() - 36e5 * 2) },
  ]);
  void logs;

  await require('./seedPhase45')({ log: () => {} }); // Phase 4/5: units, categories, demo stock items, demo housekeeping tasks and users
  await require('./seedPhase6')({ log: () => {} });  // Phase 6: demo restaurant tables, menu, reservation and restaurant users

  // Summary is read back from the database AFTER every phase's seed has run, so it shows everything that now exists
  // (the Phase 4/5/6 seeds run silently and add their own users, stock, tables and menu).
  const allUsers = await M.User.find().populate('role', 'name').sort({ createdAt: 1 });
  const count = (m) => M[m].countDocuments();
  console.log('\nSeed complete.');
  console.log(`Rooms: ${Object.keys(rooms).length} | Guests: ${Object.keys(G).length} | Demo password for all users: ${DEMO_PASSWORD}`);
  console.log(`Restaurant (Phase 6): ${await count('RestaurantTable')} tables | ${await count('MenuCategory')} menu categories | ${await count('MenuItem')} menu items | ${await count('RestaurantReservation')} demo reservation(s)`);
  console.log(`\nLogin accounts (${allUsers.length}):`);
  console.table(allUsers.map((x) => ({ name: x.name, email: x.email, role: x.role?.name, department: x.department })));
}

module.exports = run;
/** The CLI seed WIPES the seeded collections. It refuses to touch a database that already has users unless you say so explicitly. */
async function guardedCli() {
  await connectDB();
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED_WIPE !== 'yes') throw new Error('Refusing to seed in production. This script deletes data.');
  if ((await M.User.countDocuments()) > 0 && process.env.ALLOW_SEED_WIPE !== 'yes') {
    throw new Error('This database already has users. `npm run seed` would DELETE them. To keep your data run `npm run seed:phase45` (non-destructive). To really wipe it set ALLOW_SEED_WIPE=yes.');
  }
  await run();
}
if (require.main === module) guardedCli().then(() => mongoose.disconnect()).catch((e) => { console.error(e); process.exit(1); });