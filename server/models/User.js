const { Schema, model } = require('mongoose');
const { DEPARTMENTS } = require('../config/permissions');
const schema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: String,
  password: { type: String, required: true, select: false },
  role: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
  department: { type: String, enum: DEPARTMENTS, required: true },
  active: { type: Boolean, default: true },
  kitchenStations: { type: [String], default: [] },   // Phase 7: stations this kitchen user works (empty = not restricted). Users holding kitchen.allStations see every station.
  lastLoginAt: Date,
}, { timestamps: true });
schema.set('toJSON', { transform: (_d, r) => { delete r.password; return r; } });
module.exports = model('User', schema);
