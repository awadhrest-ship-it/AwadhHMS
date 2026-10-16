const { Reservation, Room, Guest, Folio, Payment, Property, Counter } = require('../models');
const { quote } = require('./pricing');
const { assertRoomBookable, withRoomLock } = require('./availability');
const { setRoomStatus } = require('./roomStatus');
const { audit } = require('./audit');
const { notify } = require('./notify');
const events = require('./events');
const approvals = require('./approvals');
const { toDate, today, fmt } = require('../utils/dates');
const { bad, conflict, notFound } = require('../utils/ApiError');

const populate = [
  { path: 'guest', select: 'guestId firstName lastName phone email vip blacklist outstandingBalance marketingConsent' },
  { path: 'room', select: 'roomNumber floor status category', populate: { path: 'category', select: 'name' } },
  { path: 'roomCategory', select: 'name basePrice extraBedCharge' },
  { path: 'ratePlan', select: 'name type' },
  { path: 'folio', select: 'folioNumber totalCharges totalPaid outstanding status' },
];
const load = (id) => Reservation.findById(id).populate(populate);
const label = (r) => `${r.reservationNumber}`;

async function refreshPaymentStatus(reservation) {
  if (!reservation.folio) return;
  const folio = await Folio.findById(reservation.folio);
  await folio.recalc(); await folio.save();
  const due = Math.max(reservation.totalAmount, folio.totalCharges);
  reservation.paymentStatus = folio.totalPaid <= 0 ? 'Pending' : folio.totalPaid >= due ? 'Paid' : 'Part-paid';
  await reservation.save();
}

/** Reserved status: the room is flagged Reserved only when arrival is today/past (so it is not unsellable today for a future stay). */
async function syncReservedFlag(room, reservation, req) {
  if (!room) return;
  const r = await Room.findById(room._id || room);
  if (reservation.checkIn <= today() && ['Available', 'Vacant & Clean'].includes(r.status)) {
    await setRoomStatus(r, 'Reserved', req, { reason: `Reservation ${reservation.reservationNumber}`, action: 'reserve' });
  }
}

async function create(req, body) {
  const guest = await Guest.findById(body.guest);
  if (!guest) throw bad('Guest not found');
  if (guest.blacklist) throw conflict(`Guest is blacklisted${guest.blacklistReason ? ': ' + guest.blacklistReason : ''}`);
  const prop = await Property.findOne();
  const room = body.room ? await Room.findById(body.room) : null;
  const categoryId = room ? room.category : body.roomCategory;
  if (!categoryId) throw bad('Select a room or a room category');
  if (toDate(body.checkOut) <= toDate(body.checkIn)) throw bad('Check-out must be after check-in');
  if (toDate(body.checkIn) < today() && !(req.permissions.has('reservations.edit'))) throw bad('Check-in date is in the past');
  if (body.advanceAmount && body.advanceAmount > 0 && !(prop.settings.paymentMethods || []).includes(body.advanceMethod)) throw bad('Select a valid payment method for the advance');
  const q = await quote({ categoryId, ratePlanId: body.ratePlan, checkIn: body.checkIn, checkOut: body.checkOut, adults: body.adults, children: body.children, extraBed: body.extraBed, clientName: guest.corporate?.name || guest.travelAgent?.name, source: body.source });
  const build = async () => {
    if (room) await assertRoomBookable(room._id, body.checkIn, body.checkOut);
    const reservation = await Reservation.create({
      reservationNumber: await Counter.next('RES', 4),
      guest: guest._id, room: room?._id, roomCategory: categoryId,
      checkIn: toDate(body.checkIn), checkOut: toDate(body.checkOut), adults: body.adults, children: body.children || 0, extraBed: !!body.extraBed,
      ratePlan: body.ratePlan, nightlyRate: q.nightlyRate, rateBreakdown: q.breakdown, numberOfNights: q.nights,
      extraBedAmount: q.extraBedAmount, subtotal: q.subtotal, taxAmount: q.taxAmount, totalAmount: q.total,
      advanceAmount: body.advanceAmount || 0, status: body.status || (room ? 'Confirmed' : 'Pending'),
      specialRequests: body.specialRequests, source: body.source || 'Walk-in', createdBy: req.user._id,
    });
    const folio = await Folio.create({ folioNumber: await Counter.next('FOL', 4), reservation: reservation._id, guest: guest._id, room: room?._id });
    reservation.folio = folio._id; await reservation.save();
    if (body.advanceAmount > 0) {
      await Payment.create({ folio: folio._id, guest: guest._id, reservation: reservation._id, amount: body.advanceAmount, kind: 'Advance', method: body.advanceMethod, receivedBy: req.user._id });
      await refreshPaymentStatus(reservation);
    }
    return reservation;
  };
  const reservation = room ? await withRoomLock(room._id, build) : await build();
  if (room && reservation.status === 'Confirmed') await syncReservedFlag(room, reservation, req);
  await audit(req, { action: 'create', module: 'Reservations', entity: 'Reservation', entityId: reservation._id, entityLabel: label(reservation), newValue: reservation });
  if (!room) await notify({ type: 'pending_checkin', title: 'Booking needs a room', message: `${reservation.reservationNumber} has no room assigned`, link: `/reservations/${reservation._id}`, severity: 'warning', permission: 'reservations.checkin' });
  return load(reservation._id);
}

