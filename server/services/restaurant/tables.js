/**
 * Module 6.1 - tables, table reservations and order transfer.
 * Table occupancy is derived: `RestaurantTable.currentOrder` is an atomic, system-managed claim taken when a dine-in order opens and released
 * when it completes / is cancelled / is transferred. Nothing here lets a client type "Occupied" onto a table.
 */
const mongoose = require('mongoose');
const { RestaurantTable, RestaurantReservation, RestaurantOrder, Counter } = require('../../models');
const { restaurantSettings } = require('../settings');
const { audit } = require('../audit');
const { withLock } = require('./locks');
const { todayStr } = require('../../utils/dates');
const { bad, conflict, notFound } = require('../../utils/ApiError');

const LIVE = RestaurantReservation.LIVE;
const hhmm = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
const by = (req) => ({ by: req.user._id, byName: req.user.name });
const MIN = 60000;

/* ------------------------------------------------------------------ derived status */
async function derive(tables, now = new Date()) {
  const settings = await restaurantSettings();
  const claimed = tables.map((t) => t.currentOrder).filter(Boolean);
  const orders = claimed.length ? await RestaurantOrder.find({ _id: { $in: claimed } }).select('orderNumber status type items subtotal covers createdAt tableNumber customer').lean() : [];
  const oMap = new Map(orders.map((o) => [String(o._id), o]));
  const ids = tables.map((t) => t._id);
  const horizon = new Date(now.getTime() + settings.reservationHoldMinutes * MIN);
  const resv = ids.length ? await RestaurantReservation.find({ table: { $in: ids }, status: { $in: LIVE }, endsAt: { $gt: now }, startsAt: { $lt: new Date(now.getTime() + 24 * 60 * MIN) } }).sort({ startsAt: 1 }).lean() : [];
  const seated = ids.length ? await RestaurantReservation.find({ table: { $in: ids }, status: 'Seated' }).lean() : [];
  const out = [];
  for (const t of tables) {
    const o = t.currentOrder ? oMap.get(String(t.currentOrder)) : null;
    let activeOrder = o && RestaurantOrder.ACTIVE.includes(o.status) ? o : null;
    if (t.currentOrder && !activeOrder) { // self-heal: a claim whose order is finished or gone
      await RestaurantTable.updateOne({ _id: t._id, currentOrder: t.currentOrder }, { $set: { currentOrder: null } }).catch(() => {});
      activeOrder = null;
    }
    const mine = resv.filter((r) => String(r.table) === String(t._id));
    const seatedRes = seated.find((r) => String(r.table) === String(t._id) && (!r.order || !activeOrder));
    const nextRes = mine.find((r) => r.status === 'Booked');
    const holdRes = nextRes && nextRes.startsAt < horizon ? nextRes : null;
    let status = 'Available';
    if (!t.active) status = 'Inactive';
    else if (t.outOfService) status = 'Out of Service';
    else if (activeOrder || seatedRes) status = 'Occupied';
    else if (holdRes) status = 'Reserved';
    out.push({ ...(t.toObject ? t.toObject() : t), currentOrder: activeOrder ? t.currentOrder : null, status,
      order: activeOrder ? { _id: activeOrder._id, orderNumber: activeOrder.orderNumber, status: activeOrder.status, covers: activeOrder.covers, createdAt: activeOrder.createdAt, itemCount: (activeOrder.items || []).filter((i) => i.status === 'Active').reduce((s, i) => s + i.quantity, 0), subtotal: activeOrder.subtotal } : null,
      seatedReservation: !activeOrder && seatedRes ? { _id: seatedRes._id, reservationNumber: seatedRes.reservationNumber, guestName: seatedRes.guestName, partySize: seatedRes.partySize } : null,
      nextReservation: nextRes ? { _id: nextRes._id, reservationNumber: nextRes.reservationNumber, guestName: nextRes.guestName, partySize: nextRes.partySize, startsAt: nextRes.startsAt } : null });
  }
  return out;
}

async function listTables({ includeInactive = false } = {}) {
  const tables = await RestaurantTable.find(includeInactive ? {} : { active: true }).sort({ sortOrder: 1, number: 1 });
  return derive(tables);
}
async function getTable(id) {
  const t = await RestaurantTable.findById(id); if (!t) throw notFound('Table not found');
  const [d] = await derive([t]);
  const upcoming = await RestaurantReservation.find({ table: t._id, status: { $in: LIVE }, endsAt: { $gt: new Date() } }).sort({ startsAt: 1 }).limit(20);
  return { ...d, upcomingReservations: upcoming };
}

