const { z } = require('zod');
const { Guest, Reservation, Complaint, Folio, Payment, Property, Counter } = require('../models');
const { audit } = require('../services/audit');
const { wrap, parse, escapeRegex } = require('../utils/wrap');
const { notFound, conflict } = require('../utils/ApiError');

const guestSchema = z.object({
  firstName: z.string().min(1), lastName: z.string().optional(), phone: z.string().min(7, 'Enter a valid phone number'),
  email: z.string().email().optional().or(z.literal('')), address: z.string().optional(),
  corporate: z.object({ name: z.string().optional(), designation: z.string().optional(), contactNote: z.string().optional() }).optional(),
  travelAgent: z.object({ name: z.string().optional(), contactNote: z.string().optional() }).optional(),
  preferences: z.array(z.string()).optional(),
  documents: z.array(z.object({ type: z.string(), number: z.string().optional(), fileName: z.string().optional(), notes: z.string().optional() })).optional(),
  vip: z.boolean().optional(), blacklist: z.boolean().optional(), blacklistReason: z.string().optional(),
  marketingConsent: z.boolean().optional(), communicationPreferences: z.object({ whatsapp: z.boolean(), sms: z.boolean(), email: z.boolean() }).optional(),
  notes: z.string().optional(),
});
const norm = (p = '') => p.replace(/[^\d+]/g, '');

/** Configurable repeat-guest matching (TBC Q16): Property.settings.repeatGuestMatch = any of phone/email/name/document. */
async function findMatches({ phone, email, firstName, lastName, documentNumber }, excludeId) {
  const prop = await Property.findOne(); const rules = prop?.settings?.repeatGuestMatch || ['phone'];
  const or = [];
  if (rules.includes('phone') && phone) or.push({ phone: norm(phone) }, { phone });
  if (rules.includes('email') && email) or.push({ email: email.toLowerCase() });
  if (rules.includes('name') && firstName) or.push({ firstName: new RegExp(`^${escapeRegex(firstName)}$`, 'i'), lastName: new RegExp(`^${escapeRegex(lastName || '')}$`, 'i') });
  if (rules.includes('document') && documentNumber) or.push({ 'documents.number': documentNumber });
  if (!or.length) return [];
  return Guest.find({ $or: or, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).limit(5);
}

async function statsFor(ids) {
  // Computed in JS (hotel-scale data) to stay portable across MongoDB-compatible servers.
  const rows = await Reservation.find({ guest: { $in: ids }, status: { $in: ['Checked In', 'Checked Out'] } }).select('guest checkIn');
  const map = new Map();
  rows.forEach((r) => { const k = String(r.guest); const s = map.get(k) || { stays: 0, lastStay: null }; s.stays += 1; if (!s.lastStay || r.checkIn > s.lastStay) s.lastStay = r.checkIn; map.set(k, s); });
  return map;
}

exports.list = wrap(async (req, res) => {
  const { q, vip, repeat, outstanding, blacklist } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Number(req.query.limit) || 25);
  const f = {};
  if (q) { const rx = new RegExp(escapeRegex(q), 'i'); f.$or = [{ firstName: rx }, { lastName: rx }, { phone: rx }, { guestId: rx }, { email: rx }, { 'corporate.name': rx }]; }
  if (vip === 'true') f.vip = true;
  if (blacklist === 'true') f.blacklist = true;
  if (outstanding === 'true') f.outstandingBalance = { $gt: 0 };
  let guests = await Guest.find(f).sort({ createdAt: -1 });
  const stats = await statsFor(guests.map((g) => g._id));
  let rows = guests.map((g) => { const s = stats.get(String(g._id)); return { ...g.toObject(), stays: s?.stays || 0, lastStay: s?.lastStay || null, isRepeat: false }; });
  // repeat = guest has at least one completed stay (so a returning booking is a repeat guest)
  rows = rows.map((r) => ({ ...r, isRepeat: r.stays >= 1 }));
  if (repeat === 'true') rows = rows.filter((r) => r.isRepeat);
  const total = rows.length;
  res.json({ success: true, data: rows.slice((page - 1) * limit, page * limit), total, page, pages: Math.ceil(total / limit) });
});

exports.match = wrap(async (req, res) => res.json({ success: true, data: await findMatches(req.query) }));

exports.create = wrap(async (req, res) => {
  const b = parse(guestSchema, req.body);
  b.phone = norm(b.phone);
  const matches = await findMatches({ ...b, documentNumber: b.documents?.[0]?.number });
  if (matches.length && req.query.force !== 'true') throw conflict('A guest matching the configured repeat-guest rule already exists', matches.map((m) => ({ id: m._id, guestId: m.guestId, name: m.fullName, phone: m.phone })));
  const g = await Guest.create({ ...b, guestId: await Counter.next('G', 4, 'G') });
  await audit(req, { action: 'create', module: 'Guests', entity: 'Guest', entityId: g._id, entityLabel: `${g.guestId} ${g.fullName}`, newValue: g });
  res.status(201).json({ success: true, data: g });
});

exports.get = wrap(async (req, res) => {
  const g = await Guest.findById(req.params.id); if (!g) throw notFound('Guest not found');
  const stays = await Reservation.find({ guest: g._id }).sort({ checkIn: -1 }).populate('room', 'roomNumber').populate('roomCategory', 'name').populate('folio', 'folioNumber totalCharges totalPaid outstanding');
  const complaints = await Complaint.find({ guest: g._id }).sort({ createdAt: -1 }).populate('room', 'roomNumber');
  const folios = await Folio.find({ guest: g._id }).sort({ createdAt: -1 }).populate('reservation', 'reservationNumber');
  const payments = await Payment.find({ guest: g._id }).sort({ receivedAt: -1 }).limit(50);
  const completed = stays.filter((s) => ['Checked In', 'Checked Out'].includes(s.status)).length;
  const paid = folios.reduce((s, f) => s + f.totalPaid, 0);
  const folioDue = folios.filter((f) => f.reservation && f.outstanding > 0).reduce((s, f) => s + f.outstanding, 0);
  res.json({ success: true, data: { ...g.toObject(), isRepeat: completed >= 1, stays, complaints, payments: { folios, payments, paid, outstanding: g.outstandingBalance, openFolioDue: folioDue } } });
});

exports.update = wrap(async (req, res) => {
  const g = await Guest.findById(req.params.id); if (!g) throw notFound('Guest not found');
  const b = parse(guestSchema.partial(), req.body); if (b.phone) b.phone = norm(b.phone);
  if (b.blacklist && !b.blacklistReason && !g.blacklistReason) b.blacklistReason = 'Not specified';
  const before = g.toObject(); Object.assign(g, b); await g.save();
  await audit(req, { action: 'update', module: 'Guests', entity: 'Guest', entityId: g._id, entityLabel: `${g.guestId} ${g.fullName}`, oldValue: before, newValue: g });
  res.json({ success: true, data: g });
});
