const { Schema, model } = require('mongoose');
/** A payment received against a restaurant bill. (Room-service charges are NOT payments - they are folio charges.) */
module.exports = model('RestaurantPayment', new Schema({
  bill: { type: Schema.Types.ObjectId, ref: 'RestaurantBill', required: true, index: true },
  order: { type: Schema.Types.ObjectId, ref: 'RestaurantOrder', index: true },
  billNumber: String,
  amount: { type: Number, required: true, min: 0.01 }, amountMinor: { type: Number, required: true },
  method: { type: String, required: true },
  reference: String,
  idempotencyKey: { type: String, required: true, unique: true },   // `${userId}:${key}` - the same submit never records two payments
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User' }, receivedByName: String,
  receivedAt: { type: Date, default: Date.now, index: true },
  businessDate: { type: String, index: true },                       // IST date received
}, { timestamps: true }));
