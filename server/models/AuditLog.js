const { Schema, model } = require('mongoose');
module.exports = model('AuditLog', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  userName: String, userRole: String,
  action: { type: String, required: true, index: true }, // create | update | delete | status | approve | reject | login | logout ...
  module: { type: String, index: true },
  entity: String, entityId: Schema.Types.ObjectId, entityLabel: String,
  oldValue: Schema.Types.Mixed, newValue: Schema.Types.Mixed,
  note: String,
  ip: String, userAgent: String,
  timestamp: { type: Date, default: Date.now, index: true },
}, { versionKey: false }));
