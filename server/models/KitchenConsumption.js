const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const STATUSES = ['Pending', 'Posted', 'No Recipe', 'Failed', 'Waived'];
/**
 * Ingredient consumption for ONE finalised restaurant bill (the "sale" event). `bill` is unique: a bill can only ever have one record, so a retried
 * request / restart / double click cannot consume twice. The record is created Pending (with a frozen snapshot of the recipes used) BEFORE the stock
 * movement is posted; the movement itself carries a stable idempotency key derived from this record, so a crash at any point is recoverable.
 */
const schema = new Schema({
  bill: { ...ref('RestaurantBill'), required: true, unique: true },
  billNumber: String, order: { ...ref('RestaurantOrder'), index: true }, orderNumber: String, orderType: String, businessDate: { type: String, index: true },
  status: { type: String, enum: STATUSES, default: 'Pending', index: true },
  department: String,
  // frozen snapshot: one entry per bill line sold
  lines: [{ _id: false, orderItem: Schema.Types.ObjectId, menuItem: ref('MenuItem'), name: String, quantity: Number, sellingValue: Number,
    state: { type: String, enum: ['Consumed', 'No recipe', 'Recipe inactive', 'Already consumed'], default: 'Consumed' },
    recipe: ref('Recipe'), recipeVersion: Number, recipeName: String, yieldQuantity: Number, portions: Number,
    ingredients: [{ _id: false, item: ref('InventoryItem'), sku: String, itemName: String, perBatchQty: Number, perBatchUnit: String, baseQty: Number, baseUnit: String }] }],
  // what was asked of the stock engine (aggregated per inventory item, in the item's base unit)
  requirements: [{ _id: false, item: ref('InventoryItem'), sku: String, itemName: String, baseQty: Number, baseUnit: String, cost: Number, costComplete: { type: Boolean, default: false } }],
  movement: ref('StockMovement'), movementNumber: String, idempotencyKey: String,
  foodCost: { type: Number, default: 0 }, costComplete: { type: Boolean, default: true }, sellingValue: { type: Number, default: 0 },
  failureReason: String, failureDetails: Schema.Types.Mixed, attempts: { type: Number, default: 0 },
  history: [{ _id: false, at: Date, by: ref('User'), byName: String, action: String, note: String }],
  triggeredBy: ref('User'), triggeredByName: String, postedAt: Date,
}, { timestamps: true });
schema.index({ createdAt: -1 });
const M = model('KitchenConsumption', schema); M.STATUSES = STATUSES;
module.exports = M;
