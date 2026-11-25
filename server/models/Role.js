const { Schema, model } = require('mongoose');
const { DEPARTMENTS } = require('../config/permissions');
module.exports = model('Role', new Schema({
  key: { type: String, unique: true, required: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  department: { type: String, enum: DEPARTMENTS, default: 'Management' },
  permissions: [String],
  crossDepartment: { type: Boolean, default: false }, // TBC Q07: which roles may work across departments
  isSystem: { type: Boolean, default: false },
}, { timestamps: true }));
