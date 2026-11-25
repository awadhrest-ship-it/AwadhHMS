/**
 * Bar core: item classification, serving -> stock-consumption planning, the opened-liquor pool and the ONE function that deducts bar stock.
 *
 * Stock model (nothing is duplicated, nothing is guessed):
 *   - Total liquor on hand (sealed + opened) is a normal Phase 4 balance in the bar department, in the item's base unit (ml). Only the Phase 4
 *     movement engine ever changes it.
 *   - The opened-liquor pool (BarOpenStock.openQ) is the part of that total that sits in opened bottles. Opening a bottle moves liquor from "sealed"
 *     to "opened" inside the bar layer: it changes no Phase 4 quantity (so it can never be mistaken for consumption or wastage).
 *   - sealed = total - opened. Pegs are poured from the opened pool, full-bottle sales / sealed wastage come from sealed stock.
 *   - Bottle capacity is read from the item's own explicit "bottle" conversion in Phase 4 (1 bottle = N ml). It is never assumed.
 */
const { InventoryItem, InventoryCategory, StockBalance, BarOpenStock, BarOpenLedger } = require('../../models');
const stock = require('../inventory/stock');
const U = require('../inventory/units');
const { barSettings } = require('../settings');
const { bad, conflict, ApiError } = require('../../utils/ApiError');

const isDup = (e) => e && (e.code === 11000 || /E11000|duplicate key/i.test(e.message || ''));
const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const fmtMl = (q) => `${r6(q / U.SCALE)}`;

/** Load items with their category name attached (lean). */
async function loadItems(ids) {
  const list = await InventoryItem.find({ _id: { $in: [...new Set(ids.map(String))] } }).populate('category', 'name').lean();
  return new Map(list.map((i) => [String(i._id), { ...i, categoryName: i.category?.name, category: i.category?._id }]));
}
const inLiquorCategory = (item, settings) => (settings.liquorCategories || []).includes(item.categoryName);
/** Measured liquor = a liquor-category item stored in ml WITH a bottle capacity: only these get the sealed / opened / peg treatment.
 *  A liquor-category item stored in bottles (e.g. a Phase 4 item created before Phase 8) is simply counted in its own unit and flagged "needs setup". */
const isLiquor = (item, settings) => inLiquorCategory(item, settings) && item.baseUnit === 'ml' && !!(item.conversions || []).find((x) => x.unit === 'bottle' && x.factor > 0);
/** Bottle capacity in base units (ml) from the item's explicit conversion, or null when it is not configured. */
function capacityOf(item, units) {
  if (!item || item.baseUnit !== 'ml') return null;
  const c = (item.conversions || []).find((x) => x.unit === 'bottle');
  if (!c || !(c.factor > 0)) return null;
  return c.factor;
}

/* ------------------------------------------------------------------ consumption planning */
/**
 * Plan what ONE serving consumes. Returns { status, problems, lines } where status is 'Configured' | 'Incomplete' | 'Not stock-tracked'.
 * Nothing is deducted for an incomplete configuration - the caller decides (default: refuse the sale).
 */
function planServing(menu, serving, qty, ctx) {
  const { items, units, settings } = ctx; const problems = []; const lines = [];
  if (!menu.trackStock) return { status: 'Not stock-tracked', problems, lines };
  const meas = serving.measure;
  const stockItem = menu.stockItem && items.get(String(menu.stockItem));
  if (!menu.stockItem) problems.push('No inventory item is linked');
  else if (!stockItem) problems.push('The linked inventory item no longer exists');
  else if (!stockItem.active) problems.push(`${stockItem.name} is inactive`);
  else if (menu.kind === 'spirit') {
    const cap = capacityOf(stockItem, units);
    if (!inLiquorCategory(stockItem, settings)) problems.push(`${stockItem.name} is not in a liquor category (${settings.liquorCategories.join(', ')})`);
    else if (!cap) problems.push(`${stockItem.name} needs a base unit of ml and a "bottle" conversion (bottle capacity)`);
    else if (meas === 'Full bottle') lines.push({ item: stockItem._id, itemName: stockItem.name, baseQty: r6(cap * qty), unit: 'ml', from: 'sealed', role: 'liquor' });
    else if (!(serving.ml > 0)) problems.push(`The ${meas} serving has no measure in ml`);
    else lines.push({ item: stockItem._id, itemName: stockItem.name, baseQty: r6(serving.ml * qty), unit: 'ml', from: 'open', role: 'liquor' });
  } else {
    try { const { baseQty } = U.toBase(stockItem, (serving.units || 1) * qty, stockItem.usageUnit || stockItem.baseUnit, units); lines.push({ item: stockItem._id, itemName: stockItem.name, baseQty, unit: stockItem.baseUnit, from: 'unit', role: 'packaged' }); }
    catch (e) { problems.push(e.message); }
  }
  for (const m of menu.mixers || []) {
    if (!(m.measures || []).includes(meas)) continue;
    const it = items.get(String(m.item));
    if (!it || !it.active) { problems.push('A mixer item is missing or inactive'); continue; }
    try { const { baseQty } = U.toBase(it, m.quantity * qty, m.unit, units); lines.push({ item: it._id, itemName: it.name, baseQty, unit: it.baseUnit, from: isLiquor(it, settings) ? 'open' : 'unit', role: 'mixer' }); }
    catch (e) { problems.push(`${it.name}: ${e.message}`); }
  }
  return { status: problems.length ? 'Incomplete' : 'Configured', problems, lines };
}
/** Merge consumption lines of the same item + source (one movement line per item). */
function mergeLines(lines) {
  const m = new Map();
  for (const l of lines) { const k = `${l.item}|${l.from}`; const c = m.get(k); if (c) c.baseQty = r6(c.baseQty + l.baseQty); else m.set(k, { ...l }); }
  return [...m.values()];
}
async function menuContext() {
  return { units: await U.loadUnits(), settings: await barSettings() };
}
/** Overall configuration status of a menu item (checks every active serving). */
async function menuStatus(menu, ctx) {
  const ids = [menu.stockItem, ...(menu.mixers || []).map((m) => m.item)].filter(Boolean);
  const items = await loadItems(ids); const c = { ...ctx, items };
  if (!menu.trackStock) return { status: 'Not stock-tracked', problems: [] };
  const problems = new Set();
  for (const s of menu.servings.filter((x) => x.active !== false)) for (const p of planServing(menu, s, 1, c).problems) problems.add(p);
  return { status: problems.size ? 'Incomplete' : 'Configured', problems: [...problems] };
}

