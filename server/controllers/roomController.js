const { z } = require('zod');
const { Room, RoomCategory, Reservation } = require('../models');
const { ROOM_STATUSES } = require('../config/permissions');
const { audit } = require('../services/audit');
const availability = require('../services/availability');
const { setRoomStatus, hold, release } = require('../services/roomStatus');
const checklist = require('../services/checklist');
const { wrap, parse, escapeRegex } = require('../utils/wrap');
const { bad, notFound, conflict } = require('../utils/ApiError');
const { todayStr, toDate } = require('../utils/dates');

/* ---- categories ---- */
const catSchema = z.object({
  name: z.string().min(2), description: z.string().optional(), capacity: z.number().int().min(1), amenities: z.array(z.string()).optional(),
  photos: z.array(z.string()).optional(), basePrice: z.number().min(0), extraBedCharge: z.number().min(0).optional(), active: z.boolean().optional(),
});
exports.listCategories = wrap(async (_req, res) => res.json({ success: true, data: await RoomCategory.find().sort({ basePrice: 1 }) }));
exports.createCategory = wrap(async (req, res) => {
  const c = await RoomCategory.create(parse(catSchema, req.body));
  await audit(req, { action: 'create', module: 'Rooms', entity: 'RoomCategory', entityId: c._id, entityLabel: c.name, newValue: c });
  res.status(201).json({ success: true, data: c });
});
exports.updateCategory = wrap(async (req, res) => {
  const c = await RoomCategory.findById(req.params.id); if (!c) throw notFound('Category not found');
  const before = c.toObject(); Object.assign(c, parse(catSchema.partial(), req.body)); await c.save();
  await audit(req, { action: 'update', module: 'Rooms', entity: 'RoomCategory', entityId: c._id, entityLabel: c.name, oldValue: before, newValue: c });
  res.json({ success: true, data: c });
});

/* ---- rooms ---- */
const roomSchema = z.object({
  roomNumber: z.string().min(1), floor: z.number().int(), category: z.string().length(24), amenities: z.array(z.string()).optional(),
  photos: z.array(z.string()).optional(), capacity: z.number().int().min(1).optional(), extraBedCharge: z.number().min(0).optional(), active: z.boolean().optional(),
});
exports.listRooms = wrap(async (req, res) => {
  const { floor, category, status, q } = req.query;
  const f = { active: req.query.includeInactive === 'true' ? { $in: [true, false] } : true };
  if (floor) f.floor = Number(floor);
  if (category) f.category = category;
  if (status) f.status = status;
  let rooms = await Room.find(f).populate('category', 'name basePrice').select('-history').sort({ roomNumber: 1 });
  if (q) { const rx = new RegExp(escapeRegex(q), 'i'); rooms = rooms.filter((r) => rx.test(r.roomNumber) || rx.test(r.category?.name || '')); }
  // attach current / next reservation for the grid
  const ids = rooms.map((r) => r._id), t = toDate(todayStr());
  const cur = await Reservation.find({ room: { $in: ids }, status: { $in: ['Checked In', 'Confirmed'] }, checkOut: { $gt: t } }).sort({ checkIn: 1 })
    .populate('guest', 'firstName lastName').select('room guest status checkIn checkOut reservationNumber');
  const map = new Map(); cur.forEach((r) => { if (!map.has(String(r.room))) map.set(String(r.room), r); });
  res.json({ success: true, data: rooms.map((r) => ({ ...r.toObject(), booking: map.get(String(r._id)) || null })) });
});
exports.getRoom = wrap(async (req, res) => {
  const room = await Room.findById(req.params.id).populate('category'); if (!room) throw notFound('Room not found');
  const current = await Reservation.findOne({ room: room._id, status: 'Checked In' }).populate('guest', 'firstName lastName phone');
  const upcoming = await Reservation.find({ room: room._id, status: { $in: ['Confirmed', 'Pending'] }, checkOut: { $gt: toDate(todayStr()) } }).sort({ checkIn: 1 }).limit(5).populate('guest', 'firstName lastName');
  const past = await Reservation.find({ room: room._id, status: { $in: ['Checked Out'] } }).sort({ checkOut: -1 }).limit(10).populate('guest', 'firstName lastName');
  if (checklist.ensure(room)) await room.save(); // legacy rooms: store the default checklist / fix stale ticks on ready rooms
  const obj = room.toObject();
  res.json({ success: true, data: { ...obj, currentReservation: current, upcoming, stayHistory: past } });
});
exports.createRoom = wrap(async (req, res) => {
  const b = parse(roomSchema, req.body);
  const cat = await RoomCategory.findById(b.category); if (!cat) throw bad('Category not found');
  const room = await Room.create({ capacity: cat.capacity, extraBedCharge: cat.extraBedCharge, amenities: cat.amenities, ...b });
  await audit(req, { action: 'create', module: 'Rooms', entity: 'Room', entityId: room._id, entityLabel: room.roomNumber, newValue: room });
  res.status(201).json({ success: true, data: room });
});
exports.updateRoom = wrap(async (req, res) => {
  const room = await Room.findById(req.params.id); if (!room) throw notFound('Room not found');
  const b = parse(roomSchema.partial(), req.body);
  if (b.category) { if (!(await RoomCategory.exists({ _id: b.category }))) throw bad('Category not found'); }
  const before = room.toObject(); Object.assign(room, b); await room.save();
  await audit(req, { action: 'update', module: 'Rooms', entity: 'Room', entityId: room._id, entityLabel: room.roomNumber, oldValue: before, newValue: room });
  res.json({ success: true, data: room });
});
exports.deleteRoom = wrap(async (req, res) => {
  const room = await Room.findById(req.params.id); if (!room) throw notFound('Room not found');
  const used = await Reservation.exists({ room: room._id, status: { $in: ['Pending', 'Confirmed', 'Checked In'] } });
  if (used) throw conflict('Room has active reservations. Move or cancel them first.');
  const before = room.toObject(); room.active = false; await room.save(); // soft delete keeps history
  await audit(req, { action: 'delete', module: 'Rooms', entity: 'Room', entityId: room._id, entityLabel: room.roomNumber, oldValue: before, newValue: { active: false } });
  res.json({ success: true });
});

