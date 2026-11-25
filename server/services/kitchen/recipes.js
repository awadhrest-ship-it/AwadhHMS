/**
 * Module 7.3 (A, B, G) - recipes, ingredient mapping and food cost.
 *
 *  - A recipe belongs to ONE menu item and lists real Phase 4 inventory items with a quantity + unit (any unit the item can be converted from -
 *    the existing conversion engine decides, and refuses invalid conversions). There is no second ingredient catalogue.
 *  - Every change bumps `version` and stores an immutable RecipeVersion. Sales snapshot the recipe they used, so editing a recipe never rewrites history.
 *  - Food cost = ingredient cost / selling price x 100, using real inventory cost data: the item's latest purchase price, else the weighted cost of the
 *    stock lots on hand. If an ingredient has no reliable cost the result is flagged INCOMPLETE - a number is never invented.
 */
const { Recipe, RecipeVersion, MenuItem, InventoryItem, StockBalance } = require('../../models');
const U = require('../inventory/units');
const { audit } = require('../audit');
const { escapeRegex } = require('../../utils/wrap');
const { bad, conflict, notFound } = require('../../utils/ApiError');
const { rup } = require('./core');

const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
const popMenu = { path: 'menuItem', select: 'name code price category active available station taxable', populate: { path: 'category', select: 'name' } };

/** Cost per BASE unit for an item: latest purchase price, else weighted average of on-hand lots that carry a cost. */
function unitCostOf(item, lots) {
  const p = item.lastPurchase?.pricePerBase; if (p > 0) return { unitCost: p, source: 'Last purchase price' };
  const priced = (lots || []).filter((l) => l.unitCost > 0 && l.qtyQ > 0); const q = priced.reduce((s, l) => s + l.qtyQ, 0);
  if (q > 0) return { unitCost: priced.reduce((s, l) => s + l.unitCost * l.qtyQ, 0) / q, source: 'Stock on hand (weighted)' };
  return { unitCost: null, source: null };
}
async function costContext(itemIds) {
  const ids = [...new Set(itemIds.map(String))];
  const [items, lots, units] = await Promise.all([InventoryItem.find({ _id: { $in: ids } }).lean(), StockBalance.find({ item: { $in: ids }, qtyQ: { $gt: 0 } }).select('item qtyQ unitCost').lean(), U.loadUnits()]);
  return { items: new Map(items.map((i) => [String(i._id), i])), lots: lots.reduce((m, l) => ((m[String(l.item)] = m[String(l.item)] || []).push(l), m), {}), units };
}
/** Pure cost calculation from a recipe-like object and a cost context. */
function costOf(recipe, ctx, price) {
  const lines = []; const missing = [];
  for (const g of recipe.ingredients || []) {
    const item = ctx.items.get(String(g.item?._id || g.item)); let baseQty = null, unitCost = null, source = null, cost = null, problem = null;
    if (!item) problem = 'Inventory item not found';
    else { try { baseQty = U.toBase(item, g.quantity, g.unit, ctx.units).baseQty; } catch (e) { problem = e.message; } }
    if (item && baseQty != null) { ({ unitCost, source } = unitCostOf(item, ctx.lots[String(item._id)])); if (unitCost != null) cost = r4(baseQty * unitCost); }
    if (cost == null) missing.push(item?.name || 'Unknown item');
    lines.push({ item: item?._id, sku: item?.sku, name: item?.name, quantity: g.quantity, unit: g.unit, baseQty, baseUnit: item?.baseUnit, unitCostPerBase: unitCost != null ? r4(unitCost) : null, costSource: source, cost, problem });
  }
  const known = lines.reduce((s, l) => s + (l.cost || 0), 0); const y = recipe.yield?.quantity > 0 ? recipe.yield.quantity : 1; const complete = missing.length === 0 && lines.length > 0;
  const perServingKnown = known / y;
  return { ingredients: lines, yield: { quantity: y, label: recipe.yield?.label || 'serving' }, totalCost: rup(known), costPerServing: r4(perServingKnown), complete, missing,
    sellingPrice: price ?? null,
    foodCostPercent: complete && price > 0 ? Math.round((perServingKnown / price) * 10000) / 100 : null,
    knownFoodCostPercent: price > 0 && lines.length ? Math.round((perServingKnown / price) * 10000) / 100 : null,   // shown with an "incomplete" warning when !complete
    grossContribution: complete && price != null ? rup(price - perServingKnown) : null };
}

