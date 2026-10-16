const { Schema, model } = require('mongoose');
const chargeSchema = new Schema({
  type: { type: String, enum: ['Room', 'Extra Bed', 'Room Service', 'Tax', 'Other'], default: 'Other' }, // Room Service reserved for Phase 6
  description: String,
  date: { type: Date, default: Date.now },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  source: { type: String, default: 'front-desk' }, // future: 'restaurant-pos', 'night-audit'
  postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
const schema = new Schema({
  folioNumber: { type: String, unique: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', index: true },
  guest: { type: Schema.Types.ObjectId, ref: 'Guest', index: true },
  room: { type: Schema.Types.ObjectId, ref: 'Room' },
  charges: [chargeSchema],
  totalCharges: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  outstanding: { type: Number, default: 0 },
  status: { type: String, enum: ['Open', 'Settled', 'Closed'], default: 'Open' },
}, { timestamps: true });
schema.methods.recalc = async function () {
  const Payment = require('./Payment');
  this.totalCharges = Math.round(this.charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const agg = await Payment.aggregate([{ $match: { folio: this._id } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
  this.totalPaid = agg[0]?.t || 0;
  this.outstanding = Math.round((this.totalCharges - this.totalPaid) * 100) / 100;
  return this;
};
module.exports = model('Folio', schema);
