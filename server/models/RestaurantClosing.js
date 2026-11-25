const { Schema, model } = require('mongoose');
/** Restaurant daily closing record. `businessDate` is unique: a day can be closed once. Phase 13 (Night Audit) reconciles against these. */
module.exports = model('RestaurantClosing', new Schema({
  businessDate: { type: String, required: true, unique: true },
  status: { type: String, enum: ['Closed'], default: 'Closed' },
  idempotencyKey: { type: String, required: true, unique: true },
  totals: Schema.Types.Mixed,         // snapshot: orders, sales (gross/complimentary/discount/net/tax/total), byType, byMethod, collected, postedToRooms, outstanding, cancelled, voided
  exceptions: Schema.Types.Mixed,     // all exceptions that existed at closing (blockers cannot exist - closing is refused)
  acknowledged: [String], notes: String,
  references: Schema.Types.Mixed,     // ids of the orders / bills / payments the totals were built from
  closedBy: { type: Schema.Types.ObjectId, ref: 'User' }, closedByName: String, closedAt: { type: Date, default: Date.now },
}, { timestamps: true }));