/* ---------------------------------------------------------------- validation */
async function buildIngredients(raw, units) {
  if (!Array.isArray(raw) || !raw.length) throw bad('Add at least one ingredient');
  if (raw.length > 60) throw bad('Too many ingredients (max 60)');
  const ids = [...new Set(raw.map((g) => String(g.item)))]; if (ids.length !== raw.length) throw bad('An ingredient is listed twice - combine the quantities into one line');
  const items = new Map((await InventoryItem.find({ _id: { $in: ids } }).lean()).map((i) => [String(i._id), i]));
  return raw.map((g, n) => {
    const item = items.get(String(g.item)); const at = `Ingredient ${n + 1}`;
    if (!item) throw bad(`${at}: that inventory item does not exist`);
    if (!item.active) throw bad(`${at}: ${item.name} is inactive`);
    const unit = String(g.unit || item.usageUnit || item.baseUnit).toLowerCase();
    try { U.toBase(item, g.quantity, unit, units); } catch (e) { throw bad(`${at} (${item.name}): ${e.message}`); }       // invalid conversions / zero / negative are refused here
    return { item: item._id, quantity: Number(g.quantity), unit, note: g.note?.trim() || undefined, _snap: { sku: item.sku, itemName: item.name, baseUnit: item.baseUnit, baseQty: U.toBase(item, g.quantity, unit, units).baseQty } };
  });
}
const snapshot = (recipe, ing, by, note) => ({ recipe: recipe._id, version: recipe.version, menuItem: recipe.menuItem?._id || recipe.menuItem, name: recipe.name, description: recipe.description, instructions: recipe.instructions, active: recipe.active, yield: recipe.yield,
  ingredients: ing.map((g) => ({ item: g.item, ...g._snap, quantity: g.quantity, unit: g.unit, note: g.note })), changeNote: note, createdBy: by?._id, createdByName: by?.name });
async function writeVersion(doc) { try { await RecipeVersion.create(doc); } catch (e) { if (!(e.code === 11000 || /E11000/.test(e.message || ''))) throw e; } }

/* ---------------------------------------------------------------- reads */
async function getRecipe(id) {
  const r = await Recipe.findById(id).populate(popMenu); if (!r) throw notFound('Recipe not found');
  const ctx = await costContext(r.ingredients.map((g) => g.item)); const o = r.toObject();
  return { ...o, ingredients: o.ingredients.map((g) => ({ ...g, itemName: ctx.items.get(String(g.item))?.name, sku: ctx.items.get(String(g.item))?.sku, baseUnit: ctx.items.get(String(g.item))?.baseUnit, convertibleUnits: ctx.items.get(String(g.item)) ? U.convertibleUnits(ctx.items.get(String(g.item)), ctx.units) : [] })), cost: costOf(o, ctx, r.menuItem?.price) };
}
async function listRecipes(q = {}) {
  const f = {}; if (q.active === 'true') f.active = true; if (q.active === 'false') f.active = false;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); const mi = await MenuItem.find({ name: rx }).select('_id').lean(); f.$or = [{ name: rx }, { menuItem: { $in: mi.map((m) => m._id) } }]; }
  const rows = await Recipe.find(f).populate(popMenu).sort({ name: 1 }).limit(500);
  const ctx = await costContext(rows.flatMap((r) => r.ingredients.map((g) => g.item)));
  return rows.map((r) => { const o = r.toObject(); const c = costOf(o, ctx, r.menuItem?.price); return { _id: o._id, name: o.name, menuItem: o.menuItem, active: o.active, version: o.version, ingredientCount: o.ingredients.length, yield: o.yield, updatedAt: o.updatedAt, updatedByName: o.updatedByName,
    cost: { costPerServing: c.costPerServing, complete: c.complete, foodCostPercent: c.foodCostPercent, knownFoodCostPercent: c.knownFoodCostPercent, grossContribution: c.grossContribution, sellingPrice: c.sellingPrice } }; });
}
async function versions(id) { if (!(await Recipe.exists({ _id: id }))) throw notFound('Recipe not found'); return RecipeVersion.find({ recipe: id }).sort({ version: -1 }).lean(); }
/** Menu items still without a recipe (so the kitchen can see what will consume nothing when sold). */
async function menuWithoutRecipe() {
  const have = new Set((await Recipe.find({ active: true }).select('menuItem').lean()).map((r) => String(r.menuItem)));
  return (await MenuItem.find({ active: true }).populate('category', 'name').select('name code price category station').sort({ name: 1 }).lean()).filter((m) => !have.has(String(m._id)));
}
/** Inventory items for the ingredient picker, with the units each can be entered in (works for anyone who may view recipes - no inventory permission needed). */
async function ingredientPicker(q = {}) {
  const f = { active: true }; if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); f.$or = [{ name: rx }, { sku: rx }]; }
  const [items, units] = await Promise.all([InventoryItem.find(f).populate('category', 'name').sort({ name: 1 }).limit(60).lean(), U.loadUnits()]);
  return items.map((i) => ({ _id: i._id, sku: i.sku, name: i.name, category: i.category?.name, baseUnit: i.baseUnit, usageUnit: i.usageUnit, units: U.convertibleUnits(i, units), lastPurchase: i.lastPurchase?.pricePerBase ? { pricePerBase: i.lastPurchase.pricePerBase, date: i.lastPurchase.date } : null }));
}

