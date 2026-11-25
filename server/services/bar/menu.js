/** Bar menu (Module 8.1): drinks, serving measures (30 ml / 60 ml / full bottle), prices, mixers, availability. Stock links are validated, never assumed. */
const { z } = require('zod');
const { BarMenuItem, InventoryItem } = require('../../models');
const { MEASURES } = require('../../models/bar');
const C = require('./core');
const P = require('./pricing');
const U = require('../inventory/units');
const { audit } = require('../audit');
const { barSettings } = require('../settings');
const { bad, notFound, conflict } = require('../../utils/ApiError');
const { parse, escapeRegex } = require('../../utils/wrap');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const serving = z.object({ _id: oid.optional(), measure: z.enum(MEASURES), ml: z.number().positive().max(5000).optional(), price: z.number().min(0).max(1e6), happyHourPrice: z.number().min(0).max(1e6).nullable().optional(), units: z.number().int().min(1).max(100).optional(), active: z.boolean().optional() });
const mixer = z.object({ _id: oid.optional(), item: oid, quantity: z.number().positive().max(1e6), unit: z.string().trim().min(1).max(20), measures: z.array(z.enum(MEASURES)).min(1).optional() });
const base = z.object({
  name: z.string().trim().min(2).max(80), category: z.string().trim().min(2).max(40).optional(), kind: z.enum(['spirit', 'packaged']).optional(), trackStock: z.boolean().optional(),
  stockItem: oid.nullable().optional(), servings: z.array(serving).min(1).max(6), mixers: z.array(mixer).max(10).optional(), available: z.boolean().optional(), active: z.boolean().optional(), notes: z.string().max(400).optional(),
});

