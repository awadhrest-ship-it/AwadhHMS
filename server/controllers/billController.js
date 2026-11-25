const { z } = require('zod');
const { Folio, Payment, Property, Guest, Reservation } = require('../models');
const { audit } = require('../services/audit');
const { refreshPaymentStatus } = require('../services/reservations');
const { wrap, parse } = require('../utils/wrap');
const { notFound, bad } = require('../utils/ApiError');

const pop = [{ path: 'guest', select: 'guestId firstName lastName phone' }, { path: 'room', select: 'roomNumber' }, { path: 'reservation', select: 'reservationNumber checkIn checkOut status totalAmount' }];

exports.list = wrap(async (req, res) => {
  const f = {};
  if (req.query.status) f.status = req.query.status;
  if (req.query.due === 'true') f.outstanding = { $gt: 0 };
  const data = await Folio.find(f).sort({ createdAt: -1 }).limit(200).populate(pop);
  res.json({ success: true, data: data.filter((d) => d.reservation && (req.query.includeEmpty === 'true' || d.charges.length || d.totalPaid)) });
});
exports.get = wrap(async (req, res) => {
  const f = await Folio.findById(req.params.id).populate(pop); if (!f) throw notFound('Bill not found');
  const payments = await Payment.find({ folio: f._id }).sort({ receivedAt: -1 }).populate('receivedBy', 'name');
  res.json({ success: true, data: { ...f.toObject(), payments } });
});
exports.addPayment = wrap(async (req, res) => {
  const prop = await Property.findOne();
  const b = parse(z.object({ amount: z.number().positive(), method: z.string(), reference: z.string().optional() }), req.body);
  if (!prop.settings.paymentMethods.includes(b.method)) throw bad(`Payment method must be one of: ${prop.settings.paymentMethods.join(', ')}`);
  const f = await Folio.findById(req.params.id); if (!f) throw notFound('Bill not found');
  const before = { totalPaid: f.totalPaid, outstanding: f.outstanding };
  const p = await Payment.create({ folio: f._id, guest: f.guest, reservation: f.reservation, receivedBy: req.user._id, ...b });
  await f.recalc(); if (f.outstanding <= 0.009 && f.status === 'Open' && f.charges.length) { const r = await Reservation.findById(f.reservation); if (r?.status === 'Checked Out') f.status = 'Closed'; }
  await f.save();
  const r = await Reservation.findById(f.reservation); if (r) await refreshPaymentStatus(r);
  if (r?.status === 'Checked Out') { // settle guest-level outstanding after late payment
    const g = await Guest.findById(f.guest); g.outstandingBalance = Math.max(0, Math.round((g.outstandingBalance - b.amount) * 100) / 100); await g.save();
  }
  await audit(req, { action: 'create', module: 'Billing', entity: 'Payment', entityId: p._id, entityLabel: `${f.folioNumber} ${b.method} ${b.amount}`, oldValue: before, newValue: { totalPaid: f.totalPaid, outstanding: f.outstanding } });
  res.status(201).json({ success: true, data: f, message: 'Payment recorded' });
});
