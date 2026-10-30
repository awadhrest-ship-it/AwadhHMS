const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const lineSchema = new Schema({
  item: { ...ref('InventoryItem'), required: true },
  sku: String, itemName: String, baseUnit: String,
  systemQty: { type: Number, required: true },          // system balance when the count started (base units)
  countedQty: { type: Number, default: null },          // physical count (base units)
  variance: { type: Number, default: 0 },               // counted - system (negative = shortage)
  status: { type: String, enum: ['Not Counted', 'Matched', 'Variance', 'Adjustment Requested', 'Adjusted', 'Rejected', 'Explained'], default: 'Not Counted' },
  note: String, resolutionNote: String,
  adjustmentMovement: ref('StockMovement'),
}, { _id: true });
module.exports = model('Stocktake', new Schema({
  stocktakeNumber: { type: String, unique: true },
  department: { type: String, required: true, index: true },
  category: ref('InventoryCategory'),                    // optional scope
  status: { type: String, enum: ['Counting', 'Submitted', 'Resolved', 'Cancelled'], default: 'Counting', index: true },
  lines: [lineSchema],
  notes: String,
  startedBy: ref('User'), submittedBy: ref('User'), submittedAt: Date, resolvedAt: Date,
  approval: ref('ApprovalRequest'),
}, { timestamps: true }));
