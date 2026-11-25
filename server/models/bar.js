/**
 * Phase 8 - Bar Management models.
 * Bar stock itself is NOT stored here: quantities live in the Phase 4 StockBalance / StockMovement / StockLedger collections.
 * These collections hold only what Phase 4 has no concept of: the bar menu, drink orders, the sealed-vs-opened split of liquor,
 * bottle-opening records, complimentary requests, wastage/breakage records, stock counts (variance) and bartender shifts.
 * All quantities of liquor are millilitres (the item's base unit); *Q fields are integer micro-units (same scale as Phase 4).
 */
const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const MEASURES = ['30 ml', '60 ml', 'Full bottle'];

/* ---------------- menu ---------------- */
const servingSchema = new Schema({
  measure: { type: String, enum: MEASURES, required: true },
  ml: { type: Number, min: 0 },                       // peg size in ml (30 / 60). Full bottle uses the item's configured bottle capacity - never stored here.
  price: { type: Number, required: true, min: 0 },
  happyHourPrice: { type: Number, min: 0 },           // optional explicit happy-hour price (used only when a configured happy-hour rule is active)
  units: { type: Number, min: 1, default: 1 },        // packaged items: stock units used per serving
  active: { type: Boolean, default: true },
});
const mixerSchema = new Schema({
  item: { ...ref('InventoryItem'), required: true }, quantity: { type: Number, required: true, min: 0 }, unit: { type: String, required: true, lowercase: true },
  measures: { type: [String], enum: MEASURES, default: MEASURES },   // which servings use this mixer
}, { _id: true });
const menuSchema = new Schema({
  name: { type: String, required: true, trim: true }, category: { type: String, trim: true, default: 'Spirits' },
  kind: { type: String, enum: ['spirit', 'packaged'], default: 'spirit' },   // spirit = poured from bottles in ml; packaged = counted units (beer, soft drink)
  trackStock: { type: Boolean, default: true },        // false = explicitly NOT stock-tracked (status shown as such)
  stockItem: ref('InventoryItem'),
  servings: { type: [servingSchema], validate: [(v) => v.length > 0, 'Add at least one serving'] },
  mixers: [mixerSchema],
  available: { type: Boolean, default: true }, active: { type: Boolean, default: true }, notes: String, isDemo: { type: Boolean, default: false },
  createdBy: ref('User'), updatedBy: ref('User'),
}, { timestamps: true });
menuSchema.index({ name: 1 }, { unique: true });
const BarMenuItem = model('BarMenuItem', menuSchema);

/* ---------------- opened-liquor pool (per inventory item) + its ledger ---------------- */
const BarOpenStock = model('BarOpenStock', new Schema({
  item: { ...ref('InventoryItem'), required: true, unique: true }, openQ: { type: Number, default: 0 }, ops: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false }));
const BarOpenLedger = model('BarOpenLedger', new Schema({
  key: { type: String, required: true, unique: true }, item: { ...ref('InventoryItem'), required: true }, deltaQ: { type: Number, required: true },
  kind: { type: String, enum: ['open', 'sale', 'complimentary', 'wastage', 'breakage', 'adjustment'], required: true },
  refModel: String, refId: Schema.Types.ObjectId, refLabel: String, by: ref('User'), at: { type: Date, default: Date.now },
}, { versionKey: false }));
BarOpenLedger.schema.index({ item: 1, at: 1 });

