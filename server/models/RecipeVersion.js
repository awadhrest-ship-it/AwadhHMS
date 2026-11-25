const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/** Immutable snapshot of a recipe at one version (never updated). Ingredient names / units are copied so history survives later item edits. */
const schema = new Schema({
  recipe: { ...ref('Recipe'), required: true }, version: { type: Number, required: true },
  menuItem: ref('MenuItem'), name: String, description: String, instructions: String, active: Boolean,
  yield: { _id: false, quantity: Number, label: String },
  ingredients: [{ _id: false, item: ref('InventoryItem'), sku: String, itemName: String, quantity: Number, unit: String, baseQty: Number, baseUnit: String, note: String }],
  changeNote: String, createdBy: ref('User'), createdByName: String,
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ recipe: 1, version: 1 }, { unique: true });
module.exports = model('RecipeVersion', schema);
