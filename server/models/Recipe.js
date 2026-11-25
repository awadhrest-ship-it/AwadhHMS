const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/**
 * Phase 7 recipe. One recipe per menu item (unique). Ingredients are real Phase 4 inventory items - there is no second ingredient catalogue.
 * `ingredients[].quantity` is the amount needed for the WHOLE batch the recipe yields (`yield.quantity` servings), in `unit` (any unit the
 * inventory item can be converted from). Every edit bumps `version` and writes an immutable RecipeVersion; sales snapshot what they consumed.
 */
const ingredient = new Schema({ item: { ...ref('InventoryItem'), required: true }, quantity: { type: Number, required: true, min: 0 }, unit: { type: String, required: true, lowercase: true }, note: String }, { _id: true });
const schema = new Schema({
  menuItem: { ...ref('MenuItem'), required: true, unique: true },
  name: { type: String, required: true, trim: true },
  description: String, instructions: String,
  yield: { _id: false, quantity: { type: Number, default: 1, min: 0 }, label: { type: String, default: 'serving' } },
  ingredients: { type: [ingredient], default: [] },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  createdBy: ref('User'), createdByName: String, updatedBy: ref('User'), updatedByName: String,
}, { timestamps: true });
module.exports = model('Recipe', schema);
