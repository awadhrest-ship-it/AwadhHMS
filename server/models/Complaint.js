const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
module.exports = model('Complaint', new Schema({
  complaintNumber: { type: String, unique: true },
  guest: { ...ref('Guest'), required: true, index: true },
  room: ref('Room'),
  reservation: ref('Reservation'),
  category: { type: String, default: 'Other' }, // list is configurable (TBC Q18)
  description: { type: String, required: true },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium' },
  status: { type: String, enum: ['Open', 'In Progress', 'Resolved', 'Closed'], default: 'Open', index: true },
  assignedTo: ref('User'),
  createdBy: ref('User'),
  resolvedBy: ref('User'), resolvedAt: Date, resolution: String,
}, { timestamps: true }));
