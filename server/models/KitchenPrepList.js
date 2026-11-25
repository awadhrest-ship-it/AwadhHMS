const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/**
 * Daily preparation list - ONE per business date. Tasks hold PLANNED quantity (what the kitchen intends to prepare) and ACTUAL / REMAINING quantity
 * (what was really prepared / is left). Preparation NEVER touches inventory: ingredients are consumed when the dish is SOLD (bill finalised) and
 * discarded stock goes through wastage - so the same ingredient can never be deducted twice.
 */
const task = new Schema({
  menuItem: ref('MenuItem'), title: { type: String, required: true, trim: true },
  station: String, plannedQty: { type: Number, required: true, min: 0 }, unit: { type: String, default: 'portion' },
  actualQty: { type: Number, default: null }, remainingQty: { type: Number, default: null },
  assignedTo: ref('User'), assignedToName: String, instructions: String,
  status: { type: String, enum: ['Pending', 'In Progress', 'Completed'], default: 'Pending' },
  startedAt: Date, completedAt: Date, completedBy: ref('User'), completedByName: String,
  createdBy: ref('User'), updatedBy: ref('User'), updatedByName: String, updatedAt: Date,
});
const schema = new Schema({
  businessDate: { type: String, required: true, unique: true },                       // YYYY-MM-DD (IST)
  title: String, notes: String,
  tasks: { type: [task], default: [] },
  createdBy: ref('User'), createdByName: String, updatedBy: ref('User'), updatedByName: String,
}, { timestamps: true });
module.exports = model('KitchenPrepList', schema);
