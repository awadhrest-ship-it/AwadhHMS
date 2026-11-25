/**
 * Module 7.4 (A, B, D) - kitchen wastage. Stock changes ONLY through the stock engine (type Wastage, source "kitchen"); the wastage row is created first
 * (unique idempotency key) and the movement uses a key derived from it, so a re-submitted request can never deduct twice. Department rules of the stock
 * engine apply (a user can only write off stock of a department they may work with). Two kinds: an ingredient, or portions of a dish (its recipe
 * ingredients are written off - dishes are only consumed from stock when SOLD, so a thrown-away dish is not double counted).
 */
const { KitchenWastage, MenuItem, InventoryItem, Recipe, Counter } = require('../../models');
const stock = require('../inventory/stock');
const U = require('../inventory/units');
const { kitchenSettings } = require('../settings');
const { audit } = require('../audit');
const { todayStr } = require('../../utils/dates');
const C = require('./core');
const { ApiError, bad, notFound } = require('../../utils/ApiError');

const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
async function buildLines(b) {
  const units = await U.loadUnits();
  if (b.kind === 'ingredient') {
    const it = await InventoryItem.findById(b.item); if (!it || !it.active) throw bad('Choose an active inventory item');
    const unit = String(b.unit || it.usageUnit || it.baseUnit).toLowerCase(); const base = U.toBase(it, b.quantity, unit, units);
    return { unit, itemDoc: it, lines: [{ item: it._id, sku: it.sku, itemName: it.name, baseQty: base.baseQty, baseUnit: it.baseUnit }] };
  }
  const mi = await MenuItem.findById(b.menuItem); if (!mi) throw bad('Choose a menu item');
  const rec = await Recipe.findOne({ menuItem: mi._id, active: true }); if (!rec) throw bad(`${mi.name} has no active recipe, so its ingredients cannot be written off. Record the wasted ingredients instead.`);
  const yq = rec.yield?.quantity > 0 ? rec.yield.quantity : 1; const items = new Map((await InventoryItem.find({ _id: { $in: rec.ingredients.map((g) => g.item) } }).lean()).map((i) => [String(i._id), i]));
  const lines = rec.ingredients.map((g) => { const it = items.get(String(g.item)); if (!it || !it.active) throw bad(`${rec.name}: an ingredient is missing or inactive`); return { item: it._id, sku: it.sku, itemName: it.name, baseQty: r6((U.toBase(it, g.quantity, g.unit, units).baseQty * b.quantity) / yq), baseUnit: it.baseUnit }; });
  return { unit: 'portion', menuDoc: mi, recipe: rec, lines };
}
async function post(req, w) {
  const dept = w.department;
  let movement;
  try {
    ({ movement } = await stock.postMovement(req, { type: 'Wastage', source: 'kitchen', rawKey: true, idempotencyKey: `kitchen-waste:${w._id}`, reason: `${w.reason}${w.notes ? ' - ' + w.notes : ''}`,
      reference: { model: 'KitchenWastage', id: w._id, label: w.wastageNumber }, lines: w.lines.map((l) => ({ item: l.item, quantity: l.baseQty, unit: l.baseUnit, fromDepartment: dept })) }));
  } catch (e) {
    if (e instanceof ApiError && [400, 403, 409].includes(e.status)) await KitchenWastage.updateOne({ _id: w._id, status: { $ne: 'Posted' } }, { $set: { status: 'Failed', failureReason: e.message } });
    throw e;
  }
  const cost = new Map();
  for (const op of movement.ops || []) if (op.kind === 'dec') { const c = cost.get(String(op.item)) || { v: 0, ok: true }; c.v += (op.qtyQ / U.SCALE) * (op.unitCost || 0); if (!(op.unitCost > 0)) c.ok = false; cost.set(String(op.item), c); }
  const lines = w.lines.map((l) => { const c = cost.get(String(l.item)); return { ...l.toObject?.() || l, cost: c ? Math.round(c.v * 10000) / 10000 : null, costComplete: !!c && c.ok }; });
  const total = C.rup(lines.reduce((s, l) => s + (l.cost || 0), 0));
  const won = await KitchenWastage.findOneAndUpdate({ _id: w._id, status: { $ne: 'Posted' } }, { $set: { status: 'Posted', movement: movement._id, movementNumber: movement.movementNumber, lines, cost: total, costComplete: lines.every((l) => l.costComplete) }, $unset: { failureReason: 1 } }, { new: true });
  if (won) await audit(req, { action: 'create', module: 'Kitchen', entity: 'KitchenWastage', entityId: w._id, entityLabel: `${w.wastageNumber} ${w.itemName || w.menuItemName} x ${w.quantity} ${w.unit}`, newValue: { reason: w.reason, station: w.station, movement: movement.movementNumber, cost: total, costComplete: won.costComplete } });
  return won || KitchenWastage.findById(w._id);
}
async function record(req, b, idemKey) {
  const key = `${req.user._id}:${idemKey}`;
  const ex = await KitchenWastage.findOne({ idempotencyKey: key });
  if (ex) return { wastage: ex.status === 'Posted' ? ex : await post(req, ex), replayed: true };
  const settings = await kitchenSettings();
  if (!settings.wastageReasons.includes(b.reason)) throw bad(`Reason must be one of: ${settings.wastageReasons.join(', ')}`);
  if (b.reason === 'Other' && !(b.notes || '').trim()) throw bad('Add a note explaining the wastage');
  if (b.station && !C.STATIONS.includes(b.station)) throw bad('Unknown station');
  const built = await buildLines(b);
  const at = b.occurredAt ? new Date(b.occurredAt) : new Date(); if (Number.isNaN(at.getTime()) || at > new Date(Date.now() + 5 * 60000)) throw bad('The wastage time cannot be in the future');
  const doc = { wastageNumber: await Counter.next('WST', 4), idempotencyKey: key, kind: b.kind, item: built.itemDoc?._id, itemName: built.itemDoc?.name, sku: built.itemDoc?.sku, menuItem: built.menuDoc?._id, menuItemName: built.menuDoc?.name, recipe: built.recipe?._id, recipeVersion: built.recipe?.version,
    quantity: b.quantity, unit: built.unit, lines: built.lines, station: b.station, department: settings.consumption.department || 'Kitchen', reason: b.reason, notes: b.notes?.trim() || undefined, order: b.order, orderNumber: b.orderNumber,
    prepList: b.prepList, prepTask: b.prepTask, businessDate: todayStr(at), occurredAt: at, recordedBy: req.user._id, recordedByName: req.user.name };
  let w;
  try { w = await KitchenWastage.create(doc); } catch (e) { if (e.code === 11000) { const again = await KitchenWastage.findOne({ idempotencyKey: key }); if (again) return { wastage: await post(req, again), replayed: true }; } throw e; }
  return { wastage: await post(req, w), replayed: false };
}
async function updateNotes(req, id, notes) {
  const w = await KitchenWastage.findById(id); if (!w) throw notFound('Wastage record not found');
  if (w.reason === 'Other' && !(notes || '').trim()) throw bad('Notes are required for reason "Other"');
  await KitchenWastage.updateOne({ _id: id }, { $set: { notes: notes?.trim() || undefined }, $push: { noteHistory: { at: new Date(), by: req.user._id, byName: req.user.name, was: w.notes || '' } } });
  await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenWastage', entityId: id, entityLabel: `${w.wastageNumber} notes corrected`, oldValue: { notes: w.notes }, newValue: { notes } });
  return KitchenWastage.findById(id);
}
function filter(q) { const f = { status: 'Posted' }; if (q.status) f.status = { $in: String(q.status).split(',') }; if (q.from || q.to) { f.businessDate = {}; if (q.from) f.businessDate.$gte = q.from; if (q.to) f.businessDate.$lte = q.to; } if (q.station) f.station = q.station === 'none' ? null : q.station; if (q.reason) f.reason = q.reason; if (q.item) f.item = q.item; return f; }
async function list(q = {}) {
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Number(q.limit) || 40); const f = filter({ status: 'Posted,Failed,Pending', ...q });
  const [data, total] = await Promise.all([KitchenWastage.find(f).sort({ occurredAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), KitchenWastage.countDocuments(f)]);
  return { data, total, page, pages: Math.ceil(total / limit) };
}
/** Daily / ingredient / station / reason / person breakdowns of POSTED wastage (the PDF's food-wastage report). Cost only where cost data is reliable. */
async function report(q = {}) {
  const rows = await KitchenWastage.find(filter(q)).lean(); const grp = (keyFn) => { const m = new Map(); for (const w of rows) for (const [k, qty, unit, cost, ok] of keyFn(w)) { const g = m.get(k) || { key: k, count: 0, quantity: {}, cost: 0, costComplete: true }; g.count += 1; if (qty != null) g.quantity[unit] = r6((g.quantity[unit] || 0) + qty); g.cost = C.rup(g.cost + (cost || 0)); if (!ok) g.costComplete = false; m.set(k, g); } return [...m.values()].sort((a, b) => b.cost - a.cost || String(a.key).localeCompare(String(b.key))); };
  const whole = (w) => [[w.businessDate, null, null, w.cost, w.costComplete]];
  return {
    totals: { records: rows.length, cost: C.rup(rows.reduce((s, w) => s + (w.cost || 0), 0)), costComplete: rows.every((w) => w.costComplete) },
    daily: grp(whole).sort((a, b) => a.key.localeCompare(b.key)),
    byIngredient: grp((w) => w.lines.map((l) => [l.itemName, l.baseQty, l.baseUnit, l.cost, l.costComplete])),
    byStation: grp((w) => [[w.station || 'Not specified', null, null, w.cost, w.costComplete]]),
    byReason: grp((w) => [[w.reason, null, null, w.cost, w.costComplete]]),
    byPerson: grp((w) => [[w.recordedByName, null, null, w.cost, w.costComplete]]),
    note: 'Cost is the cost basis of the stock written off; "incomplete" means some stock had no recorded cost. Only posted wastage is counted.',
  };
}
module.exports = { record, updateNotes, list, report };
