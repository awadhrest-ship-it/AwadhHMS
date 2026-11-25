const { Schema, model } = require('mongoose');
module.exports = model('Payment', new Schema({
  folio: { type: Schema.Types.ObjectId, ref: 'Folio', required: true, index: true },
  guest: { type: Schema.Types.ObjectId, ref: 'Guest', index: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation' },
  amount: { type: Number, required: true, min: 0.01 },
  kind: { type: String, enum: ['Advance', 'Payment'], default: 'Payment' },
  method: { type: String, required: true }, // validated against Property.settings.paymentMethods (TBC Q14)
  reference: String,
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  receivedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true }));
