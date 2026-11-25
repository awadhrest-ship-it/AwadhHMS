const { Schema, model } = require('mongoose');
module.exports = model('RoomCategory', new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: String,
  capacity: { type: Number, default: 2, min: 1 },
  amenities: [String],
  photos: [String],
  basePrice: { type: Number, required: true, min: 0 },
  extraBedCharge: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true }));
