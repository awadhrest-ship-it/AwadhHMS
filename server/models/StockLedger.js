const { Schema, model } = require('mongoose');
const SCALE = 1e6;
/** Immutable ledger: one row per stock effect (a transfer writes an 'out' and an 'in' row). Never updated or deleted. */
const schema = new Schema({
  opKey: { type: String, required: true, unique: true },     // movement:line:side:lot - makes ledger writes idempotent
  movement: { type: Schema.Types.ObjectId, ref: 'StockMovement', index: true },
  movementNumber: String, type: String, lineNo: Number, side: { type: String, enum: ['in', 'out'] },
  item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  department: { type: String, required: true },
  counterpartDepartment: String,
  lotKey: String, lotNo: String, expiryDate: Date,
  deltaQ: { type: Number, required: true },                  // signed micro-units of the base unit
  afterQ: Number,                                            // lot quantity after the change (micro-units)
  enteredQuantity: Number, enteredUnit: String,
  reason: String, performedBy: { type: Schema.Types.ObjectId, ref: 'User' }, performedByName: String,
  at: { type: Date, default: Date.now },
}, { versionKey: false });
schema.index({ item: 1, department: 1, at: -1 });
schema.index({ department: 1, at: -1 });
schema.set('toJSON', { transform: (_d, r) => { r.delta = r.deltaQ / SCALE; if (r.afterQ != null) r.lotBalanceAfter = r.afterQ / SCALE; return r; } });
module.exports = model('StockLedger', schema);
