const { InventoryItem, InventoryCategory, StockBalance, StockLedger, PriceHistory } = require('../../models');
const { audit } = require('../audit');
const { inventorySettings } = require('../settings');
const { scope, assertDepartment } = require('./access');
const stock = require('./stock');
const U = require('./units');
const { bad, conflict, notFound } = require('../../utils/ApiError');
const { escapeRegex } = require('../../utils/wrap');
const { today, addDays } = require('../../utils/dates');

const pick = (b, keys) => Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
const FIELDS = ['name', 'category', 'description', 'minStockLevel', 'trackExpiry'];

async function cleanMinLevels(list, settings) {
  const seen = new Set(); const out = [];
  for (const m of list || []) {
    if (!settings.stockDepartments.includes(m.department)) throw bad(`"${m.department}" is not a stock department`);
    if (seen.has(m.department)) throw bad(`Minimum level for ${m.department} is listed twice`);
    seen.add(m.department); out.push({ department: m.department, minLevel: m.minLevel });
  }
  return out;
}

async function createItem(req, body) {
  const [units, settings] = [await U.loadUnits(), await inventorySettings()];
  const cat = await InventoryCategory.findById(body.category);
  if (!cat || !cat.active) throw bad('Choose an active category');
  const unitFields = U.validateItemUnits(body, units);
  const doc = { ...pick(body, FIELDS), ...unitFields, sku: body.sku, minLevels: await cleanMinLevels(body.minLevels, settings), createdBy: req.user._id, updatedBy: req.user._id, isDemo: !!body.isDemo };
  if (doc.trackExpiry === undefined) doc.trackExpiry = cat.trackExpiryDefault;
  const item = await InventoryItem.create(doc);
  await audit(req, { action: 'create', module: 'Inventory', entity: 'InventoryItem', entityId: item._id, entityLabel: `${item.sku} ${item.name}`, newValue: item });
  if (body.openingStock?.length) {
    try {
      await stock.postMovement(req, { type: 'Opening Stock', rawKey: true, idempotencyKey: `opening:${item._id}`, reason: 'Opening stock', source: 'inventory',
        lines: body.openingStock.map((o) => ({ item: item._id, quantity: o.quantity, unit: o.unit || item.baseUnit, toDepartment: o.department, unitPrice: o.unitPrice, expiryDate: o.expiryDate, lotNo: o.lotNo })) });
    } catch (e) { await InventoryItem.deleteOne({ _id: item._id }); throw e; }   // item without its intended opening stock would be misleading
  }
  return item;
}

async function updateItem(req, id, body) {
  const item = await InventoryItem.findById(id);
  if (!item) throw notFound('Item not found');
  const [units, settings] = [await U.loadUnits(), await inventorySettings()];
  const before = item.toObject();
  const merged = { name: item.name, baseUnit: item.baseUnit, conversions: item.conversions, purchaseUnit: item.purchaseUnit, usageUnit: item.usageUnit, ...body };
  if (body.baseUnit && body.baseUnit !== item.baseUnit && (await StockLedger.exists({ item: item._id }))) throw conflict('The stock unit cannot be changed once the item has stock movements. Add a conversion instead.');
  if (body.category) { const c = await InventoryCategory.findById(body.category); if (!c) throw bad('Category not found'); }
  const unitFields = U.validateItemUnits({ ...merged, conversions: (body.conversions || item.conversions || []).map((c) => ({ unit: c.unit, factor: c.factor })) }, units);
  Object.assign(item, pick(body, FIELDS), unitFields, { updatedBy: req.user._id });
  if (body.minLevels) item.minLevels = await cleanMinLevels(body.minLevels, settings);
  if (body.sku && body.sku.toUpperCase() !== item.sku) { if (await StockLedger.exists({ item: item._id })) throw conflict('The item code cannot change once the item has stock movements'); item.sku = body.sku; }
  await item.save();
  await audit(req, { action: 'update', module: 'Inventory', entity: 'InventoryItem', entityId: item._id, entityLabel: `${item.sku} ${item.name}`, oldValue: before, newValue: item });
  if (body.minLevels || body.minStockLevel !== undefined) await require('./alerts').evaluate(req, [{ item: item._id }]);
  return item;
}

async function setActive(req, id, active) {
  const item = await InventoryItem.findById(id); if (!item) throw notFound('Item not found');
  if (!active) { const left = await stock.onHand(item._id); if (left > 0) throw conflict(`${item.name} still has ${left} ${item.baseUnit} in stock. Move or write it off before deactivating.`); }
  const before = item.toObject(); item.active = active; await item.save();
  await audit(req, { action: active ? 'update' : 'delete', module: 'Inventory', entity: 'InventoryItem', entityId: item._id, entityLabel: `${item.sku} ${item.name}`, oldValue: { active: before.active }, newValue: { active } });
  return item;
}

