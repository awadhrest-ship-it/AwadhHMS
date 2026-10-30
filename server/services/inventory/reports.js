const { InventoryItem, InventoryCategory, StockBalance, StockMovement, StockLedger, PriceHistory, ApprovalRequest } = require('../../models');
const { scope } = require('./access');
const { inventorySettings } = require('../settings');
const alerts = require('./alerts');
const stocks = require('./stock');
const U = require('./units');
const items = require('./items');
const { escapeRegex } = require('../../utils/wrap');
const { toDate, today, addDays } = require('../../utils/dates');

const money = (n) => Math.round((n || 0) * 100) / 100;

async function summary(req) {
  const [sc, settings] = [await scope(req), await inventorySettings()];
  const [list, map, cats] = [await InventoryItem.find({ active: true }).lean(), await items.stockMap(sc), await InventoryCategory.find().lean()];
  const t = today(); const warn = addDays(t, settings.expiryWarningDays);
  const lotFilter = sc.all ? {} : { department: { $in: sc.departments } };
  const lots = await StockBalance.find({ qtyQ: { $gt: 0 }, ...lotFilter }).lean();
  const itemById = new Map(list.map((i) => [String(i._id), i]));
  const byDept = {}, byCat = {}; let value = 0, expiring = 0, expired = 0;
  const catName = new Map(cats.map((c) => [String(c._id), c.name]));
  for (const l of lots) {
    const it = itemById.get(String(l.item)); if (!it) continue;
    const v = (l.qtyQ / U.SCALE) * (l.unitCost || it.lastPurchase?.pricePerBase || 0);
    value += v;
    const d = (byDept[l.department] ||= { department: l.department, items: new Set(), value: 0 }); d.items.add(String(l.item)); d.value += v;
    const c = (byCat[String(it.category)] ||= { category: catName.get(String(it.category)) || '—', items: new Set(), value: 0 }); c.items.add(String(l.item)); c.value += v;
    if (l.expiryDate) { const e = new Date(l.expiryDate); if (e < t) expired += 1; else if (e <= warn) expiring += 1; }
  }
  const al = await alerts.currentAlerts(sc.all ? null : sc.departments);
  const mvFilter = sc.all ? {} : { $or: [{ 'lines.fromDepartment': { $in: sc.departments } }, { 'lines.toDepartment': { $in: sc.departments } }] };
  const recent = await StockMovement.find({ status: { $in: ['Posted', 'Awaiting Approval'] }, ...mvFilter }).select('-ops').sort({ createdAt: -1 }).limit(8).lean();
  const pending = await StockMovement.countDocuments({ status: 'Awaiting Approval', ...mvFilter });
  const since = addDays(t, -30);
  const loss = await StockMovement.find({ type: { $in: ['Wastage', 'Breakage', 'Damaged'] }, status: 'Posted', createdAt: { $gte: since }, ...mvFilter }).select('type lines').lean();
  const lossBy = { Wastage: 0, Breakage: 0, Damaged: 0 }; loss.forEach((m) => { lossBy[m.type] += 1; });
  return { items: list.length, itemsInStock: [...map.values()].filter((e) => e.total > 0).length, categories: cats.filter((c) => c.active).length, stockValue: money(value),
    lowStock: al.low.length, expiringSoon: expiring, expired, outOfStock: list.filter((i) => !(map.get(String(i._id))?.total > 0)).length, pendingAdjustments: pending,
    byDepartment: Object.values(byDept).map((d) => ({ department: d.department, items: d.items.size, value: money(d.value) })).sort((a, b) => b.value - a.value),
    byCategory: Object.values(byCat).map((c) => ({ category: c.category, items: c.items.size, value: money(c.value) })).sort((a, b) => b.value - a.value),
    lossLast30Days: lossBy, recentMovements: recent, expiryWarningDays: settings.expiryWarningDays, scope: sc.all ? 'all' : sc.own };
}

/** Department-wise stock rows. */
async function stockRows(req, q) {
  const [sc, settings] = [await scope(req), await inventorySettings()];
  const itemF = { active: true }; if (q.category) itemF.category = q.category;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); itemF.$or = [{ name: rx }, { sku: rx }]; }
  const list = await InventoryItem.find(itemF).populate('category', 'name').sort({ name: 1 }).lean();
  const ids = list.map((i) => i._id);
  const lotF = { item: { $in: ids }, qtyQ: { $gt: 0 } };
  if (!sc.all) lotF.department = { $in: sc.departments };
  if (q.department) lotF.department = !sc.all && !sc.departments.includes(q.department) ? '__none__' : q.department;
  const lots = await StockBalance.find(lotF).lean();
  const agg = new Map();
  for (const l of lots) {
    const k = `${l.item}|${l.department}`; const e = agg.get(k) || { item: String(l.item), department: l.department, qtyQ: 0, value: 0, nextExpiry: null, lots: 0 };
    e.qtyQ += l.qtyQ; e.lots += 1; e.value += (l.qtyQ / U.SCALE) * (l.unitCost || 0);
    if (l.expiryDate && (!e.nextExpiry || new Date(l.expiryDate) < e.nextExpiry)) e.nextExpiry = new Date(l.expiryDate);
    agg.set(k, e);
  }
  const byId = new Map(list.map((i) => [String(i._id), i])); const t = today();
  let rows = [...agg.values()].map((e) => {
    const it = byId.get(e.item); const min = (it.minLevels || []).find((m) => m.department === e.department)?.minLevel;
    const qty = U.fromQ(e.qtyQ);
    return { item: { _id: it._id, sku: it.sku, name: it.name, category: it.category?.name, baseUnit: it.baseUnit }, department: e.department, qty, unit: it.baseUnit, minLevel: min ?? null,
      low: min != null && U.toQ(min) > 0 && e.qtyQ < U.toQ(min), value: money(e.value || qty * (it.lastPurchase?.pricePerBase || 0)), nextExpiry: e.nextExpiry, lots: e.lots,
      expired: !!(e.nextExpiry && e.nextExpiry < t), expiringSoon: !!(e.nextExpiry && e.nextExpiry >= t && e.nextExpiry <= addDays(t, settings.expiryWarningDays)) };
  });
  // items with a minimum level but no stock at all must still show up as low
  for (const it of list) for (const m of it.minLevels || []) {
    if (U.toQ(m.minLevel) <= 0 || agg.has(`${it._id}|${m.department}`)) continue;
    if (!sc.all && !sc.departments.includes(m.department)) continue; if (q.department && q.department !== m.department) continue;
    rows.push({ item: { _id: it._id, sku: it.sku, name: it.name, category: it.category?.name, baseUnit: it.baseUnit }, department: m.department, qty: 0, unit: it.baseUnit, minLevel: m.minLevel, low: true, value: 0, nextExpiry: null, lots: 0, expired: false, expiringSoon: false });
  }
  if (q.lowOnly === 'true') rows = rows.filter((r) => r.low);
  rows.sort((a, b) => a.department.localeCompare(b.department) || a.item.name.localeCompare(b.item.name));
  return rows;
}