/* ---------------- bottle opening ---------------- */
const BarBottleOpening = model('BarBottleOpening', new Schema({
  openingNumber: { type: String, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  item: { ...ref('InventoryItem'), required: true, index: true }, itemName: String, sku: String,
  bottles: { type: Number, required: true, min: 1 }, capacityMl: { type: Number, required: true }, totalMl: { type: Number, required: true },
  source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  openedAt: { type: Date, default: Date.now, index: true }, openedBy: ref('User'), openedByName: String, shift: ref('BarShift'),
  phase4OnHandMl: Number, openMlBefore: Number, openMlAfter: Number,   // Phase 4 total (unchanged by opening) and the opened pool, for the audit trail
  applied: { type: Boolean, default: false }, notes: String,
}, { timestamps: true }));

/* ---------------- drink orders ---------------- */
const orderLine = new Schema({
  menuItem: { ...ref('BarMenuItem'), required: true }, name: String, category: String, serving: Schema.Types.ObjectId, measure: String, ml: Number,
  quantity: { type: Number, required: true, min: 1 }, basePrice: Number, unitPrice: Number, lineTotal: Number,
  happyHour: { _id: false, applied: Boolean, rule: String, ruleId: String, mode: String },
  consumptionStatus: String, consumptionIncomplete: { type: Boolean, default: false }, notes: String,
  consumption: [{ _id: false, item: ref('InventoryItem'), itemName: String, baseQty: Number, unit: String, from: String, role: String }],
}, { _id: true });
const BarOrder = model('BarOrder', new Schema({
  orderNumber: { type: String, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ['Open', 'Served', 'Cancelled'], default: 'Open', index: true },
  lines: [orderLine], subtotal: { type: Number, default: 0 }, total: { type: Number, default: 0 },    // no tax: bar taxes are TBC (Q14)
  customerLabel: String, roomNumber: String, notes: String,          // informational only - nothing is posted to a room from these fields
  // Bar billing is TBC in the PDF (separate bill / room bill / both). Nothing is posted anywhere; this block is the integration seam.
  billing: { _id: false, status: { type: String, default: 'Pending destination decision' }, destination: { type: String, default: null }, note: String },
  shift: ref('BarShift'), createdBy: ref('User'), createdByName: String, pricedAt: Date,
  servedAt: Date, servedBy: ref('User'), servedByName: String, movement: ref('StockMovement'), stockAttempt: { type: Number, default: 0 }, stockError: String,
  cancelledAt: Date, cancelledBy: ref('User'), cancelReason: String,
}, { timestamps: true }));
BarOrder.schema.index({ servedAt: -1 }); BarOrder.schema.index({ shift: 1 });

/* ---------------- complimentary drinks ---------------- */
const BarComplimentary = model('BarComplimentary', new Schema({
  requestNumber: { type: String, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  menuItem: { ...ref('BarMenuItem'), required: true }, itemName: String, serving: Schema.Types.ObjectId, measure: String, quantity: { type: Number, required: true, min: 1 },
  listValue: Number, reason: { type: String, required: true },
  status: { type: String, enum: ['Pending Approval', 'Approved', 'Rejected', 'Issuing', 'Issued', 'Cancelled'], default: 'Pending Approval', index: true },
  approval: ref('ApprovalRequest'), requestedBy: ref('User'), requestedByName: String, shift: ref('BarShift'),
  decidedBy: ref('User'), decidedAt: Date, decisionReason: String,
  issuedAt: Date, issuedBy: ref('User'), issuedByName: String, movement: ref('StockMovement'), attempt: { type: Number, default: 0 }, issueError: String,
  consumption: [{ _id: false, item: ref('InventoryItem'), itemName: String, baseQty: Number, unit: String, from: String, role: String }], consumptionIncomplete: Boolean,
}, { timestamps: true }));

/* ---------------- wastage / breakage (never edited or deleted; addenda only) ---------------- */
const BarLoss = model('BarLoss', new Schema({
  lossNumber: { type: String, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['Wastage', 'Breakage'], required: true, index: true },
  item: { ...ref('InventoryItem'), required: true, index: true }, itemName: String, sku: String,
  quantity: Number, unit: String, baseQty: Number, baseUnit: String, stockState: { type: String, enum: ['opened', 'sealed', 'unit'], default: 'unit' },
  menuItem: ref('BarMenuItem'), measure: String, drinks: Number,
  consumption: [{ _id: false, item: ref('InventoryItem'), itemName: String, baseQty: Number, unit: String, from: String, role: String }],   // everything this record took out of stock (a spilled drink includes its mixers)
  reason: { type: String, required: true }, notes: String, supportingRef: String, occurredAt: { type: Date, default: Date.now, index: true },
  recordedBy: ref('User'), recordedByName: String, shift: ref('BarShift'),
  status: { type: String, enum: ['Pending', 'Posted'], default: 'Pending' }, movement: ref('StockMovement'), attempt: { type: Number, default: 0 },
  addenda: [{ _id: false, at: Date, by: ref('User'), byName: String, note: String }],
}, { timestamps: true }));

/* ---------------- stock counts (variance) ---------------- */
const varLine = new Schema({
  item: ref('InventoryItem'), itemName: String, sku: String, isLiquor: Boolean, baseUnit: String, capacityMl: Number, pegMl: Number,
  expectedQ: Number, expectedOpenQ: Number, expectedSealedBottles: Number,       // snapshot of the book figures when the count was recorded
  countedQ: Number, countedOpenQ: Number, countedSealedBottles: Number,
  varianceQ: Number, varianceOpenQ: Number, varianceBottles: Number, variancePegs: Number, varianceValue: Number,
  exceedsTolerance: Boolean, hasVariance: Boolean, note: String,
  breakdown: { _id: false, opening: Number, received: Number, sold: Number, complimentary: Number, wastage: Number, breakage: Number, adjustments: Number, other: Number },
  adjustment: { _id: false, status: { type: String, enum: ['Requested', 'Applied', 'Rejected'] }, movement: ref('StockMovement'), approval: ref('ApprovalRequest'), requestedAt: Date, appliedAt: Date },
}, { _id: true });
const BarReconciliation = model('BarReconciliation', new Schema({
  reconNumber: { type: String, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  department: String, countedAt: { type: Date, default: Date.now, index: true }, periodFrom: Date, lines: [varLine], notes: String,
  toleranceConfigured: Boolean, linesWithVariance: Number, shift: ref('BarShift'),
  countedBy: ref('User'), countedByName: String,
}, { timestamps: true }));

const BarVarianceAlert = model('BarVarianceAlert', new Schema({
  key: { type: String, required: true, unique: true }, source: { type: String, enum: ['reconciliation', 'shift'] }, sourceId: Schema.Types.ObjectId, sourceLabel: String,
  item: ref('InventoryItem'), itemName: String, varianceQ: Number, variancePegs: Number, varianceBottles: Number, baseUnit: String,
  toleranceConfigured: Boolean, recipientCount: { type: Number, default: 0 }, usedFallback: Boolean, noRecipients: Boolean,
  acknowledgedAt: Date, acknowledgedBy: ref('User'), createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false }));

/* ---------------- bartender shifts ---------------- */
const shiftLine = new Schema({
  item: ref('InventoryItem'), itemName: String, sku: String, isLiquor: Boolean, baseUnit: String, capacityMl: Number, pegMl: Number,
  openingQ: Number, openingOpenQ: Number,
  expectedQ: Number, expectedOpenQ: Number, expectedSealedBottles: Number,
  countedQ: Number, countedOpenQ: Number, countedSealedBottles: Number,
  varianceQ: Number, varianceOpenQ: Number, varianceBottles: Number, variancePegs: Number, varianceValue: Number,
  exceedsTolerance: Boolean, hasVariance: Boolean,
  breakdown: { _id: false, opening: Number, received: Number, sold: Number, complimentary: Number, wastage: Number, breakage: Number, adjustments: Number, other: Number },
}, { _id: false });
const BarShift = model('BarShift', new Schema({
  shiftNumber: { type: String, unique: true }, idempotencyKey: String,
  bartender: { ...ref('User'), required: true }, bartenderName: String, definition: String, department: String,
  status: { type: String, enum: ['Open', 'Closing', 'Closed'], default: 'Open', index: true },
  startedAt: { type: Date, default: Date.now }, startedBy: ref('User'), endedAt: Date, closedBy: ref('User'), closedByName: String, notes: String, closingNotes: String,
  opening: [shiftLine],
  closing: { _id: false, lines: [shiftLine], window: { _id: false, from: Date, to: Date },
    sales: { _id: false, orders: Number, drinks: Number, revenue: Number, byMeasure: Schema.Types.Mixed }, complimentary: { _id: false, requests: Number, drinks: Number },
    wastage: { _id: false, records: Number }, breakage: { _id: false, records: Number }, linesWithVariance: Number, toleranceConfigured: Boolean },
  revision: { type: Number, default: 0 },
  corrections: [{ _id: false, at: Date, by: ref('User'), byName: String, reason: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed }],
}, { timestamps: true }));
BarShift.schema.index({ bartender: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['Open', 'Closing'] } } });   // one live shift per bartender

module.exports = { BarMenuItem, BarOpenStock, BarOpenLedger, BarBottleOpening, BarOrder, BarComplimentary, BarLoss, BarReconciliation, BarVarianceAlert, BarShift };
Object.defineProperty(module.exports, 'MEASURES', { value: MEASURES, enumerable: false });   // not enumerable: the seed iterates every exported model
