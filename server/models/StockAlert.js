const { Schema, model } = require('mongoose');
/** State row per alert condition so a notification is sent when the condition STARTS, not on every page load. */
const schema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  department: { type: String, required: true },     // '*' = hotel-wide total
  kind: { type: String, enum: ['low_stock', 'expiry'], required: true },
  lotKey: { type: String, default: '' },
  state: { type: String, enum: ['active', 'resolved'], default: 'active', index: true },
  openedAt: Date, resolvedAt: Date, notifiedAt: Date,
  onHand: Number, minLevel: Number, expiryDate: Date, occurrences: { type: Number, default: 1 },
}, { timestamps: true });
schema.index({ item: 1, department: 1, kind: 1, lotKey: 1 }, { unique: true });
module.exports = model('StockAlert', schema);
