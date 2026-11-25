const { Schema, model } = require('mongoose');
/**
 * A physical restaurant table. Occupancy is NOT stored as an editable status: `currentOrder` is a system-managed claim made atomically
 * when a dine-in order opens on the table and released when that order completes/cancels/transfers. The visible status
 * (Available / Reserved / Occupied / Out of Service) is derived from it plus reservations - see services/restaurant/tables.js.
 */
module.exports = model('RestaurantTable', new Schema({
  number: { type: String, required: true, unique: true, trim: true },   // e.g. "T1", "G-4"
  section: { type: String, trim: true, default: 'Main hall' },
  capacity: { type: Number, required: true, min: 1, max: 50 },
  active: { type: Boolean, default: true },
  outOfService: { type: Boolean, default: false },                      // manual: broken / reserved for an event; cannot be set while occupied
  outOfServiceReason: String,
  currentOrder: { type: Schema.Types.ObjectId, ref: 'RestaurantOrder', default: null }, // system-managed claim (never accepted from the API)
  notes: String,
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true }));