/** Edit: room/date changes are re-validated server side. nightlyRate changes go through approval (never applied directly). */
async function update(req, id, body) {
  const r = await Reservation.findById(id);
  if (!r) throw notFound('Reservation not found');
  if (['Cancelled', 'Checked Out'].includes(r.status)) throw bad(`A ${r.status.toLowerCase()} reservation cannot be edited`);
  if (r.pendingApproval) throw conflict('This reservation has an approval request pending. Resolve it before editing.');
  const before = r.toObject();
  const out = { updated: null, approval: null };
  const roomId = body.room !== undefined ? body.room : r.room;
  const checkIn = body.checkIn ? toDate(body.checkIn) : r.checkIn, checkOut = body.checkOut ? toDate(body.checkOut) : r.checkOut;
  if (checkOut <= checkIn) throw bad('Check-out must be after check-in');
  if (r.status === 'Checked In' && (body.checkIn || body.room) && String(body.room || r.room) !== String(r.room)) throw bad('Use room change after check-in via a new assignment (not supported yet)');
  const datesChanged = fmt(checkIn) !== fmt(r.checkIn) || fmt(checkOut) !== fmt(r.checkOut);
  const roomChanged = String(roomId || '') !== String(r.room || '');

  const apply = async () => {
    if (roomId && (datesChanged || roomChanged)) await assertRoomBookable(roomId, checkIn, checkOut, r._id);
    const oldRoom = r.room;
    let categoryId = r.roomCategory;
    if (roomId) { const room = await Room.findById(roomId); categoryId = room.category; }
    else if (body.roomCategory) categoryId = body.roomCategory;
    const repricing = datesChanged || body.adults || body.children !== undefined || body.extraBed !== undefined || body.ratePlan !== undefined || String(categoryId) !== String(r.roomCategory);
    if (repricing) {
      const guest = await Guest.findById(r.guest);
      const q = await quote({ categoryId, ratePlanId: body.ratePlan !== undefined ? body.ratePlan : r.ratePlan, checkIn, checkOut, adults: body.adults ?? r.adults, children: body.children ?? r.children, extraBed: body.extraBed ?? r.extraBed, clientName: guest.corporate?.name || guest.travelAgent?.name, source: r.source });
      // A change of dates/rate plan that alters the *rate* of a confirmed booking is a price change -> approval.
      const priceDelta = q.total !== r.totalAmount;
      const dateOnly = priceDelta && !body.ratePlan && body.ratePlan !== null && q.nightlyRate === r.nightlyRate;
      if (priceDelta && !dateOnly && !body._approved) {
        const err = await approvals.createRequest(req, { type: 'Booking price change', referenceModel: 'Reservation', referenceId: r._id, referenceLabel: `${r.reservationNumber}`, amount: Math.abs(q.total - r.totalAmount), payload: { body: { ...body, room: roomId, checkIn: fmt(checkIn), checkOut: fmt(checkOut) }, oldTotal: r.totalAmount, newTotal: q.total } });
        r.pendingApproval = true; await r.save(); out.approval = err; return;
      }
      Object.assign(r, { nightlyRate: q.nightlyRate, rateBreakdown: q.breakdown, numberOfNights: q.nights, extraBedAmount: q.extraBedAmount, subtotal: q.subtotal, taxAmount: q.taxAmount, totalAmount: q.total });
      if (body.ratePlan !== undefined) r.ratePlan = body.ratePlan;
      if (body.adults) r.adults = body.adults; if (body.children !== undefined) r.children = body.children; if (body.extraBed !== undefined) r.extraBed = body.extraBed;
    }
    r.checkIn = checkIn; r.checkOut = checkOut; r.roomCategory = categoryId;
    if (roomId !== undefined) r.room = roomId || undefined;
    if (body.specialRequests !== undefined) r.specialRequests = body.specialRequests;
    if (body.source) r.source = body.source;
    if (r.status === 'Pending' && r.room && body.confirm) r.status = 'Confirmed';
    await r.save();
    if (roomChanged && oldRoom && r.status === 'Confirmed') { // free the previously reserved room if nothing else holds it
      const prev = await Room.findById(oldRoom);
      if (prev?.status === 'Reserved') await setRoomStatus(prev, 'Available', req, { reason: `Reservation ${r.reservationNumber} moved`, action: 'release' });
    }
    if (r.room && r.status === 'Confirmed') await syncReservedFlag(r.room, r, req);
    if (r.folio) await Folio.updateOne({ _id: r.folio }, { room: r.room });
    await refreshPaymentStatus(r);
    out.updated = true;
  };
  if (roomId) await withRoomLock(roomId, apply); else await apply();
  const after = await load(id);
  if (out.updated) await audit(req, { action: 'update', module: 'Reservations', entity: 'Reservation', entityId: r._id, entityLabel: label(r), oldValue: before, newValue: after });
  return { reservation: after, approval: out.approval };
}

