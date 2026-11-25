const { Schema, model } = require('mongoose');
module.exports = model('PriceHistory', new Schema({
  entryKey: { type: String, required: true, unique: true },   // movement:line for stock-in prices (idempotent) or a uuid for manual entries
  item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  unitPrice: { type: Number, required: true, min: 0 },       // per entered unit
  unit: { type: String, required: true },
  pricePerBase: { type: Number, required: true, min: 0 },     // normalised per base unit so prices are comparable
  quantity: Number,
  supplier: String,
  reference: { _id: false, model: String, id: Schema.Types.ObjectId, label: String }, // stock-in movement now, Phase 9 purchase order / vendor invoice later
  date: { type: Date, default: Date.now, index: true },
  note: String,
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));