/* ------------------------------------------------------------------ opened-liquor pool */
async function openQOf(item) { return (await BarOpenStock.findOne({ item }).select('openQ').lean())?.openQ || 0; }
async function totalQOf(item, department) {
  const rows = await StockBalance.find({ item, department }).select('qtyQ').lean(); return rows.reduce((s, r) => s + r.qtyQ, 0);
}
/** { totalQ, openQ (clamped to the total), sealedQ, drift } for each item in the bar department. */
async function stateOf(itemIds, department) {
  const out = new Map();
  for (const id of itemIds) {
    const totalQ = await totalQOf(id, department); const raw = await openQOf(id); const openQ = Math.min(raw, totalQ);
    out.set(String(id), { totalQ, openQ, sealedQ: totalQ - openQ, drift: raw > totalQ ? raw - totalQ : 0 });
  }
  return out;
}

const mk = (key, reverse) => (reverse ? `${key}:rv` : key).replace(/\./g, '_');
/** One atomic, idempotent change of the opened pool. Decrements can never go below zero. Returns { applied, already }. */
async function applyOpen(item, deltaQ, key, { reverse = false } = {}) {
  const d = reverse ? -deltaQ : deltaQ; const marker = `ops.${mk(key, reverse)}`;
  if (d < 0) {
    const r = await BarOpenStock.findOneAndUpdate({ item, openQ: { $gte: -d }, [marker]: { $exists: false } }, { $inc: { openQ: d }, $set: { [marker]: Date.now() } }, { new: true }).lean();
    if (r) return { applied: true, openQ: r.openQ };
    const cur = await BarOpenStock.findOne({ item }).lean();
    if (cur?.ops?.[mk(key, reverse)]) return { applied: false, already: true, openQ: cur.openQ };
    throw conflict('Not enough opened liquor', { item: String(item), available: (cur?.openQ || 0) / U.SCALE, requested: -d / U.SCALE });
  }
  for (let i = 0; i < 3; i += 1) {
    try {
      const r = await BarOpenStock.findOneAndUpdate({ item, [marker]: { $exists: false } }, { $inc: { openQ: d }, $set: { [marker]: Date.now() } }, { new: true, upsert: true }).lean();
      return { applied: true, openQ: r.openQ };
    } catch (e) {
      if (!isDup(e)) throw e;
      const cur = await BarOpenStock.findOne({ item }).lean(); if (cur?.ops?.[mk(key, reverse)]) return { applied: false, already: true, openQ: cur.openQ };
    }
  }
  throw conflict('Could not update the opened-liquor pool - please retry');
}
async function writeOpenLedger(rows) {
  for (const r of rows) { try { await BarOpenLedger.updateOne({ key: r.key }, { $setOnInsert: { ...r, at: r.at || new Date() } }, { upsert: true }); } catch (e) { if (!isDup(e)) throw e; } }
}

/* ------------------------------------------------------------------ the single stock-deduction path */
/**
 * consume(req, { key, type, source, reason, reference, lines, kind, ref })
 *   lines: [{ item, baseQty, unit, from: 'open'|'sealed'|'unit', itemName }]   (base units)
 *   key:   stable per business event AND per attempt (e.g. `bar-order:<id>:a0`). The same key can be sent any number of times: stock changes once.
 * Order of work: pre-check sealed stock -> opened pool decrements (atomic, idempotent) -> ONE Phase 4 movement (all-or-nothing, idempotent) -> ledger rows.
 * If the Phase 4 movement is refused (e.g. insufficient stock) the pool decrements already applied are reversed and nothing has changed.
 */
