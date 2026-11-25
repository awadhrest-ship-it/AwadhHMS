const { Schema, model } = require('mongoose');
/**
 * One row per (item, department, lot). Quantities are stored as INTEGER micro-units of the item's base unit
 * (qtyQ = base quantity x 1,000,000) so additions and subtractions are exact - no floating-point drift.
 * `ops` holds idempotency markers: every change carries a unique operation key that is written in the SAME atomic
 * single-document update as the quantity, so a retried operation can never be applied twice.
 * Items without expiry use the single lot 'DEFAULT'.
 */
const schema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  department: { type: String, required: true },
  lotKey: { type: String, required: true, default: 'DEFAULT' },
  lotNo: String,
  expiryDate: { type: Date, default: null },
  qtyQ: { type: Number, default: 0, min: 0 },       // never negative (guarded in every update filter + schema min)
  unitCost: { type: Number, default: 0 },            // cost per base unit, last known for this lot (valuation only)
  receivedAt: { type: Date, default: Date.now },
  ops: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });
schema.index({ item: 1, department: 1, lotKey: 1 }, { unique: true });
schema.index({ department: 1, item: 1 });
schema.index({ expiryDate: 1 });
module.exports = model('StockBalance', schema);
