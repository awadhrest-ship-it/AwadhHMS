const { Schema, model } = require('mongoose');
module.exports = model('MenuCategory', new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true }));