/** Stock per item inside the caller's department scope. */
async function stockMap(sc, extra = {}) {
  const filter = sc.all ? {} : { department: { $in: sc.departments } };
  const lots = await StockBalance.find({ ...filter, ...extra }).lean();
  const map = new Map();
  for (const l of lots) {
    const e = map.get(String(l.item)) || { total: 0, byDept: {}, lots: [], nextExpiry: null, value: 0 };
    e.total += l.qtyQ; e.byDept[l.department] = (e.byDept[l.department] || 0) + l.qtyQ;
    if (l.qtyQ > 0) { e.lots.push(l); e.value += (l.qtyQ / U.SCALE) * (l.unitCost || 0); if (l.expiryDate && (!e.nextExpiry || new Date(l.expiryDate) < e.nextExpiry)) e.nextExpiry = new Date(l.expiryDate); }
    map.set(String(l.item), e);
  }
  return map;
}

const present = (item, e, sc, settings, t) => {
  const total = U.fromQ(e?.total || 0);
  const byDept = Object.fromEntries(Object.entries(e?.byDept || {}).filter(([, q]) => q > 0).map(([d, q]) => [d, U.fromQ(q)]));
  const mins = Object.fromEntries((item.minLevels || []).map((m) => [m.department, m.minLevel]));
  const lowDepts = Object.entries(mins).filter(([d, m]) => (sc.all || sc.departments.includes(d)) && U.toQ(m) > 0 && (e?.byDept?.[d] || 0) < U.toQ(m)).map(([d]) => d);
  const lowTotal = sc.all && item.minStockLevel > 0 && (e?.total || 0) < U.toQ(item.minStockLevel);
  const exp = e?.nextExpiry;
  return { ...item, stock: { total, byDepartment: byDept, nextExpiry: exp, lowDepartments: lowDepts, lowTotal, low: lowDepts.length > 0 || lowTotal, out: total === 0,
    expired: !!(exp && exp < t), expiringSoon: !!(exp && exp >= t && exp <= addDays(t, settings.expiryWarningDays)), value: Math.round((e?.value || 0) * 100) / 100 } };
};

async function listItems(req, q) {
  const [sc, settings] = [await scope(req), await inventorySettings()];
  const f = {};
  f.active = q.active === 'all' ? { $in: [true, false] } : q.active === 'false' ? false : true;
  if (q.category) f.category = q.category;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); f.$or = [{ name: rx }, { sku: rx }, { description: rx }]; }
  const [items, map] = await Promise.all([InventoryItem.find(f).populate('category', 'name key').sort({ name: 1 }).lean(), stockMap(sc)]);
  const t = today();
  let rows = items.map((i) => present(i, map.get(String(i._id)), sc, settings, t));
  if (q.department) rows = rows.filter((r) => (r.stock.byDepartment[q.department] || 0) > 0 || (r.minLevels || []).some((m) => m.department === q.department));
  if (q.status === 'low') rows = rows.filter((r) => r.stock.low);
  else if (q.status === 'out') rows = rows.filter((r) => r.stock.out);
  else if (q.status === 'expiring') rows = rows.filter((r) => r.stock.expiringSoon);
  else if (q.status === 'expired') rows = rows.filter((r) => r.stock.expired);
  else if (q.status === 'in') rows = rows.filter((r) => !r.stock.out);
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(200, Number(q.limit) || 50);
  return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.ceil(rows.length / limit) || 1 };
}

async function getItem(req, id) {
  const [sc, settings, units] = [await scope(req), await inventorySettings(), await U.loadUnits()];
  const item = await InventoryItem.findById(id).populate('category', 'name key').lean();
  if (!item) throw notFound('Item not found');
  const map = await stockMap(sc, { item: item._id }); const e = map.get(String(item._id));
  const t = today();
  const lots = (e?.lots || []).map((l) => ({ _id: l._id, department: l.department, lotNo: l.lotNo, expiryDate: l.expiryDate, qty: U.fromQ(l.qtyQ), unitCost: l.unitCost || 0, receivedAt: l.receivedAt,
    expired: !!(l.expiryDate && new Date(l.expiryDate) < t), daysLeft: l.expiryDate ? Math.round((new Date(l.expiryDate) - t) / 864e5) : null }))
    .sort((a, b) => (a.expiryDate ? new Date(a.expiryDate) : Infinity) - (b.expiryDate ? new Date(b.expiryDate) : Infinity));
  const opening = await StockLedger.find({ item: item._id, type: 'Opening Stock', ...(sc.all ? {} : { department: { $in: sc.departments } }) }).lean();
  const display = {}; for (const u of U.convertibleUnits(item, units)) { const v = U.fromBase(item, U.fromQ(e?.total || 0), u, units); if (v != null) display[u] = v; }
  return { ...present(item, e, sc, settings, t), lots, openingStock: opening.map((o) => ({ department: o.department, quantity: o.deltaQ / U.SCALE, at: o.at, lotNo: o.lotNo, expiryDate: o.expiryDate })),
    units: U.convertibleUnits(item, units).map((c) => ({ code: c, name: units.get(c)?.name || c })), stockInUnits: display, minLevelsByDepartment: item.minLevels || [] };
}

module.exports = { createItem, updateItem, setActive, listItems, getItem, stockMap };