async function consume(req, { key, type = 'Consumption', source, reason, reference, lines, kind, ref = {} }) {
  const settings = await barSettings(); const department = settings.department;
  const merged = mergeLines(lines);
  const ids = merged.map((l) => l.item); const state = await stateOf(ids, department);
  for (const l of merged) {
    const q = U.toQ(l.baseQty); const s = state.get(String(l.item));
    if (l.from === 'sealed' && q > s.sealedQ) throw conflict(`Not enough sealed stock of ${l.itemName}: ${fmtMl(s.sealedQ)} ${l.unit} sealed, ${r6(l.baseQty)} ${l.unit} needed`, { item: String(l.item), sealed: s.sealedQ / U.SCALE, requested: l.baseQty });
    if (l.from === 'open' && q > s.openQ) throw conflict(`Not enough opened liquor of ${l.itemName}: ${fmtMl(s.openQ)} ${l.unit} left in opened bottles, ${r6(l.baseQty)} ${l.unit} needed. Open a bottle first.`, { item: String(l.item), opened: s.openQ / U.SCALE, requested: l.baseQty, code: 'OPEN_BOTTLE_NEEDED' });
    if (l.from === 'unit' && q > s.totalQ) throw conflict(`Not enough stock of ${l.itemName}: ${fmtMl(s.totalQ)} ${l.unit} on hand, ${r6(l.baseQty)} ${l.unit} needed`, { item: String(l.item) });
  }
  const applied = [];
  const undo = async () => { for (const a of applied.reverse()) { try { await applyOpen(a.item, a.deltaQ, a.key, { reverse: true }); } catch (e) { console.error('bar pool undo failed', e.message); } } };
  try {
    for (const l of merged.filter((x) => x.from === 'open')) {
      const deltaQ = -U.toQ(l.baseQty); const k = `${key}:o:${l.item}`;
      await applyOpen(l.item, deltaQ, k); applied.push({ item: l.item, deltaQ, key: k });
    }
  } catch (e) { await undo(); if (e instanceof ApiError && e.status === 409) throw conflict('Opened liquor changed while saving - please check the stock and try again'); throw e; }
  let movement;
  try {
    ({ movement } = await stock.postMovement(req, { type, source, rawKey: true, trusted: true, idempotencyKey: `${key}:mv`, reason: reason || 'Bar consumption', reference,
      lines: merged.map((l) => ({ item: l.item, quantity: l.baseQty, unit: l.unit, fromDepartment: department })) }));
  } catch (e) { if (e instanceof ApiError && [400, 409].includes(e.status)) await undo(); throw e; }
  await writeOpenLedger(applied.map((a) => ({ key: a.key, item: a.item, deltaQ: a.deltaQ, kind, refModel: ref.model, refId: ref.id, refLabel: ref.label, by: req.user?._id })));
  return movement;
}

/* ------------------------------------------------------------------ which items does the bar track? */
async function trackedItemIds(settings) {
  const { BarMenuItem } = require('../../models');
  const cats = await InventoryCategory.find({ name: { $in: settings.trackedCategories } }).select('_id').lean();
  const withStock = await StockBalance.distinct('item', { department: settings.department });
  const fromCats = await InventoryItem.find({ _id: { $in: withStock }, category: { $in: cats.map((c) => c._id) } }).select('_id').lean();
  const menu = await BarMenuItem.find({ active: true }).select('stockItem mixers.item').lean();
  const set = new Set(fromCats.map((i) => String(i._id)));
  for (const m of menu) { if (m.stockItem) set.add(String(m.stockItem)); for (const x of m.mixers || []) set.add(String(x.item)); }
  return [...set];
}

/** The user's own open shift (or null). Orders, complimentary issues and wastage are tagged with it. */
async function myOpenShift(req, settings) {
  const { BarShift } = require('../../models');
  const sh = await BarShift.findOne({ bartender: req.user._id, status: 'Open' }).select('_id shiftNumber').lean();
  if (!sh && settings?.requireOpenShift) throw bad('Start your bar shift first (Bar > Shifts) - this hotel requires an open shift to record bar activity');
  return sh;
}
const needKey = (req, what) => { const k = req.get?.('Idempotency-Key') || req.body?.idempotencyKey; if (!k || String(k).length < 8) throw bad(`An Idempotency-Key (header or "idempotencyKey") of at least 8 characters is required to ${what}, so a retry can never be applied twice`); return String(k).slice(0, 80); };

module.exports = { myOpenShift, needKey, isDup, r6, loadItems, isLiquor, inLiquorCategory, capacityOf, planServing, mergeLines, menuContext, menuStatus, openQOf, totalQOf, stateOf, applyOpen, writeOpenLedger, consume, trackedItemIds };
