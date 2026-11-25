const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
module.exports = model('ApprovalRequest', new Schema({
  requestNumber: { type: String, unique: true },
  type: { type: String, required: true, index: true },
  referenceModel: String,
  referenceId: Schema.Types.ObjectId,
  referenceLabel: String,           // e.g. "RES-0007 · Room 112"
  payload: Schema.Types.Mixed,      // what will be applied on approval
  amount: { type: Number, default: 0 },
  requestedBy: ref('User'),
  requestedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
  approverRoles: [String],          // role keys allowed to decide (from approval rules; thresholds TBC)
  approver: ref('User'),
  approvedAt: Date,
  rejectionReason: String,
  comments: String,
}, { timestamps: true }));
