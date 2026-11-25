const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const schema = new Schema({
  reservationNumber: { type: String, unique: true },
  guest: { ...ref('Guest'), required: true, index: true },
  room: { ...ref('Room'), index: true },
  roomCategory: { ...ref('RoomCategory'), required: true },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  adults: { type: Number, default: 1, min: 1 },
  children: { type: Number, default: 0, min: 0 },
  extraBed: { type: Boolean, default: false },
  ratePlan: ref('RatePlan'),
  nightlyRate: { type: Number, required: true, min: 0 },
  rateBreakdown: [{ date: Date, rate: Number, _id: false }],
  numberOfNights: { type: Number, required: true },
  extraBedAmount: { type: Number, default: 0 },
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },   // TBC Q14
  totalAmount: { type: Number, default: 0 },
  advanceAmount: { type: Number, default: 0 }, // TBC Q12
  paymentStatus: { type: String, enum: ['Pending', 'Part-paid', 'Paid'], default: 'Pending' },
  status: { type: String, enum: ['Pending', 'Confirmed', 'Checked In', 'Checked Out', 'Cancelled'], default: 'Confirmed', index: true },
  specialRequests: String,
  source: { type: String, default: 'Walk-in' }, // TBC Q11
  folio: ref('Folio'),
  idVerified: { type: Boolean, default: false },
  createdBy: ref('User'),
  checkedInAt: Date, checkedInBy: ref('User'),
  checkedOutAt: Date, checkedOutBy: ref('User'),
  cancelledAt: Date, cancellationReason: String,
  pendingApproval: { type: Boolean, default: false }, // true while a cancel / price-change request is open
}, { timestamps: true });
schema.index({ room: 1, checkIn: 1, checkOut: 1 });
module.exports = model('Reservation', schema);
