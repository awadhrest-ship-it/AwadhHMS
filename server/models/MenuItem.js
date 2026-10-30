const { Schema, model } = require('mongoose');
/**
 * What the restaurant sells. Items are never deleted (orders keep their own snapshot of name/price anyway) - they are deactivated.
 * `station` and `recipe` are deliberate, empty extension points for Phase 7 (kitchen stations, recipes); Phase 6 never fills them in.
 */
module.exports = model('MenuItem', new Schema({
  code: { type: String, trim: true, uppercase: true },                    // optional short code, unique when present (checked in the service)
  name: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true, default: '' },
  category: { type: Schema.Types.ObjectId, ref: 'MenuCategory', required: true, index: true },
  price: { type: Number, required: true, min: 0 },                        // rupees, max 2 decimals (validated); order lines snapshot it
  taxable: { type: Boolean, default: true },                              // whether the configured restaurant taxes apply
  isVeg: { type: Boolean, default: null },
  active: { type: Boolean, default: true },                               // soft delete / retire
  available: { type: Boolean, default: true },                            // today's availability (kitchen / restaurant staff toggle this)
  unavailableReason: String, availabilityChangedAt: Date, availabilityChangedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  priceHistory: [{ _id: false, price: Number, at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } }],
  station: { type: String, default: null },                               // Phase 7: Main kitchen | Indian | Chinese | Tandoor (mapping TBC - not filled)
  recipe: { type: Schema.Types.ObjectId, default: null },                 // Phase 7: recipe reference (not used in Phase 6)
  isDemo: { type: Boolean, default: false },
}, { timestamps: true }));