/* ------------------------------------------------------------------ table CRUD */
async function createTable(req, b) {
  const number = b.number.trim();
  if (await RestaurantTable.exists({ number: new RegExp(`^${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw conflict(`Table "${number}" already exists`);
  const t = await RestaurantTable.create({ number, section: b.section || 'Main hall', capacity: b.capacity, notes: b.notes, sortOrder: b.sortOrder || 0 });
  await audit(req, { action: 'create', module: 'Restaurant', entity: 'RestaurantTable', entityId: t._id, entityLabel: `Table ${t.number}`, newValue: t });
  return getTable(t._id);
}
async function updateTable(req, id, b) {
  const t = await RestaurantTable.findById(id); if (!t) throw notFound('Table not found');
  const before = t.toObject();
  const hasOrder = async () => t.currentOrder && !!(await RestaurantOrder.exists({ _id: t.currentOrder, status: { $in: RestaurantOrder.ACTIVE } }));
  if (b.number && b.number.trim().toLowerCase() !== t.number.toLowerCase()) {
    if (await RestaurantTable.exists({ _id: { $ne: t._id }, number: new RegExp(`^${b.number.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw conflict(`Table "${b.number}" already exists`);
    t.number = b.number.trim();
  }
  if (b.section !== undefined) t.section = b.section;
  if (b.notes !== undefined) t.notes = b.notes;
  if (b.sortOrder !== undefined) t.sortOrder = b.sortOrder;
  if (b.capacity !== undefined && b.capacity !== t.capacity) {
    const big = await RestaurantReservation.findOne({ table: t._id, status: { $in: LIVE }, endsAt: { $gt: new Date() }, partySize: { $gt: b.capacity } });
    if (big) throw conflict(`Reservation ${big.reservationNumber} is for ${big.partySize} guests - change or move it before reducing the capacity`);
    t.capacity = b.capacity;
  }
  const goingOut = (b.active === false && t.active) || (b.outOfService === true && !t.outOfService);
  if (goingOut) {
    if (await hasOrder()) throw conflict(`Table ${t.number} has an open order - finish or transfer it first`);
    if (b.active === false) {
      const upcoming = await RestaurantReservation.findOne({ table: t._id, status: 'Booked', endsAt: { $gt: new Date() } });
      if (upcoming) throw conflict(`Table ${t.number} has an upcoming reservation (${upcoming.reservationNumber}) - cancel or move it first`);
    }
  }
  if (b.active !== undefined) t.active = b.active;
  if (b.outOfService !== undefined) { t.outOfService = b.outOfService; t.outOfServiceReason = b.outOfService ? (b.outOfServiceReason || 'Not specified') : undefined; }
  await t.save();
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'RestaurantTable', entityId: t._id, entityLabel: `Table ${t.number}`, oldValue: before, newValue: t });
  return getTable(t._id);
}

/* ------------------------------------------------------------------ order <-> table claims (used by orders.js) */
/** Throws unless a NEW order may start on this table now. `allowReservation` = the reservation being seated. */
async function assertTableUsable(tableId, { allowReservation, now = new Date() } = {}) {
  const t = await RestaurantTable.findById(tableId);
  if (!t || !t.active) throw bad('Table not found or inactive');
  if (t.outOfService) throw conflict(`Table ${t.number} is out of service${t.outOfServiceReason ? ': ' + t.outOfServiceReason : ''}`);
  const settings = await restaurantSettings();
  const q = { table: t._id, status: 'Booked', startsAt: { $lt: new Date(now.getTime() + settings.reservationHoldMinutes * MIN) }, endsAt: { $gt: now } };
  if (allowReservation) q._id = { $ne: allowReservation };
  const clash = await RestaurantReservation.findOne(q);
  if (clash) throw conflict(`Table ${t.number} is reserved for ${clash.guestName} at ${hhmm(clash.startsAt)} (${clash.reservationNumber}). Seat that reservation or pick another table.`);
  return t;
}
/** Atomic claim: succeeds only if nobody holds the table. */
async function claimTable(tableId, orderId) {
  const r = await RestaurantTable.updateOne({ _id: tableId, active: true, outOfService: false, currentOrder: null }, { $set: { currentOrder: orderId } });
  if (!r.modifiedCount && !r.matchedCount) {
    const t = await RestaurantTable.findById(tableId);
    // A stale claim (its order finished) must not block the table forever.
    if (t?.currentOrder && !(await RestaurantOrder.exists({ _id: t.currentOrder, status: { $in: RestaurantOrder.ACTIVE } }))) {
      const r2 = await RestaurantTable.updateOne({ _id: tableId, currentOrder: t.currentOrder }, { $set: { currentOrder: orderId } });
      if (r2.matchedCount) return true;
    }
    throw conflict(`Table ${t?.number || ''} already has an open order`.replace('  ', ' '));
  }
  return true;
}
const releaseTable = (tableId, orderId) => RestaurantTable.updateOne({ _id: tableId, currentOrder: orderId }, { $set: { currentOrder: null } });

/* ------------------------------------------------------------------ reservations */
const label = (r) => `${r.reservationNumber} ${r.guestName} (${r.tableNumber})`;
async function assertFits(table, { partySize, startsAt, endsAt, excludeId }) {
  if (!table || !table.active) throw bad('Table not found or inactive');
  if (table.outOfService) throw conflict(`Table ${table.number} is out of service`);
  if (partySize > table.capacity) throw bad(`Table ${table.number} seats ${table.capacity}; the party is ${partySize}`);
  const q = { table: table._id, status: { $in: LIVE }, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt } };
  if (excludeId) q._id = { $ne: excludeId };
  const clash = await RestaurantReservation.findOne(q);
  if (clash) throw conflict(`Table ${table.number} is already reserved ${hhmm(clash.startsAt)}–${hhmm(clash.endsAt)} (${clash.reservationNumber})`, [{ reservationNumber: clash.reservationNumber, startsAt: clash.startsAt, endsAt: clash.endsAt }]);
}

async function createReservation(req, b) {
  const settings = await restaurantSettings();
  const startsAt = new Date(b.startsAt); if (Number.isNaN(startsAt.getTime())) throw bad('Enter a valid date and time');
  if (startsAt.getTime() < Date.now() - 15 * MIN) throw bad('The reservation time is in the past');
  const durationMinutes = b.durationMinutes || settings.reservationDurationMinutes;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * MIN);
  return withLock(`rtable:${b.table}`, async () => {
    const table = await RestaurantTable.findById(b.table);
    await assertFits(table, { partySize: b.partySize, startsAt, endsAt });
    const r = await RestaurantReservation.create({
      reservationNumber: await Counter.next('TRS', 4), guestName: b.guestName.trim(), phone: b.phone, guest: b.guest, partySize: b.partySize,
      table: table._id, tableNumber: table.number, startsAt, durationMinutes, endsAt, businessDate: todayStr(startsAt), notes: b.notes, createdBy: req.user._id,
      history: [{ at: new Date(), ...by(req), action: 'created' }],
    });
    await audit(req, { action: 'create', module: 'Restaurant', entity: 'RestaurantReservation', entityId: r._id, entityLabel: label(r), newValue: r });
    return r;
  });
}
async function updateReservation(req, id, b) {
  const cur = await RestaurantReservation.findById(id); if (!cur) throw notFound('Reservation not found');
  if (cur.status !== 'Booked') throw bad(`A ${cur.status.toLowerCase()} reservation cannot be edited`);
  const tableId = b.table || cur.table;
  return withLock(`rtable:${tableId}`, async () => {
    const r = await RestaurantReservation.findById(id); if (r.status !== 'Booked') throw conflict('This reservation was just changed - reload and retry');
    const before = r.toObject();
    const startsAt = b.startsAt ? new Date(b.startsAt) : r.startsAt; if (Number.isNaN(startsAt.getTime())) throw bad('Enter a valid date and time');
    if (b.startsAt && startsAt.getTime() < Date.now() - 15 * MIN) throw bad('The reservation time is in the past');
    const durationMinutes = b.durationMinutes || r.durationMinutes; const endsAt = new Date(startsAt.getTime() + durationMinutes * MIN);
    const partySize = b.partySize || r.partySize;
    const table = await RestaurantTable.findById(tableId);
    await assertFits(table, { partySize, startsAt, endsAt, excludeId: r._id });
    Object.assign(r, { table: table._id, tableNumber: table.number, startsAt, durationMinutes, endsAt, partySize, businessDate: todayStr(startsAt) });
    if (b.guestName) r.guestName = b.guestName.trim(); if (b.phone !== undefined) r.phone = b.phone; if (b.notes !== undefined) r.notes = b.notes;
    r.history.push({ at: new Date(), ...by(req), action: 'edited' });
    await r.save();
    await audit(req, { action: 'update', module: 'Restaurant', entity: 'RestaurantReservation', entityId: r._id, entityLabel: label(r), oldValue: before, newValue: r });
    return r;
  });
}
async function transition(req, id, { from, to, action, note, check }) {
  const r = await RestaurantReservation.findById(id); if (!r) throw notFound('Reservation not found');
  if (!from.includes(r.status)) throw bad(`Only ${from.join(' / ').toLowerCase()} reservations can be ${action}${action.endsWith('e') ? 'd' : 'ed'} (this one is ${r.status.toLowerCase()})`);
  if (check) await check(r);
  const res = await RestaurantReservation.findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: { status: to, ...(to === 'Cancelled' ? { cancelReason: note } : {}) }, $push: { history: { at: new Date(), ...by(req), action: to, note } } }, { new: true });
  if (!res) throw conflict('This reservation was just changed - reload and retry');
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'RestaurantReservation', entityId: r._id, entityLabel: label(r), oldValue: { status: r.status }, newValue: { status: to }, note });
  return res;
}
const cancelReservation = (req, id, reason) => transition(req, id, { from: ['Booked'], to: 'Cancelled', action: 'cancelled', note: reason });
const noShowReservation = (req, id) => transition(req, id, { from: ['Booked'], to: 'No-show', action: 'marked as no-show', check: async (r) => { if (r.startsAt.getTime() > Date.now()) throw bad('The reservation time has not arrived yet'); } });
const completeReservation = (req, id) => transition(req, id, { from: ['Seated'], to: 'Completed', action: 'completed', check: async (r) => {
  if (r.order && (await RestaurantOrder.exists({ _id: r.order, status: { $in: RestaurantOrder.ACTIVE } }))) throw conflict('The party still has an open order - complete or cancel it first');
} });
/** "Seat" a booked party before any order exists (the table then shows Occupied). Creating an order from the reservation also seats it. */
const seatReservation = (req, id) => transition(req, id, { from: ['Booked'], to: 'Seated', action: 'seated', check: async (r) => {
  const t = await RestaurantTable.findById(r.table);
  if (!t || !t.active || t.outOfService) throw conflict('The table is not available');
  if (t.currentOrder && (await RestaurantOrder.exists({ _id: t.currentOrder, status: { $in: RestaurantOrder.ACTIVE } }))) throw conflict(`Table ${t.number} still has an open order`);
  if (await RestaurantReservation.exists({ table: r.table, status: 'Seated', _id: { $ne: r._id } })) throw conflict(`Table ${t.number} already has a seated party`);
} });

