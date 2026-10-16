const { Schema, model } = require('mongoose');
const { ROOM_STATUSES } = require('../config/permissions');
const historySchema = new Schema({
  at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String,
  action: String, from: String, to: String, reason: String,
}, { _id: false });
module.exports = model('Room', new Schema({
  roomNumber: { type: String, required: true, unique: true, trim: true },
  floor: { type: Number, required: true },
  category: { type: Schema.Types.ObjectId, ref: 'RoomCategory', required: true },
  amenities: [String],
  photos: [String],
  capacity: { type: Number, default: 2 },
  extraBedCharge: { type: Number, default: 0 },
  status: { type: String, enum: ROOM_STATUSES, default: 'Available' },
  blocked: { type: Boolean, default: false },
  outOfOrder: { type: Boolean, default: false },
  statusReason: String,
  statusBeforeHold: String, // restored on unblock / restore
  active: { type: Boolean, default: true },
  history: { type: [historySchema], default: [] },
}, { timestamps: true }));