/* ---------------------------------------------------------------- writes */
async function createRecipe(req, b) {
  const mi = await MenuItem.findById(b.menuItem); if (!mi) throw bad('Choose a menu item');
  if (await Recipe.exists({ menuItem: mi._id })) throw conflict(`${mi.name} already has a recipe - edit that one`);
  const units = await U.loadUnits(); const ing = await buildIngredients(b.ingredients, units);
  let r;
  try { r = await Recipe.create({ menuItem: mi._id, name: b.name?.trim() || mi.name, description: b.description, instructions: b.instructions, yield: { quantity: b.yield?.quantity || 1, label: b.yield?.label || 'serving' }, ingredients: ing.map(({ _snap, ...g }) => g), active: b.active !== false, version: 1, createdBy: req.user._id, createdByName: req.user.name, updatedBy: req.user._id, updatedByName: req.user.name }); }
  catch (e) { if (e.code === 11000) throw conflict(`${mi.name} already has a recipe - edit that one`); throw e; }
  await MenuItem.updateOne({ _id: mi._id }, { $set: { recipe: r._id } });
  await writeVersion(snapshot(r, ing, req.user, 'Created'));
  await audit(req, { action: 'create', module: 'Kitchen', entity: 'Recipe', entityId: r._id, entityLabel: `Recipe ${r.name} v1`, newValue: { menuItem: mi.name, ingredients: ing.map((g) => `${g.quantity} ${g.unit} ${g._snap.itemName}`), yield: r.yield } });
  return getRecipe(r._id);
}
async function updateRecipe(req, id, b) {
  const r = await Recipe.findById(id); if (!r) throw notFound('Recipe not found');
  const before = { name: r.name, yield: r.yield, ingredients: r.ingredients.map((g) => `${g.quantity} ${g.unit} ${String(g.item)}`), active: r.active, version: r.version };
  const set = { updatedBy: req.user._id, updatedByName: req.user.name }; let ing;
  if (b.name !== undefined) set.name = b.name.trim(); if (b.description !== undefined) set.description = b.description; if (b.instructions !== undefined) set.instructions = b.instructions;
  if (b.yield) set.yield = { quantity: b.yield.quantity || r.yield?.quantity || 1, label: b.yield.label || r.yield?.label || 'serving' };
  if (b.ingredients) { ing = await buildIngredients(b.ingredients, await U.loadUnits()); set.ingredients = ing.map(({ _snap, ...g }) => g); }
  const upd = await Recipe.findOneAndUpdate({ _id: id, version: r.version }, { $set: set, $inc: { version: 1 } }, { new: true });
  if (!upd) throw conflict('This recipe was just edited by someone else - reload it');
  const snapIng = ing || await Promise.all(upd.ingredients.map(async (g) => { const it = await InventoryItem.findById(g.item).lean(); return { item: g.item, quantity: g.quantity, unit: g.unit, note: g.note, _snap: { sku: it?.sku, itemName: it?.name, baseUnit: it?.baseUnit, baseQty: it ? U.toBase(it, g.quantity, g.unit, await U.loadUnits()).baseQty : null } }; }));
  await writeVersion(snapshot(upd, snapIng, req.user, b.changeNote || 'Edited'));
  await audit(req, { action: 'update', module: 'Kitchen', entity: 'Recipe', entityId: r._id, entityLabel: `Recipe ${upd.name} v${upd.version}`, oldValue: before, newValue: { name: upd.name, yield: upd.yield, ingredients: snapIng.map((g) => `${g.quantity} ${g.unit} ${g._snap?.itemName}`), version: upd.version }, note: b.changeNote });
  return getRecipe(id);
}
async function setActive(req, id, active, reason) {
  const r = await Recipe.findById(id); if (!r) throw notFound('Recipe not found'); if (r.active === active) return getRecipe(id);
  const upd = await Recipe.findOneAndUpdate({ _id: id, version: r.version }, { $set: { active, updatedBy: req.user._id, updatedByName: req.user.name }, $inc: { version: 1 } }, { new: true });
  if (!upd) throw conflict('This recipe was just edited by someone else - reload it');
  const ing = await Promise.all(upd.ingredients.map(async (g) => { const it = await InventoryItem.findById(g.item).lean(); return { item: g.item, quantity: g.quantity, unit: g.unit, _snap: { sku: it?.sku, itemName: it?.name, baseUnit: it?.baseUnit } }; }));
  await writeVersion(snapshot(upd, ing, req.user, active ? 'Activated' : `Deactivated${reason ? ': ' + reason : ''}`));
  await audit(req, { action: 'status', module: 'Kitchen', entity: 'Recipe', entityId: r._id, entityLabel: `Recipe ${upd.name} ${active ? 'activated' : 'deactivated'}`, oldValue: { active: r.active }, newValue: { active }, note: reason });
  return getRecipe(id);
}

module.exports = { costOf, costContext, unitCostOf, getRecipe, listRecipes, versions, menuWithoutRecipe, ingredientPicker, createRecipe, updateRecipe, setActive, buildIngredients };