async function listReservations(q = {}) {
  const f = {};
  if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.table) f.table = q.table;
  if (q.date) f.businessDate = q.date;
  if (q.from || q.to) { f.startsAt = {}; if (q.from) f.startsAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.startsAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); }
  if (q.q) { const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ guestName: rx }, { phone: rx }, { reservationNumber: rx }]; }
  return RestaurantReservation.find(f).sort({ startsAt: 1 }).limit(300).populate('table', 'number section capacity');
}

/** Called by orders.js when an order's table is released for good. */
async function onOrderFinished(order, { completed }) {
  if (order.table) await releaseTable(order.table, order._id);
  if (order.reservation) {
    if (completed) await RestaurantReservation.updateOne({ _id: order.reservation, status: 'Seated' }, { $set: { status: 'Completed' }, $push: { history: { at: new Date(), action: 'Completed', note: `Order ${order.orderNumber} completed` } } });
    else await RestaurantReservation.updateOne({ _id: order.reservation, status: 'Seated' }, { $set: { status: 'Booked', order: null }, $push: { history: { at: new Date(), action: 'Booked', note: `Order ${order.orderNumber} cancelled - back to booked` } } });
  }
}

module.exports = { derive, listTables, getTable, createTable, updateTable, assertTableUsable, claimTable, releaseTable, createReservation, updateReservation,
  cancelReservation, noShowReservation, completeReservation, seatReservation, listReservations, onOrderFinished };
