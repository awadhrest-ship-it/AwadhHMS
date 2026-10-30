const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const STATUSES = { Damage: ['Reported', 'Under Review', 'Resolved', 'Closed'], 'Missing Item': ['Reported', 'Under Review', 'Recovered', 'Written Off', 'Closed'], 'Lost & Found': ['Found', 'In Storage', 'Returned', 'Disposed'] };
/** Damage, missing-item and lost-and-found records share one collection so a room's/task's report history is a single query. */
const schema = new Schema({
  reportNumber: { type: String, unique: true },
  kind: { type: String, enum: Object.keys(STATUSES), required: true, index: true },
  title: { type: String, required: true, trim: true },             // item / what was damaged
  description: String,
  room: { ...ref('Room'), index: true }, task: { ...ref('HousekeepingTask'), index: true },
  location: String,                                                 // non-room areas (lobby, corridor...) or detail inside the room
  eventDate: { type: Date, default: Date.now },                    // date damaged / noticed missing / found
  status: { type: String, required: true, index: true },
  severity: { type: String, enum: ['Minor', 'Moderate', 'Severe'] },  // damage
  quantity: { type: Number, default: 1 },                           // missing items
  estimatedValue: Number,
  // groundwork for Phase 10: nothing is created automatically (TBC in the PDF); a later phase can fill requestRef
  maintenance: { _id: false, required: { type: Boolean, default: false }, requestRef: ref('MaintenanceRequest') },
  // lost & found
  storageLocation: String, identifyingMarks: String,
  claim: { _id: false, name: String, phone: String, idChecked: String, returnedAt: Date, returnedBy: ref('User'), returnedByName: String, notes: String },
  disposedReason: String,
  photos: [ref('Attachment')],
  history: [{ _id: false, at: Date, status: String, note: String, by: ref('User'), byName: String }],
  reportedBy: { ...ref('User'), index: true }, reportedByName: String,
  clientKey: { type: String, unique: true },                        // double-submit protection
}, { timestamps: true });
schema.index({ kind: 1, status: 1, createdAt: -1 });
const M = model('HousekeepingReport', schema); M.STATUSES = STATUSES;
module.exports = M;
