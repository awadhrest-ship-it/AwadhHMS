const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const TYPES = ['Dine-in', 'Takeaway', 'Delivery', 'Room Service'];
// Draft -> Confirmed (sent to kitchen) -> Preparing -> Ready -> Served -> Completed (served AND fully settled); Cancelled from any pre-Served state.
const STATUSES = ['Draft', 'Confirmed', 'Preparing', 'Ready', 'Served', 'Completed', 'Cancelled'];
const ACTIVE = ['Draft', 'Confirmed', 'Preparing', 'Ready', 'Served'];
const itemSchema = new Schema({
  menuItem: ref('MenuItem'),
  name: { type: String, required: true }, description: String, category: String,   // snapshots - later menu edits never change an order
  unitPrice: { type: Number, required: true, min: 0 },
  taxable: { type: Boolean, default: true },
  quantity: { type: Number, required: true, min: 1 },
  notes: String,                                                                    // item-level special instructions
  status: { type: String, enum: ['Active', 'Cancelled'], default: 'Active' },
  cancelReason: String, cancelledAt: Date, cancelledBy: ref('User'),
  round: { type: Number, default: null },                                           // kitchen round it was sent in; null = not yet sent
  station: { type: String, default: null },                                         // Phase 7 extension point
  addedBy: ref('User'), addedAt: { type: Date, default: Date.now },
});
const schema = new Schema({
  orderNumber: { type: String, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },                   // `${userId}:${key}` - a retried submit returns the same order
  type: { type: String, enum: TYPES, required: true, index: true },
  status: { type: String, enum: STATUSES, default: 'Draft', index: true },
  businessDate: { type: String, required: true, index: true },                     // YYYY-MM-DD (IST) the order belongs to
  table: { ...ref('RestaurantTable'), index: true }, tableNumber: String, covers: Number,
  reservation: ref('RestaurantReservation'),
  customer: { _id: false, name: String, phone: String },
  delivery: { _id: false, contactName: String, phone: String, address: String, landmark: String, instructions: String }, // minimum set; fields required are configurable (TBC)
  stay: { _id: false, reservation: ref('Reservation'), folio: ref('Folio'), room: ref('Room'), roomNumber: String, guest: ref('Guest'), guestName: String },
  items: [itemSchema],
  notes: String,                                                                    // order-level special instructions
  rounds: { type: Number, default: 0 },                                             // kitchen tickets raised so far
  subtotal: { type: Number, default: 0 },                                           // active items at menu price, before discount/tax (informational; bills are authoritative)
  billingStatus: { type: String, enum: ['Unbilled', 'Billed', 'Part-paid', 'Paid', 'Posted to Room', 'No charge'], default: 'Unbilled', index: true },
  billingRevision: { type: Number, default: 0 },                                    // bumped atomically when bills are generated - stops duplicate bill sets
  tableHistory: [{ _id: false, from: String, to: String, at: Date, by: ref('User'), byName: String }],
  statusHistory: [{ _id: false, status: String, at: Date, by: ref('User'), byName: String, note: String }],
  servedAt: Date, completedAt: Date,
  cancelledAt: Date, cancelReason: String, cancelledBy: ref('User'),
  createdBy: ref('User'), createdByName: String, updatedBy: ref('User'), updatedByName: String,
}, { timestamps: true });
schema.index({ createdAt: -1 });
const M = model('RestaurantOrder', schema); Object.assign(M, { TYPES, STATUSES, ACTIVE });
module.exports = M;