function movementFilter(sc, q) {
  const f = {}; const and = [];
  if (q.type) f.type = { $in: String(q.type).split(',') };
  if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.item) f['lines.item'] = q.item;
  if (q.user) f.performedBy = q.user;
  if (q.from || q.to) { f.createdAt = {}; if (q.from) f.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`); }
  if (q.department) and.push({ $or: [{ 'lines.fromDepartment': q.department }, { 'lines.toDepartment': q.department }] });
  if (!sc.all) and.push({ $or: [{ 'lines.fromDepartment': { $in: sc.departments } }, { 'lines.toDepartment': { $in: sc.departments } }] });
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); and.push({ $or: [{ movementNumber: rx }, { reason: rx }, { 'lines.itemName': rx }, { 'lines.sku': rx }, { performedByName: rx }, { 'reference.label': rx }] }); }
  if (and.length) f.$and = and;
  return f;
}
async function movements(req, q) {
  const sc = await scope(req); const f = movementFilter(sc, q);
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(200, Number(q.limit) || 50);
  const [data, total] = await Promise.all([StockMovement.find(f).select('-ops').populate('approval', 'requestNumber status rejectionReason').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), StockMovement.countDocuments(f)]);
  return { data, total, page, pages: Math.ceil(total / limit) || 1 };
}
async function movementReport(req, q) {
  const sc = await scope(req); const f = { ...movementFilter(sc, q), status: 'Posted' };
  const rows = await StockMovement.find(f).select('-ops').sort({ createdAt: -1 }).limit(5000).lean();
  const byType = {}, byReason = {}, byItem = {};
  for (const m of rows) {
    byType[m.type] = (byType[m.type] || 0) + 1;
    if (['Wastage', 'Breakage', 'Damaged'].includes(m.type)) {
      const r = (m.reason || 'Unspecified').slice(0, 60); byReason[`${m.type}: ${r}`] = (byReason[`${m.type}: ${r}`] || 0) + 1;
      for (const l of m.lines) { const k = `${l.sku}|${m.type}`; const e = byItem[k] || { sku: l.sku, item: l.itemName, type: m.type, baseQty: 0, baseUnit: l.baseUnit, events: 0 }; e.baseQty = U.round6(e.baseQty + l.baseQty); e.events += 1; byItem[k] = e; }
    }
  }
  return { count: rows.length, byType, byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count), lossByItem: Object.values(byItem).sort((a, b) => b.events - a.events), rows };
}

async function itemLedger(req, itemId, q) {
  const sc = await scope(req);
  const f = { item: itemId }; if (!sc.all) f.department = { $in: sc.departments }; if (q.department) f.department = !sc.all && !sc.departments.includes(q.department) ? '__none__' : q.department;
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(200, Number(q.limit) || 50);
  const [rows, total] = await Promise.all([StockLedger.find(f).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), StockLedger.countDocuments(f)]);
  let running = null;
  if (q.department && rows.length) {                      // running department balance = current balance - everything newer than each row
    const cur = U.toQ(await stocks.onHand(itemId, q.department));
    const first = rows[0]; const newer = await StockLedger.find({ item: itemId, department: q.department, $or: [{ at: { $gt: first.at } }, { at: first.at, _id: { $gt: first._id } }] }).select('deltaQ').lean();
    let bal = cur - newer.reduce((s, r) => s + r.deltaQ, 0); running = new Map();
    for (const r of rows) { running.set(String(r._id), bal); bal -= r.deltaQ; }
  }
  return { data: rows.map((r) => ({ ...r.toJSON(), ...(running ? { balanceAfter: running.get(String(r._id)) / U.SCALE } : {}) })), total, page, pages: Math.ceil(total / limit) || 1 };
}
async function prices(itemId) {
  const rows = await PriceHistory.find({ item: itemId }).sort({ date: -1 }).limit(200).populate('recordedBy', 'name').lean();
  const vals = rows.map((r) => r.pricePerBase);
  return { data: rows, stats: rows.length ? { latest: rows[0].pricePerBase, lowest: Math.min(...vals), highest: Math.max(...vals), average: money(vals.reduce((a, b) => a + b, 0) / vals.length) } : null };
}

const csvCell = (v) => { const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (cols, rows) => [cols.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => cols.map((c) => csvCell(c.get(r))).join(','))].join('\n');

module.exports = { summary, stockRows, movements, movementReport, itemLedger, prices, toCsv };
