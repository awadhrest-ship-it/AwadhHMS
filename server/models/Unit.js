const { Schema, model } = require('mongoose');
/**
 * Reusable measurement unit (Module 4.4).
 *  dimension count|weight|volume : units of the same dimension convert automatically through `toBase`
 *                                  (count -> pcs, weight -> g, volume -> ml).
 *  dimension package             : packaging units (packet, bottle, box...). Their size differs per item, so they NEVER convert
 *                                  automatically - an explicit per-item conversion is required.
 */
module.exports = model('Unit', new Schema({
  code: { type: String, required: true, unique: true, lowercase: true, trim: true, match: [/^[a-z][a-z0-9_]{0,15}$/, 'Unit code must be lowercase letters/numbers (e.g. kg, pcs, packet)'] },
  name: { type: String, required: true, trim: true },
  dimension: { type: String, enum: ['count', 'weight', 'volume', 'package'], required: true },
  toBase: { type: Number, default: 1, validate: { validator: (v) => Number.isFinite(v) && v > 0, message: 'Conversion factor must be a positive number' } },
  isSystem: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true }));
