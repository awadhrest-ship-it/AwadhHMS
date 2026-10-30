const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/** Immutable record of every supervisor inspection (history per room, task and inspector). */
module.exports = model('RoomInspection', new Schema({
  task: { ...ref('HousekeepingTask'), required: true, index: true },
  room: { ...ref('Room'), required: true, index: true },
  result: { type: String, enum: ['Approved', 'Rejected'], required: true },
  reason: String, notes: String, failedItems: [String],
  checklist: [{ _id: false, label: String, done: Boolean, doneByName: String }],   // snapshot of what was inspected
  cleanedBy: { ...ref('User'), index: true }, cleanedByName: String,
  inspector: { ...ref('User'), required: true, index: true }, inspectorName: String,
  attempt: Number,
  roomStatusBefore: String, roomStatusAfter: String,
  inspectedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true }));
