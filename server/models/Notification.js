const { Schema, model } = require('mongoose');
module.exports = model('Notification', new Schema({
  type: { type: String, index: true }, // approval_request | booking_cancellation | price_change | pending_checkin | pending_payment | complaint | approval_decision
  title: { type: String, required: true },
  message: String,
  link: String,
  severity: { type: String, enum: ['info', 'warning', 'urgent'], default: 'info' },
  recipientUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  recipientPermission: { type: String, index: true }, // everyone holding this permission sees it
  readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false }));