async function requestCancellation(req, id, reason) {
  const r = await Reservation.findById(id);
  if (!r) throw notFound('Reservation not found');
  if (!['Pending', 'Confirmed'].includes(r.status)) throw bad(`Only pending or confirmed bookings can be cancelled (this one is ${r.status})`);
  if (!reason?.trim()) throw bad('A cancellation reason is required');
  const ar = await approvals.createRequest(req, { type: 'Booking cancellation', referenceModel: 'Reservation', referenceId: r._id, referenceLabel: r.reservationNumber, amount: r.totalAmount, payload: { reason }, comments: reason });
  r.pendingApproval = true; await r.save();
  await notify({ type: 'booking_cancellation', title: 'Cancellation awaiting approval', message: `${r.reservationNumber} - ${reason}`, link: '/approvals', severity: 'warning', permission: 'approvals.approve' });
  return ar;
}

/* ---- approval handlers (what actually happens once an approver says yes) ---- */
approvals.registerHandler('Booking cancellation', {
  async apply(ar, req) {
    const r = await Reservation.findById(ar.referenceId); if (!r) return;
    const before = r.toObject();
    r.status = 'Cancelled'; r.cancelledAt = new Date(); r.cancellationReason = ar.payload?.reason; r.pendingApproval = false; await r.save();
    if (r.room) { const room = await Room.findById(r.room); if (room?.status === 'Reserved') await setRoomStatus(room, 'Available', req, { reason: `${r.reservationNumber} cancelled`, action: 'release' }); }
    await audit(req, { action: 'status', module: 'Reservations', entity: 'Reservation', entityId: r._id, entityLabel: label(r), oldValue: { status: before.status }, newValue: { status: 'Cancelled' }, note: 'Cancellation approved' });
  },
  async onReject(ar) { await Reservation.updateOne({ _id: ar.referenceId }, { pendingApproval: false }); },
});
approvals.registerHandler('Booking price change', {
  async apply(ar, req) {
    const r = await Reservation.findById(ar.referenceId); if (!r) return;
    r.pendingApproval = false; await r.save();
    const payload = ar.payload || {};
    if (payload.directRate != null) { // explicit nightly-rate override
      const before = r.toObject();
      const nights = r.numberOfNights, sub = payload.directRate * nights + r.extraBedAmount;
      r.nightlyRate = payload.directRate; r.rateBreakdown = r.rateBreakdown.map((b) => ({ date: b.date, rate: payload.directRate }));
      r.subtotal = sub; r.totalAmount = sub + r.taxAmount; await r.save();
      if (r.folio) await refreshPaymentStatus(r);
      await audit(req, { action: 'update', module: 'Reservations', entity: 'Reservation', entityId: r._id, entityLabel: label(r), oldValue: { nightlyRate: before.nightlyRate, totalAmount: before.totalAmount }, newValue: { nightlyRate: r.nightlyRate, totalAmount: r.totalAmount }, note: 'Price change approved' });
    } else if (payload.body) {
      await update(req, r._id, { ...payload.body, _approved: true });
    }
  },
  async onReject(ar) { await Reservation.updateOne({ _id: ar.referenceId }, { pendingApproval: false }); },
});

