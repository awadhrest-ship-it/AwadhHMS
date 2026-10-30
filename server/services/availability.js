const { Room, Reservation } = require('../models');
const { SELLABLE_STATUSES } = require('../config/permissions');
const { toDate, addDays, DAY } = require('../utils/dates');
const { conflict, bad } = require('../utils/ApiError');

const ACTIVE = ['Pending', 'Confirmed', 'Checked In'];

// Per-room in-process lock to serialise concurrent booking attempts on one node.
// NOTE: for multi-instance deployments use a DB-level reservation lock / transaction (replica set).
const locks = new Map();
async function withRoomLock(roomId, fn) {
  const key = String(roomId);
  const prev = locks.get(key) || Promise.resolve();
  let release; const next = new Promise((r) => (release = r));
  locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); }
}

/** Reservations on a room overlapping [checkIn, checkOut). Half-open: same-day turnover is allowed. */
function findConflicts(roomId, checkIn, checkOut, excludeId) {
  const q = { room: roomId, status: { $in: ACTIVE }, checkIn: { $lt: toDate(checkOut) }, checkOut: { $gt: toDate(checkIn) } };
  if (excludeId) q._id = { $ne: excludeId };
  return Reservation.find(q).populate('guest', 'firstName lastName').select('reservationNumber checkIn checkOut status guest');
}

/** Server-side validation used by create / edit / assign-room / check-in. Throws 409 with a clear message. */
async function assertRoomBookable(roomId, checkIn, checkOut, excludeId) {
  const room = await Room.findById(roomId);
  if (!room || !room.active) throw bad('Room not found or inactive');
  if (room.blocked || room.status === 'Blocked') throw conflict(`Room ${room.roomNumber} is blocked and cannot be booked`);
  if (room.outOfOrder || room.status === 'Out of Order') throw conflict(`Room ${room.roomNumber} is out of order and cannot be booked`);
  if (room.status === 'Maintenance Required') throw conflict(`Room ${room.roomNumber} requires maintenance`);
  const clashes = await findConflicts(room._id, checkIn, checkOut, excludeId);
  if (clashes.length) {
    const c = clashes[0];
    throw conflict(`Room ${room.roomNumber} is already booked for these dates (${c.reservationNumber}, ${c.checkIn.toISOString().slice(0, 10)} to ${c.checkOut.toISOString().slice(0, 10)})`,
      clashes.map((x) => ({ reservationNumber: x.reservationNumber, checkIn: x.checkIn, checkOut: x.checkOut })));
  }
  return room;
}

/** Rooms free for the period (optionally one category). */
async function availableRooms({ checkIn, checkOut, categoryId, excludeReservationId }) {
  const roomQ = { active: true, blocked: false, outOfOrder: false, status: { $in: SELLABLE_STATUSES } };
  if (categoryId) roomQ.category = categoryId;
  const rooms = await Room.find(roomQ).populate('category', 'name basePrice extraBedCharge capacity').sort({ roomNumber: 1 });
  const busy = await Reservation.find({
    status: { $in: ACTIVE }, room: { $in: rooms.map((r) => r._id) },
    checkIn: { $lt: toDate(checkOut) }, checkOut: { $gt: toDate(checkIn) },
    ...(excludeReservationId ? { _id: { $ne: excludeReservationId } } : {}),
  }).select('room');
  const busySet = new Set(busy.map((b) => String(b.room)));
  return rooms.filter((r) => !busySet.has(String(r._id)));
}

/** Calendar grid: for each room and day -> state. */
async function calendar({ from, days = 7 }) {
  const start = toDate(from), end = addDays(start, days);
  const rooms = await Room.find({ active: true }).populate('category', 'name').sort({ roomNumber: 1 });
  const res = await Reservation.find({ status: { $in: ACTIVE }, checkIn: { $lt: end }, checkOut: { $gt: start } })
    .populate('guest', 'firstName lastName').select('reservationNumber room guest checkIn checkOut status');
  const byRoom = new Map();
  res.forEach((r) => { if (r.room) { const k = String(r.room); (byRoom.get(k) || byRoom.set(k, []).get(k)).push(r); } });
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));
  const grid = rooms.map((room) => ({
    roomId: room._id, roomNumber: room.roomNumber, floor: room.floor, category: room.category?.name,
    days: dayList.map((d) => {
      const hit = (byRoom.get(String(room._id)) || []).find((r) => r.checkIn <= d && r.checkOut > d);
      if (hit) return { state: hit.status === 'Checked In' ? 'Occupied' : 'Reserved', reservationId: hit._id, reservationNumber: hit.reservationNumber, guest: hit.guest ? `${hit.guest.firstName} ${hit.guest.lastName || ''}`.trim() : null };
      if (room.blocked || room.outOfOrder) return { state: room.outOfOrder ? 'Out of Order' : 'Blocked' }; // current flag shown across window
      return { state: 'Available' };
    }),
  }));
  const summary = dayList.map((d, i) => ({ date: d, available: grid.filter((g) => g.days[i].state === 'Available').length }));
  return { from: start, days, dates: dayList, rooms: grid, summary };
}

module.exports = { ACTIVE, withRoomLock, findConflicts, assertRoomBookable, availableRooms, calendar, DAY };
