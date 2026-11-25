const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/**
 * A kitchen wastage record. Two kinds: an `ingredient` (an inventory item thrown away) or a `dish` (portions of a menu item thrown away - its recipe
 * ingredients are written off, because dishes are only consumed from stock when SOLD). Stock is changed ONLY through the stock engine (type Wastage);
 * `idempotencyKey` is unique so a re-submitted request can never deduct twice.
 */
const schema = new Schema({
  wastageNumber: { type: String, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['ingredient', 'dish'], required: true },
  status: { type: String, enum: ['Pending', 'Posted', 'Failed'], default: 'Pending', index: true },
  item: ref('InventoryItem'), itemName: String, sku: String,                       // ingredient wastage
  menuItem: ref('MenuItem'), menuItemName: String, recipe: ref('Recipe'), recipeVersion: Number, // dish wastage
  quantity: { type: Number, required: true }, unit: { type: String, required: true },
  lines: [{ _id: false, item: ref('InventoryItem'), sku: String, itemName: String, baseQty: Number, baseUnit: String, cost: Number, costComplete: Boolean }], // what was written off, per inventory item
  station: { type: String }, department: { type: String, default: 'Kitchen' },
  reason: { type: String, required: true }, notes: String,
  order: ref('RestaurantOrder'), orderNumber: String, prepTask: Schema.Types.ObjectId, prepList: ref('KitchenPrepList'),
  businessDate: { type: String, index: true }, occurredAt: { type: Date, default: Date.now, index: true },
  movement: ref('StockMovement'), movementNumber: String, failureReason: String,
  cost: { type: Number, default: 0 }, costComplete: { type: Boolean, default: true },
  recordedBy: ref('User'), recordedByName: String,
  noteHistory: [{ _id: false, at: Date, by: ref('User'), byName: String, was: String }],
}, { timestamps: true });
schema.index({ businessDate: 1, station: 1 });
module.exports = model('KitchenWastage', schema);
