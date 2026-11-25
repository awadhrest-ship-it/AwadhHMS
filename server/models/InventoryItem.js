const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/**
 * Catalogue item. It deliberately holds NO stock quantity: balances live in StockBalance rows that only the movement
 * service can change, so there is a single source of truth and no way to edit a balance without a ledger entry.
 */
const schema = new Schema({
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true, match: [/^[A-Z0-9][A-Z0-9._-]{1,31}$/, 'Item code must be 2-32 letters/numbers (. _ - allowed)'] },
  name: { type: String, required: true, trim: true, index: true },
  category: { ...ref('InventoryCategory'), required: true, index: true },
  description: String,
  baseUnit: { type: String, required: true, lowercase: true },       // unit stock is stored in (canonical unit)
  purchaseUnit: { type: String, lowercase: true },                    // default unit for stock-in
  usageUnit: { type: String, lowercase: true },                       // default unit for stock-out / consumption
  conversions: [{ _id: false, unit: { type: String, required: true, lowercase: true }, factor: { type: Number, required: true } }], // 1 <unit> = <factor> base units (explicit, per item)
  minStockLevel: { type: Number, default: 0, min: 0 },                // hotel-wide minimum (sum of all departments); 0 = not used
  minLevels: [{ _id: false, department: { type: String, required: true }, minLevel: { type: Number, required: true, min: 0 } }], // per-department minimum
  trackExpiry: { type: Boolean, default: false },
  lastPurchase: { _id: false, unitPrice: Number, unit: String, pricePerBase: Number, date: Date, supplier: String, reference: String }, // cache of the newest PriceHistory row
  isDemo: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  createdBy: ref('User'), updatedBy: ref('User'),
}, { timestamps: true });
module.exports = model('InventoryItem', schema);
