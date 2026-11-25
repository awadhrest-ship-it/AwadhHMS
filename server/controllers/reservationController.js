const { z } = require('zod');
const { Reservation, Guest } = require('../models');
const svc = require('../services/reservations');
const { audit } = require('../services/audit');
const { wrap, parse, escapeRegex } = require('../utils/wrap');
const { notFound } = require('../utils/ApiError');
const { toDate, todayStr, addDays } = require('../utils/dates');

const base = z.object({
  guest: z.string().length(24), room: z.string().length(24).nullish(), roomCategory: z.string().length(24).optional(),
  checkIn: z.string(), checkOut: z.string(), adults: z.number().int().min(1), children: z.number().int().min(0).optional(),
  extraBed: z.boolean().optional(), ratePlan: z.string().length(24).nullish(), source: z.string().optional(), specialRequests: z.string().optional(),
  advanceAmount: z.number().min(0).optional(), advanceMethod: z.string().optional(), status: z.enum(['Pending', 'Confirmed']).optional(),
});
const clean = (b) => ({ ...b, room: b.room || undefined, ratePlan: b.ratePlan || undefined });

exports.list = wrap(async (req, res) => {
  const { status, room, guest, from, to, q, arrivals, departures } = req.query;
  const f = {};
  if (status) f.status = { $in: String(status).split(',') };
  if (room) f.room = room;
  if (guest) f.guest = guest;
  if (from || to) { f.checkIn = {}; if (from) f.checkIn.$gte = toDate(from); if (to) f.checkIn.$lte = toDate(to); }
  if (arrivals === 'today') { f.checkIn = toDate(todayStr()); f.status = { $in: ['Pending', 'Confirmed', 'Checked In'] }; }
  if (departures === 'today') { f.checkOut = toDate(todayStr()); f.status = { $in: ['Checked In', 'Checked Out'] }; }
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const gs = await Guest.find({ $or: [{ firstName: rx }, { lastName: rx }, { phone: rx }, { guestId: rx }] }).select('_id');
    f.$or = [{ reservationNumber: rx }, { guest: { $in: gs.map((g) => g._id) } }];
  }
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Number(req.query.limit) || 50);
  const [data, total] = await Promise.all([
    Reservation.find(f).sort({ checkIn: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate(svc.populate),
    Reservation.countDocuments(f),
  ]);
  res.json({ success: true, data, total, page, pages: Math.ceil(total / limit) });
});
exports.get = wrap(async (req, res) => {
  const r = await svc.load(req.params.id); if (!r) throw notFound('Reservation not found');
  res.json({ success: true, data: r });
});
exports.create = wrap(async (req, res) => res.status(201).json({ success: true, data: await svc.create(req, clean(parse(base, req.body))) }));
exports.update = wrap(async (req, res) => {
  const b = parse(base.partial().omit({ guest: true, advanceAmount: true, advanceMethod: true, status: true }).extend({ confirm: z.boolean().optional() }), req.body);
  const { reservation, approval } = await svc.update(req, req.params.id, { ...b, room: b.room === null ? null : b.room });
  res.json({ success: true, data: reservation, approvalRequired: !!approval, approval, message: approval ? 'Price change submitted for approval' : 'Reservation updated' });
});
exports.cancel = wrap(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().min(3, 'Enter a cancellation reason') }), req.body);
  const ar = await svc.requestCancellation(req, req.params.id, reason);
  res.status(202).json({ success: true, approvalRequired: true, data: ar, message: 'Cancellation submitted for approval' });
});
exports.priceChange = wrap(async (req, res) => {
  const { nightlyRate, reason } = parse(z.object({ nightlyRate: z.number().min(0), reason: z.string().optional() }), req.body);
  const ar = await svc.requestRateOverride(req, req.params.id, nightlyRate, reason);
  res.status(202).json({ success: true, approvalRequired: true, data: ar, message: 'Price change submitted for approval' });
});
exports.checkIn = wrap(async (req, res) => {
  const b = parse(z.object({ room: z.string().length(24).optional(), idVerified: z.boolean(), allowCategoryChange: z.boolean().optional(), document: z.object({ type: z.string(), number: z.string().optional(), fileName: z.string().optional() }).optional() }), req.body);
  res.json({ success: true, data: await svc.checkIn(req, req.params.id, b), message: 'Guest checked in' });
});
exports.checkOut = wrap(async (req, res) => {
  const b = parse(z.object({ allowOutstanding: z.boolean().optional() }), req.body || {});
  res.json({ success: true, data: await svc.checkOut(req, req.params.id, b), message: 'Guest checked out' });
});
