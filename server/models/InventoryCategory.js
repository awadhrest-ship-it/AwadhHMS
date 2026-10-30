const { Schema, model } = require('mongoose');
module.exports = model('InventoryCategory', new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  key: { type: String, trim: true, lowercase: true },       // stable integration key (linen, toiletries, cleaning_supplies...) so renaming never breaks Housekeeping
  description: String,
  defaultDepartment: String,                                 // suggestion only; stock can be held in any stock department
  trackExpiryDefault: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 100 },
  isSystem: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true }));