async function requestRateOverride(req, id, newNightlyRate, reason) {
  const r = await Reservation.findById(id);
  if (!r) throw notFound('Reservation not found');
  if (['Cancelled', 'Checked Out'].includes(r.status)) throw bad('Cannot change price of a closed reservation');
  if (newNightlyRate == null || newNightlyRate < 0) throw bad('Enter a valid nightly rate');
  const ar = await approvals.createRequest(req, { type: 'Booking price change', referenceModel: 'Reservation', referenceId: r._id, referenceLabel: r.reservationNumber, amount: Math.abs(newNightlyRate - r.nightlyRate) * r.numberOfNights, payload: { directRate: newNightlyRate, oldRate: r.nightlyRate }, comments: reason });
  r.pendingApproval = true; await r.save();
  return ar;
}

async function postRoomCharges(req, r, folio) {
  const rows = r.rateBreakdown.length ? r.rateBreakdown : Array.from({ length: r.numberOfNights }, () => ({ rate: r.nightlyRate }));
  rows.forEach((b) => folio.charges.push({ type: 'Room', description: `Room charge${b.date ? ' ' + fmt(b.date) : ''}`, date: b.date || new Date(), unitPrice: b.rate, amount: b.rate, postedBy: req.user._id, source: 'check-in' }));
  if (r.extraBedAmount) folio.charges.push({ type: 'Extra Bed', description: `Extra bed x ${r.numberOfNights} nights`, unitPrice: r.extraBedAmount / r.numberOfNights, quantity: r.numberOfNights, amount: r.extraBedAmount, postedBy: req.user._id, source: 'check-in' });
  if (r.taxAmount) folio.charges.push({ type: 'Tax', description: 'Tax (rate TBC)', amount: r.taxAmount, postedBy: req.user._id, source: 'check-in' });
}