async function present(menu, ctx, extra = {}) {
  const m = menu.toObject ? menu.toObject() : menu; const st = await C.menuStatus(m, ctx);
  const item = m.stockItem ? (await C.loadItems([m.stockItem])).get(String(m.stockItem)) : null;
  const price = (s) => P.priceFor(m, s, ctx.settings);
  return { ...m, consumptionStatus: st.status, consumptionProblems: st.problems, stockItemName: item?.name, bottleCapacityMl: item ? C.capacityOf(item, ctx.units) : null,
    servings: m.servings.map((s) => { const p = price(s); return { ...s, currentPrice: p.unitPrice, happyHourActive: p.happyHour.applied, happyHourRule: p.happyHour.rule }; }), ...extra };
}
function validateShape(b) {
  const kind = b.kind || 'spirit'; const seen = new Set();
  for (const s of b.servings) {
    if (seen.has(s.measure)) throw bad(`${s.measure} is listed twice`); seen.add(s.measure);
    if (kind === 'spirit' && s.measure !== 'Full bottle' && !s.ml) throw bad(`Enter the measure in ml for the ${s.measure} serving`);
    if (kind === 'packaged' && s.measure !== 'Full bottle') throw bad('Packaged drinks (beer, soft drinks) are sold as "Full bottle" - one unit per serving');
    if (s.happyHourPrice != null && s.happyHourPrice > s.price) throw bad(`${s.measure}: the happy-hour price cannot be higher than the normal price`);
  }
  if (b.trackStock !== false && !b.stockItem) { /* allowed: shown as Incomplete until linked */ }
}
async function checkLinks(b) {
  const ids = [b.stockItem, ...(b.mixers || []).map((m) => m.item)].filter(Boolean); const items = await C.loadItems(ids);
  for (const id of ids) if (!items.has(String(id))) throw bad('A linked inventory item was not found');
  const units = await U.loadUnits();
  for (const m of b.mixers || []) { const it = items.get(String(m.item)); try { U.factorToBase(it, m.unit, units); } catch (e) { throw bad(`Mixer ${it.name}: ${e.message}`); } }
}
async function list(q = {}) {
  const f = {}; if (q.active !== 'all') f.active = q.active === 'false' ? false : true; if (q.category) f.category = q.category;
  if (q.q) f.name = { $regex: escapeRegex(q.q), $options: 'i' };
  const rows = await BarMenuItem.find(f).sort({ category: 1, name: 1 }).lean(); const ctx = await C.menuContext();
  const out = []; for (const r of rows) out.push(await present(r, ctx));
  return out;
}
async function get(id) { const m = await BarMenuItem.findById(id); if (!m) throw notFound('Menu item not found'); return present(m, await C.menuContext()); }
async function create(req, body) {
  const b = parse(base, body); validateShape(b); await checkLinks(b);
  if (await BarMenuItem.exists({ name: new RegExp(`^${escapeRegex(b.name)}$`, 'i') })) throw conflict(`"${b.name}" is already on the bar menu`);
  const m = await BarMenuItem.create({ ...b, stockItem: b.stockItem || undefined, createdBy: req.user._id });
  await audit(req, { action: 'create', module: 'Bar', entity: 'BarMenuItem', entityId: m._id, entityLabel: m.name, newValue: m });
  return present(m, await C.menuContext());
}
async function update(req, id, body) {
  const b = parse(base.partial(), body); const m = await BarMenuItem.findById(id); if (!m) throw notFound('Menu item not found');
  const before = m.toObject(); const merged = { ...before, ...b, servings: b.servings || before.servings, mixers: b.mixers || before.mixers };
  validateShape(merged); await checkLinks(merged);
  if (b.name && b.name.toLowerCase() !== before.name.toLowerCase() && await BarMenuItem.exists({ name: new RegExp(`^${escapeRegex(b.name)}$`, 'i'), _id: { $ne: id } })) throw conflict(`"${b.name}" is already on the bar menu`);
  for (const [k, v] of Object.entries(b)) { if (k === 'stockItem') m.stockItem = v || undefined; else m.set(k, v); }
  m.updatedBy = req.user._id; await m.save();
  await audit(req, { action: 'update', module: 'Bar', entity: 'BarMenuItem', entityId: m._id, entityLabel: m.name, oldValue: before, newValue: m });
  return present(m, await C.menuContext());
}
async function setAvailable(req, id, available) {
  const m = await BarMenuItem.findById(id); if (!m) throw notFound('Menu item not found'); const was = m.available; m.available = !!available; m.updatedBy = req.user._id; await m.save();
  await audit(req, { action: 'status', module: 'Bar', entity: 'BarMenuItem', entityId: m._id, entityLabel: m.name, oldValue: { available: was }, newValue: { available: m.available } });
  return present(m, await C.menuContext());
}
/** Liquor inventory items that can be linked: category Liquor. Reports which are missing a bottle capacity. */
async function liquorItems() {
  const settings = await barSettings(); const units = await U.loadUnits();
  const items = await InventoryItem.find({ active: true }).populate('category', 'name').sort({ name: 1 }).lean();
  return items.map((i) => ({ ...i, categoryName: i.category?.name })).filter((i) => settings.liquorCategories.includes(i.categoryName) || ['Soft drinks'].includes(i.categoryName) || (settings.trackedCategories || []).includes(i.categoryName))
    .map((i) => ({ _id: i._id, sku: i.sku, name: i.name, category: i.categoryName, baseUnit: i.baseUnit, isLiquor: settings.liquorCategories.includes(i.categoryName), bottleCapacityMl: C.capacityOf(i, units), conversions: i.conversions, usageUnit: i.usageUnit }));
}
/** Set the bottle capacity (the explicit "bottle" conversion) of a liquor item. Uses the item's own conversion list, so Phase 4 stays the single source. */
async function setCapacity(req, itemId, capacityMl) {
  const item = await InventoryItem.findById(itemId).populate('category', 'name'); if (!item) throw notFound('Inventory item not found');
  const settings = await barSettings();
  if (!settings.liquorCategories.includes(item.category?.name)) throw bad(`${item.name} is not in a liquor category`);
  if (item.baseUnit !== 'ml') throw bad(`${item.name} is stored in ${item.baseUnit}. Bottle-capacity tracking needs a base unit of ml - create the liquor item with ml as its stock unit.`);
  const cap = Number(capacityMl); if (!(cap >= 10 && cap <= 10000)) throw bad('Bottle capacity must be between 10 and 10000 ml');
  const before = item.toObject(); const cv = item.conversions.find((c) => c.unit === 'bottle');
  if (cv) cv.factor = cap; else item.conversions.push({ unit: 'bottle', factor: cap });
  if (!item.purchaseUnit) item.purchaseUnit = 'bottle'; item.updatedBy = req.user._id; await item.save();
  await audit(req, { action: 'update', module: 'Bar', entity: 'InventoryItem', entityId: item._id, entityLabel: `${item.name} bottle capacity`, oldValue: { conversions: before.conversions }, newValue: { conversions: item.conversions } });
  return { _id: item._id, name: item.name, bottleCapacityMl: cap };
}
module.exports = { list, get, create, update, setAvailable, liquorItems, setCapacity, present };
