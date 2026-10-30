const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const STATUSES = ['Booked', 'Seated', 'Completed', 'Cancelled', 'No-show'];
const schema = new Schema({
  reservationNumber: { type: String, unique: true },
  guestName: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  guest: ref('Guest'),                       // optional link to an existing guest profile
  partySize: { type: Number, required: true, min: 1 },
  table: { ...ref('RestaurantTable'), required: true, index: true },
  tableNumber: String,                       // snapshot
  startsAt: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, required: true, min: 15 },
  endsAt: { type: Date, required: true },
  businessDate: { type: String, index: true },
  status: { type: String, enum: STATUSES, default: 'Booked', index: true },
  notes: String,
  order: ref('RestaurantOrder'),             // set when the party is seated
  cancelReason: String,
  history: [{ _id: false, at: Date, by: ref('User'), byName: String, action: String, note: String }],
  createdBy: ref('User'),
}, { timestamps: true });
schema.index({ table: 1, startsAt: 1 });
const M = model('RestaurantReservation', schema); M.STATUSES = STATUSES; M.LIVE = ['Booked', 'Seated'];
module.exports = M;