async function checkIn(req, id, body = {}) {
  const r = await Reservation.findById(id).populate('guest');
  if (!r) throw notFound('Reservation not found');
  if (r.status !== 'Confirmed') throw bad(`Only confirmed reservations can be checked in (this one is ${r.status})`);
  if (r.pendingApproval) throw conflict('An approval is pending on this reservation');
  if (r.guest.blacklist) throw conflict('Guest is blacklisted');
  if (!body.idVerified) throw bad('Confirm guest identity verification before check-in');
  const roomId = body.room || r.room;
  if (!roomId) throw bad('Assign a room before check-in');
  return withRoomLock(roomId, async () => {
    const room = await assertRoomBookable(roomId, r.checkIn, r.checkOut, r._id);
    if (String(room.category) !== String(r.roomCategory) && !body.allowCategoryChange) throw bad('Selected room is a different category from the booking. Confirm the category change to continue.');
    if (!['Available', 'Reserved', 'Vacant & Clean'].includes(room.status)) throw conflict(`Room ${room.roomNumber} is ${room.status} and not ready for a guest`);
    if (r.checkIn > today()) throw bad(`Arrival is on ${fmt(r.checkIn)}; early check-in is not allowed yet`); // early check-in rules TBC Q13
    const before = r.toObject();
    r.room = room._id; r.status = 'Checked In'; r.checkedInAt = new Date(); r.checkedInBy = req.user._id; r.idVerified = true;
    if (body.document?.type) {
      await Guest.updateOne({ _id: r.guest._id }, { $push: { documents: { type: body.document.type, number: body.document.number, fileName: body.document.fileName } } });
    }
    const folio = await Folio.findById(r.folio) || await Folio.create({ folioNumber: await Counter.next('FOL', 4), reservation: r._id, guest: r.guest._id });
    folio.room = room._id;
    if (!folio.charges.some((c) => c.source === 'check-in')) await postRoomCharges(req, r, folio);
    await folio.recalc(); await folio.save();
    r.folio = folio._id; await r.save();
    await setRoomStatus(room, 'Occupied', req, { reason: `Checked in ${r.reservationNumber}`, action: 'check-in' });
    await refreshPaymentStatus(r);
    await audit(req, { action: 'status', module: 'Front Desk', entity: 'Reservation', entityId: r._id, entityLabel: label(r), oldValue: { status: before.status, room: before.room }, newValue: { status: 'Checked In', room: room.roomNumber }, note: 'Check-in' });
    events.publish('checkin.completed', { reservationId: r._id, roomId: room._id });
    return load(r._id);
  });
}

async function checkOut(req, id, body = {}) {
  const r = await Reservation.findById(id);
  if (!r) throw notFound('Reservation not found');
  if (r.status !== 'Checked In') throw bad(`Only checked-in guests can be checked out (this one is ${r.status})`);
  const folio = await Folio.findById(r.folio); await folio.recalc();
  if (folio.outstanding > 0.009 && !body.allowOutstanding) throw conflict(`Outstanding balance of ${folio.outstanding} must be collected first`, { outstanding: folio.outstanding });
  const before = r.toObject();
  r.status = 'Checked Out'; r.checkedOutAt = new Date(); r.checkedOutBy = req.user._id; await r.save();
  folio.status = folio.outstanding > 0.009 ? 'Open' : 'Closed';
  await folio.save();
  if (folio.outstanding > 0.009) { await Guest.updateOne({ _id: r.guest }, { $inc: { outstandingBalance: folio.outstanding } }); await notify({ type: 'pending_payment', title: 'Checked out with balance due', message: `${r.reservationNumber}: ${folio.outstanding} outstanding`, link: `/bills/${folio._id}`, severity: 'warning', permission: 'bills.payment' }); }
  const room = await Room.findById(r.room);
  await setRoomStatus(room, 'Vacant & Dirty', req, { reason: `Checked out ${r.reservationNumber}`, action: 'check-out' });
  await refreshPaymentStatus(r);
  await audit(req, { action: 'status', module: 'Front Desk', entity: 'Reservation', entityId: r._id, entityLabel: label(r), oldValue: { status: before.status }, newValue: { status: 'Checked Out', outstanding: folio.outstanding }, note: 'Check-out' });
  // Phase 5 (Housekeeping) will consume this event to create the cleaning task. No housekeeping UI is built in Phase 1-3.
  events.publish('checkout.completed', { reservationId: r._id, roomId: room._id, roomNumber: room.roomNumber, guestId: r.guest, at: new Date() });
  return load(r._id);
}

module.exports = { create, update, requestCancellation, requestRateOverride, checkIn, checkOut, load, populate, refreshPaymentStatus };
