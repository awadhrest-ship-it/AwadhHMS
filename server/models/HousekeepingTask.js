const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const STATUSES = ['Unassigned', 'Assigned', 'In Progress', 'Inspection Pending', 'Re-clean Required', 'Completed', 'Cancelled'];
const OPEN = ['Unassigned', 'Assigned', 'In Progress', 'Inspection Pending', 'Re-clean Required'];
const checklistItem = new Schema({
  label: { type: String, required: true, trim: true }, custom: { type: Boolean, default: false },
  done: { type: Boolean, default: false }, doneBy: ref('User'), doneByName: String, doneAt: Date,
});
const schema = new Schema({
  taskNumber: { type: String, unique: true },
  sourceKey: { type: String, required: true, unique: true },     // checkout:<reservationId> | stayover:<roomId>:<date> | manual:<uuid> | sync:<roomId>:<n> - makes creation idempotent
  room: { ...ref('Room'), required: true, index: true },
  reservation: ref('Reservation'),                                // the stay that ended (checkout tasks)
  type: { type: String, enum: ['Checkout', 'Stay-over', 'Manual'], required: true },
  priority: { type: String, enum: ['Normal', 'High', 'Urgent'], default: 'Normal' },
  status: { type: String, enum: STATUSES, default: 'Unassigned', index: true },
  notes: String,
  assignedTo: { ...ref('User'), index: true }, assignedBy: ref('User'), assignedAt: Date,
  assignmentHistory: [{ _id: false, at: Date, by: ref('User'), byName: String, from: ref('User'), to: ref('User'), toName: String, note: String }],
  dueAt: Date,
  startedAt: Date, submittedAt: Date, completedAt: Date, cancelledAt: Date, cancelReason: String,
  cleanedBy: ref('User'),                                          // who did the last cleaning (inspector must differ by default)
  checklist: [checklistItem],
  photos: [{ attachment: ref('Attachment'), kind: { type: String, enum: ['before', 'after'] }, caption: String, at: Date, by: ref('User') }],
  rejectionCount: { type: Number, default: 0 },
  lastRejection: { _id: false, reason: String, at: Date, by: ref('User'), byName: String, failedItems: [String] },
  inspection: { _id: false, result: String, at: Date, by: ref('User'), byName: String, notes: String },
  roomStatusNote: String,
  createdBy: ref('User'),
}, { timestamps: true });
schema.index({ status: 1, assignedTo: 1 });
schema.index({ room: 1, status: 1 });
const M = model('HousekeepingTask', schema);
M.STATUSES = STATUSES; M.OPEN = OPEN;
module.exports = M;
