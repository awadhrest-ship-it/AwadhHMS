const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/** Linen / toiletry replacement and cleaning-supply use. Each row is backed by exactly one 'Consumption' stock movement. */
module.exports = model('SupplyUse', new Schema({
  clientKey: { type: String, required: true, unique: true },       // retry-safe: the same submission can never consume stock twice
  kind: { type: String, enum: ['Linen Replacement', 'Toiletry Replacement', 'Cleaning Supplies'], required: true, index: true },
  item: { ...ref('InventoryItem'), required: true }, sku: String, itemName: String,
  quantity: { type: Number, required: true }, unit: String, baseQty: Number, baseUnit: String,
  room: ref('Room'), task: { ...ref('HousekeepingTask'), index: true },
  department: { type: String, default: 'Housekeeping' },
  movement: ref('StockMovement'), status: { type: String, enum: ['Pending', 'Posted', 'Failed'], default: 'Pending' },
  notes: String, usedBy: ref('User'), usedByName: String, at: { type: Date, default: Date.now, index: true },
}, { timestamps: true }));