// PATCH /rooms/:id/status  { status, reason }  -- also handles block / unblock / out-of-order / restore
exports.changeStatus = wrap(async (req, res) => {
  const { status, reason } = parse(z.object({ status: z.enum(ROOM_STATUSES), reason: z.string().optional() }), req.body);
  const room = await Room.findById(req.params.id); if (!room) throw notFound('Room not found');
  const before = room.toObject();
  if (status === 'Available') checklist.assertComplete(room); // housekeeping checklist must be fully ticked first
  if (status === 'Blocked' || status === 'Out of Order') await hold(room, status, req, reason);
  else if (['Blocked', 'Out of Order'].includes(room.status)) {
    if (status !== 'Vacant & Clean' && status !== 'Available') throw bad('Use unblock / restore to release this room first');
    await release(room, req); if (room.status !== status) await setRoomStatus(room, status, req, { reason });
  } else {
    if (room.status === 'Occupied' && status !== 'Occupied') throw bad('Occupied rooms change status through check-out');
    if (status === 'Occupied') throw bad('Rooms become Occupied through check-in');
    await setRoomStatus(room, status, req, { reason });
  }
  await audit(req, { action: 'status', module: 'Rooms', entity: 'Room', entityId: room._id, entityLabel: room.roomNumber, oldValue: { status: before.status, blocked: before.blocked, outOfOrder: before.outOfOrder }, newValue: { status: room.status, blocked: room.blocked, outOfOrder: room.outOfOrder }, note: reason });
  res.json({ success: true, data: room });
});

/* ---- housekeeping checklist (visible to anyone with rooms.view; changed with rooms.status) ---- */
exports.toggleChecklistItem = wrap(async (req, res) => {
  const { done } = parse(z.object({ done: z.boolean() }), req.body);
  const room = await Room.findById(req.params.id); if (!room) throw notFound('Room not found');
  checklist.ensure(room); checklist.assertOpen(room);
  const item = room.checklist.id(req.params.itemId); if (!item) throw notFound('Checklist item not found');
  item.done = done; item.doneBy = done ? req.user._id : undefined; item.doneByName = done ? req.user.name : undefined; item.doneAt = done ? new Date() : undefined;
  await room.save();
  res.json({ success: true, data: room.checklist });
});
exports.addChecklistItem = wrap(async (req, res) => {
  const { label } = parse(z.object({ label: z.string().trim().min(1).max(100) }), req.body);
  const room = await Room.findById(req.params.id); if (!room) throw notFound('Room not found');
  checklist.ensure(room); checklist.assertOpen(room);
  if (room.checklist.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw bad('That item is already on the checklist');
  room.checklist.push({ label, custom: true });
  await room.save();
  res.status(201).json({ success: true, data: room.checklist });
});
exports.deleteChecklistItem = wrap(async (req, res) => {
  const room = await Room.findById(req.params.id); if (!room) throw notFound('Room not found');
  checklist.ensure(room); checklist.assertOpen(room);
  const item = room.checklist.id(req.params.itemId); if (!item) throw notFound('Checklist item not found');
  if (!item.custom) throw bad('Standard checklist items cannot be removed');
  item.deleteOne(); await room.save();
  res.json({ success: true, data: room.checklist });
});

exports.availability = wrap(async (req, res) => {
  const q = parse(z.object({ checkIn: z.string().optional(), checkOut: z.string().optional(), category: z.string().optional(), from: z.string().optional(), days: z.coerce.number().int().min(1).max(31).optional(), reservation: z.string().optional() }), req.query);
  if (q.checkIn && q.checkOut) {
    if (toDate(q.checkOut) <= toDate(q.checkIn)) throw bad('Check-out must be after check-in');
    return res.json({ success: true, data: await availability.availableRooms({ checkIn: q.checkIn, checkOut: q.checkOut, categoryId: q.category, excludeReservationId: q.reservation }) });
  }
  res.json({ success: true, data: await availability.calendar({ from: q.from || todayStr(), days: q.days || 7 }) });
});