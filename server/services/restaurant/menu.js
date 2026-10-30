/**
 * Module 6.2 - menu categories & items. Items are soft-deactivated, never deleted; prices are snapshotted onto order lines so editing
 * the menu can never change an order or bill that already exists. `available` is today's availability (kitchen toggles it) and is enforced
 * on the server whenever items are added to an order. Inventory is intentionally NOT linked: recipe -> ingredient consumption is Phase 7.
 */
const { MenuCategory, MenuItem } = require('../../models');
const { audit } = require('../audit');
const { escapeRegex } = require('../../utils/wrap');
const { bad, conflict, notFound } = require('../../utils/ApiError');

/* ---- categories ---- */
async function listCategories({ all = false } = {}) {
  const cats = await MenuCategory.find(all ? {} : { active: true }).sort({ sortOrder: 1, name: 1 }).lean();
  const counts = await MenuItem.aggregate([{ $group: { _id: { c: '$category', a: '$active' }, n: { $sum: 1 } } }]);
  return cats.map((c) => ({ ...c, itemCount: counts.filter((x) => String(x._id.c) === String(c._id) && x._id.a).reduce((s, x) => s + x.n, 0) }));
}
async function createCategory(req, b) {
  if (await MenuCategory.exists({ name: new RegExp(`^${escapeRegex(b.name.trim())}$`, 'i') })) throw conflict(`Category "${b.name}" already exists`);
  const c = await MenuCategory.create({ name: b.name.trim(), sortOrder: b.sortOrder ?? 0 });
  await audit(req, { action: 'create', module: 'Restaurant', entity: 'MenuCategory', entityId: c._id, entityLabel: c.name, newValue: c });
  return c;
}
async function updateCategory(req, id, b) {
  const c = await MenuCategory.findById(id); if (!c) throw notFound('Category not found');
  const before = c.toObject();
  if (b.name && b.name.trim().toLowerCase() !== c.name.toLowerCase()) {
    if (await MenuCategory.exists({ _id: { $ne: c._id }, name: new RegExp(`^${escapeRegex(b.name.trim())}$`, 'i') })) throw conflict(`Category "${b.name}" already exists`);
    c.name = b.name.trim();
  }
  if (b.sortOrder !== undefined) c.sortOrder = b.sortOrder;
  if (b.active !== undefined) {
    if (b.active === false && (await MenuItem.exists({ category: c._id, active: true }))) throw conflict('This category still has active items - deactivate or move them first');
    c.active = b.active;
  }
  await c.save();
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'MenuCategory', entityId: c._id, entityLabel: c.name, oldValue: before, newValue: c });
  return c;
}

/* ---- items ---- */
const popCat = { path: 'category', select: 'name sortOrder active' };
async function listItems(q = {}) {
  const f = {};
  if (q.active === 'false') f.active = false; else if (q.active !== 'all') f.active = true;
  if (q.category) f.category = q.category;
  if (q.available === 'true') f.available = true; if (q.available === 'false') f.available = false;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); f.$or = [{ name: rx }, { code: rx }, { description: rx }]; }
  return MenuItem.find(f).sort({ name: 1 }).populate(popCat).limit(500);
}
async function getItem(id) { const i = await MenuItem.findById(id).populate(popCat); if (!i) throw notFound('Menu item not found'); return i; }

async function assertCodeFree(code, excludeId) {
  if (!code) return;
  const q = { code: code.toUpperCase() }; if (excludeId) q._id = { $ne: excludeId };
  if (await MenuItem.exists(q)) throw conflict(`Item code "${code}" is already used`);
}
async function createItem(req, b) {
  const cat = await MenuCategory.findById(b.category); if (!cat || !cat.active) throw bad('Choose an active category');
  await assertCodeFree(b.code);
  const i = await MenuItem.create({ code: b.code || undefined, name: b.name.trim(), description: b.description || '', category: cat._id, price: b.price, taxable: b.taxable !== false,
    isVeg: b.isVeg ?? null, available: b.available !== false, isDemo: !!b.isDemo, priceHistory: [{ price: b.price, at: new Date(), by: req.user?._id }] });
  await audit(req, { action: 'create', module: 'Restaurant', entity: 'MenuItem', entityId: i._id, entityLabel: i.name, newValue: i });
  return getItem(i._id);
}
async function updateItem(req, id, b) {
  const i = await MenuItem.findById(id); if (!i) throw notFound('Menu item not found');
  const before = i.toObject();
  if (b.category) { const cat = await MenuCategory.findById(b.category); if (!cat || !cat.active) throw bad('Choose an active category'); i.category = cat._id; }
  if (b.code !== undefined) { await assertCodeFree(b.code, i._id); i.code = b.code || undefined; }
  for (const k of ['name', 'description', 'taxable', 'isVeg']) if (b[k] !== undefined) i[k] = typeof b[k] === 'string' ? b[k].trim() : b[k];
  if (b.price !== undefined && b.price !== i.price) { i.price = b.price; i.priceHistory.push({ price: b.price, at: new Date(), by: req.user._id }); } // existing orders keep their own snapshot
  if (b.active !== undefined) { i.active = b.active; if (!b.active) i.available = false; }
  await i.save();
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'MenuItem', entityId: i._id, entityLabel: i.name, oldValue: before, newValue: i });
  return getItem(i._id);
}
async function setAvailability(req, id, available, reason) {
  const i = await MenuItem.findById(id); if (!i) throw notFound('Menu item not found');
  if (!i.active && available) throw bad('Reactivate the item before marking it available');
  if (i.available === available) return getItem(id);
  await MenuItem.updateOne({ _id: id }, { $set: { available, unavailableReason: available ? undefined : (reason || undefined), availabilityChangedAt: new Date(), availabilityChangedBy: req.user._id } });
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'MenuItem', entityId: i._id, entityLabel: i.name, oldValue: { available: i.available }, newValue: { available }, note: reason });
  return getItem(id);
}
/** Start-of-day: mark every active item available again. */
async function resetAvailability(req) {
  const r = await MenuItem.updateMany({ active: true, available: false }, { $set: { available: true, availabilityChangedAt: new Date(), availabilityChangedBy: req.user._id }, $unset: { unavailableReason: 1 } });
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'MenuItem', entityLabel: 'All items', newValue: { available: true }, note: `Availability reset (${r.modifiedCount ?? r.matchedCount} items)` });
  return { reset: r.modifiedCount ?? r.matchedCount ?? 0 };
}
/** The order-taking view: active categories with their active items (unavailable ones are included but flagged so the POS can grey them out). */
async function posMenu() {
  const cats = await MenuCategory.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
  const items = await MenuItem.find({ active: true }).sort({ name: 1 }).select('code name description category price taxable isVeg available unavailableReason').lean();
  return cats.map((c) => ({ ...c, items: items.filter((i) => String(i.category) === String(c._id)) })).filter((c) => c.items.length);
}
module.exports = { listCategories, createCategory, updateCategory, listItems, getItem, createItem, updateItem, setAvailability, resetAvailability, posMenu };
