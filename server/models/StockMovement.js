const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const MOVEMENT_TYPES = ['Opening Stock', 'Stock In', 'Stock Out', 'Transfer', 'Wastage', 'Breakage', 'Damaged', 'Adjustment', 'Consumption'];
const lineSchema = new Schema({
  item: { ...ref('InventoryItem'), required: true },
  sku: String, itemName: String,                         // snapshot for the audit trail (item may be renamed later)
  fromDepartment: String, toDepartment: String,
  direction: { type: String, enum: ['increase', 'decrease'] }, // adjustments only
  quantity: { type: Number, required: true },            // as entered
  unit: { type: String, required: true },                // as entered
  baseQty: { type: Number, required: true },             // normalised to the item's base unit
  baseUnit: String,
  unitPrice: Number,                                     // per entered unit (stock-in)
  supplier: String,
  unitCost: Number,                                      // per base unit
  lotNo: String, expiryDate: Date, lotId: ref('StockBalance'),
}, { _id: true });
const opSchema = new Schema({
  key: String, kind: { type: String, enum: ['dec', 'inc'] }, lineNo: Number, side: String,
  item: ref('InventoryItem'), department: String, balance: ref('StockBalance'),
  lotKey: String, lotNo: String, expiryDate: Date, unitCost: Number, qtyQ: Number,
  applied: { type: Boolean, default: false }, afterQ: Number,
}, { _id: false });
const schema = new Schema({
  movementNumber: { type: String, unique: true },
  type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
  // Awaiting Approval -> (approved) Pending -> Posted ; Rejected ; Failed. Only 'Posted' movements have changed stock.
  status: { type: String, enum: ['Awaiting Approval', 'Pending', 'Posted', 'Rejected', 'Failed'], default: 'Pending', index: true },
  approvalStatus: { type: String, enum: ['Not Required', 'Pending', 'Approved', 'Rejected'], default: 'Not Required' },
  approval: ref('ApprovalRequest'),
  idempotencyKey: { type: String, required: true, unique: true },
  source: { type: String, default: 'inventory' },        // inventory | housekeeping | stocktake | purchase (Phase 9) | kitchen (Phase 7) ...
  reason: String, notes: String,
  reference: { _id: false, model: String, id: Schema.Types.ObjectId, label: String }, // e.g. Phase 9 purchase receipt, housekeeping task
  lines: { type: [lineSchema], validate: [(v) => v.length > 0, 'At least one line is required'] },
  ops: [opSchema],
  performedBy: ref('User'), performedByName: String,
  decidedBy: ref('User'), decidedAt: Date, decisionReason: String,
  attempt: { type: Number, default: 0 },                 // bumped on every re-plan so operation keys of a rolled-back attempt are never reused
  postedAt: Date, failureReason: String,
}, { timestamps: true });
schema.index({ createdAt: -1 });
schema.index({ 'lines.item': 1, createdAt: -1 });
const M = model('StockMovement', schema);
M.TYPES = MOVEMENT_TYPES;
module.exports = M;
