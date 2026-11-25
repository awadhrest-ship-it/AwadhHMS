const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const lineSchema = new Schema({ orderItem: Schema.Types.ObjectId, name: String, unitPrice: Number, taxable: Boolean, quantity: Number }, { _id: false });
const adjustmentSchema = new Schema({
  kind: { type: String, enum: ['Discount', 'Complimentary'], required: true },
  status: { type: String, enum: ['Pending', 'Applied', 'Rejected', 'Superseded'], default: 'Pending' },
  mode: { type: String, enum: ['percent', 'amount'] }, value: Number,                  // discount: 10 (%) or 150 (rupees)
  lines: [{ _id: false, orderItem: Schema.Types.ObjectId, quantity: Number }],         // complimentary: which items / how many
  reason: String,
  amount: Number,                                                                      // value at request time (discount amount or complimentary value) - informational; recomputed when applied
  approval: ref('ApprovalRequest'),
  requestedBy: ref('User'), requestedByName: String, requestedAt: Date,
  decidedBy: ref('User'), decidedByName: String, decidedAt: Date, decisionNote: String,
  beforeTotal: Number, afterTotal: Number,                                             // bill total before / after the adjustment was applied
});
const taxLine = new Schema({ code: String, name: String, ratePercent: Number, amount: Number }, { _id: false });
const schema = new Schema({
  billNumber: { type: String, unique: true },
  order: { ...ref('RestaurantOrder'), required: true, index: true }, orderNumber: String, orderType: String, businessDate: String, // businessDate = the order's
  label: String, splitIndex: { type: Number, default: 1 }, splitCount: { type: Number, default: 1 },
  status: { type: String, enum: ['Draft', 'Final', 'Void'], default: 'Draft', index: true },
  settlement: { type: String, enum: ['Unsettled', 'Part-paid', 'Paid', 'Posted to Room', 'No charge'], default: 'Unsettled', index: true },
  lines: [lineSchema],
  adjustments: [adjustmentSchema],
  // Money is stored in rupees (the unit the folio uses) AND as exact integer paise (`*Minor`), which are the figures all checks use.
  totals: { _id: false, gross: Number, complimentary: Number, discount: Number, net: Number, taxable: Number, taxes: [taxLine], tax: Number, total: Number },
  totalMinor: { type: Number, default: 0 }, paidMinor: { type: Number, default: 0 }, balanceMinor: { type: Number, default: 0 },
  taxSnapshot: { _id: false, taxes: [{ _id: false, code: String, name: String, ratePercent: Number }], configured: Boolean, currency: String }, // tax config in force when finalised
  finalisedAt: Date, finalisedBy: ref('User'), finalisedDate: String,
  guest: { _id: false, name: String, phone: String },                                // who the bill is for (display only)
  posting: { _id: false, state: { type: String, enum: ['None', 'Posting', 'Posted', 'Failed', 'Reversed'], default: 'None' }, folio: ref('Folio'), key: String, postedAt: Date, postedBy: ref('User'), error: String, attempts: { type: Number, default: 0 }, amount: Number },
  voidedAt: Date, voidedBy: ref('User'), voidReason: String,
  createdBy: ref('User'),
}, { timestamps: true });
const M = model('RestaurantBill', schema); M.SETTLED = ['Paid', 'Posted to Room', 'No charge'];
module.exports = M;
