/**
 * Module 7.3 (C-F) - automatic ingredient consumption.
 *
 * TRIGGER: a restaurant bill is FINALISED (Phase 6 `finaliseBill`) - the point where food is actually sold (and, for room service, charged to the room).
 * Nothing earlier consumes stock: not a draft order, not adding items, not sending to the kitchen, not Preparing, not Ready.
 *
 * HOW (the only stock path is services/inventory/stock.js - this file never writes a balance or a ledger row):
 *   1. A KitchenConsumption row is created for the bill (UNIQUE on bill) holding a frozen snapshot of the recipes used -> a bill can have only one.
 *   2. ONE stock movement (type Consumption, source "kitchen", department Kitchen) is posted with a stable idempotency key derived from that row. The engine
 *      applies each line exactly once, never lets stock go negative, allocates lots FEFO and records every lot's cost basis.
 *   3. The row is marked Posted with the movement reference and the cost actually consumed.
 *   Crash anywhere -> the sweeper / a retry finds the row, re-posts with the SAME key (the engine recognises what was applied) and only then marks it Posted.
 *
 * Billing is never blocked by a stock shortage: the row becomes Failed (nothing deducted - the movement is all-or-nothing), the Kitchen / Store managers are
 * notified, and an authorised user retries after restocking, or explicitly waives it with a reason. Nothing is ever skipped silently.
 *
 * Void -> re-bill never double-consumes: portions already consumed for an order line are subtracted before a new bill consumes anything.
 * A voided bill does NOT automatically return stock (the food may already have been cooked) - correct it with a stock adjustment (needs approval).
 * Preparation lists never consume stock; the lifecycle is documented in the README.
 */
const { KitchenConsumption, RestaurantBill, RestaurantOrder, Recipe, InventoryItem } = require('../../models');
const stock = require('../inventory/stock');
const U = require('../inventory/units');
const { kitchenSettings } = require('../settings');
const { audit } = require('../audit');
const { notify } = require('../notify');
const { ApiError, bad, notFound, conflict } = require('../../utils/ApiError');
const { rup } = require('./core');

const DONE = ['Posted', 'No Recipe', 'Waived'];
const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const hist = (req, action, note) => ({ at: new Date(), by: req?.user?._id, byName: req?.user?.name || 'System', action, note });

/** Work out what this bill's food needs from stock. Pure read; returns { lines, requirements, problems }. */
async function plan(bill, order) {
  const lines = []; const problems = [];
  const prior = await KitchenConsumption.find({ order: bill.order, bill: { $ne: bill._id } }).select('lines').lean();
  const claimed = new Map(); for (const p of prior) for (const l of p.lines || []) if (l.state === 'Consumed') claimed.set(String(l.orderItem), (claimed.get(String(l.orderItem)) || 0) + (l.portions || 0));
  const units = await U.loadUnits();
  const menuIds = (bill.lines || []).map((l) => order.items.id(l.orderItem)?.menuItem).filter(Boolean);
  const recipes = new Map((await Recipe.find({ menuItem: { $in: menuIds } }).lean()).map((r) => [String(r.menuItem), r]));
  const itemIds = [...new Set([...recipes.values()].flatMap((r) => r.ingredients.map((g) => String(g.item))))];
  const items = new Map((await InventoryItem.find({ _id: { $in: itemIds } }).lean()).map((i) => [String(i._id), i]));
  for (const bl of bill.lines || []) {
    const oi = order.items.id(bl.orderItem); const base = { orderItem: bl.orderItem, menuItem: oi?.menuItem, name: bl.name, quantity: bl.quantity, sellingValue: rup(bl.unitPrice * bl.quantity) };
    const left = Math.max(0, (oi?.quantity || 0) - (claimed.get(String(bl.orderItem)) || 0)); const portions = Math.min(bl.quantity, left);
    if (portions <= 0) { lines.push({ ...base, state: 'Already consumed', portions: 0, ingredients: [] }); continue; }
    const rec = oi?.menuItem && recipes.get(String(oi.menuItem));
    if (!rec) { lines.push({ ...base, state: 'No recipe', portions, ingredients: [] }); continue; }
    if (!rec.active) { lines.push({ ...base, state: 'Recipe inactive', recipe: rec._id, recipeVersion: rec.version, recipeName: rec.name, portions, ingredients: [] }); continue; }
    const yq = rec.yield?.quantity > 0 ? rec.yield.quantity : 1; const ing = [];
    for (const g of rec.ingredients) {
      const it = items.get(String(g.item));
      if (!it) { problems.push(`${rec.name}: an ingredient no longer exists in inventory`); continue; }
      if (!it.active) { problems.push(`${rec.name}: ${it.name} is inactive`); continue; }
      try { const b = U.toBase(it, g.quantity, g.unit, units).baseQty; ing.push({ item: it._id, sku: it.sku, itemName: it.name, perBatchQty: g.quantity, perBatchUnit: g.unit, baseQty: r6((b * portions) / yq), baseUnit: it.baseUnit }); }
      catch (e) { problems.push(`${rec.name} / ${it.name}: ${e.message}`); }
    }
    lines.push({ ...base, state: 'Consumed', recipe: rec._id, recipeVersion: rec.version, recipeName: rec.name, yieldQuantity: yq, portions, ingredients: ing });
  }
  const agg = new Map();
  for (const l of lines) for (const g of l.ingredients || []) { const k = String(g.item); const a = agg.get(k) || { item: g.item, sku: g.sku, itemName: g.itemName, baseQty: 0, baseUnit: g.baseUnit }; a.baseQty = r6(a.baseQty + g.baseQty); agg.set(k, a); }
  return { lines, requirements: [...agg.values()].filter((r) => r.baseQty > 0), problems, sellingValue: rup(lines.filter((l) => l.state === 'Consumed').reduce((s, l) => s + l.sellingValue, 0)) };
}

async function fail(req, rec, stage, message, details) {
  const was = rec.status;
  const upd = await KitchenConsumption.findOneAndUpdate({ _id: rec._id, status: { $in: ['Pending', 'Failed'] } }, { $set: { status: 'Failed', failureReason: message, failureDetails: { stage, ...(details && typeof details === 'object' ? { details } : {}) } }, $inc: { attempts: 1 }, $push: { history: hist(req, 'Failed', message) } }, { new: true });
  if (upd && was === 'Pending') await notify({ type: 'kitchen_consumption', title: `Ingredient consumption failed for ${rec.billNumber}`, message: `${rec.orderNumber}: ${message}`, link: '/kitchen/consumption', severity: 'warning', permission: 'kitchen.consumption.resolve' });
  if (upd) await audit(req, { action: 'status', module: 'Kitchen', entity: 'KitchenConsumption', entityId: rec._id, entityLabel: `Consumption ${rec.billNumber} failed`, newValue: { status: 'Failed', stage }, note: message });
  return upd || (await KitchenConsumption.findById(rec._id));
}

/** Post the movement for a Pending / Failed row (idempotent) and mark the row Posted. */
async function post(req, rec) {
  if (DONE.includes(rec.status)) return { consumption: rec, replayed: true };
  if (!rec.requirements.length) { const upd = await KitchenConsumption.findOneAndUpdate({ _id: rec._id, status: { $in: ['Pending', 'Failed'] } }, { $set: { status: 'No Recipe', postedAt: new Date() }, $push: { history: hist(req, 'No ingredients to consume') } }, { new: true }); return { consumption: upd || rec }; }
  let movement;
  try {
    ({ movement } = await stock.postMovement(req, {
      type: 'Consumption', source: 'kitchen', rawKey: true, trusted: true, idempotencyKey: rec.idempotencyKey,
      reason: `Sale: ${rec.billNumber} (${rec.orderNumber})`, reference: { model: 'RestaurantBill', id: rec.bill, label: `${rec.billNumber} / ${rec.orderNumber}` },
      lines: rec.requirements.map((r) => ({ item: r.item, quantity: r.baseQty, unit: r.baseUnit, fromDepartment: rec.department })),
    }));
  } catch (e) {
    if (e instanceof ApiError && [400, 409].includes(e.status)) return { consumption: await fail(req, rec, 'stock', e.message, e.details), failed: true };
    throw e;                                   // unexpected (database) error: leave the row Pending - the sweeper will roll it forward
  }
  // cost actually consumed = the cost basis of every lot the engine took stock from
  const cost = new Map();
  for (const op of movement.ops || []) if (op.kind === 'dec') { const k = String(op.item); const c = cost.get(k) || { cost: 0, complete: true, n: 0 }; c.cost += (op.qtyQ / U.SCALE) * (op.unitCost || 0); c.n += 1; if (!(op.unitCost > 0)) c.complete = false; cost.set(k, c); }
  const requirements = rec.requirements.map((r) => { const c = cost.get(String(r.item)); return { item: r.item, sku: r.sku, itemName: r.itemName, baseQty: r.baseQty, baseUnit: r.baseUnit, cost: c ? Math.round(c.cost * 10000) / 10000 : null, costComplete: !!c && c.complete }; });
  const foodCost = rup(requirements.reduce((s, r) => s + (r.cost || 0), 0));
  const upd = await KitchenConsumption.findOneAndUpdate({ _id: rec._id, status: { $in: ['Pending', 'Failed'] } },
    { $set: { status: 'Posted', movement: movement._id, movementNumber: movement.movementNumber, requirements, foodCost, costComplete: requirements.every((r) => r.costComplete), postedAt: new Date() }, $unset: { failureReason: 1, failureDetails: 1 }, $push: { history: hist(req, 'Posted', movement.movementNumber) } }, { new: true });
  if (upd) await audit(req, { action: 'create', module: 'Kitchen', entity: 'KitchenConsumption', entityId: rec._id, entityLabel: `Consumption ${rec.billNumber} -> ${movement.movementNumber}`, newValue: { movement: movement.movementNumber, ingredients: requirements.map((r) => `${r.baseQty} ${r.baseUnit} ${r.itemName}`), foodCost, costComplete: requirements.every((r) => r.costComplete) } });
  return { consumption: upd || (await KitchenConsumption.findById(rec._id)) };
}

/** The sale event. Safe to call any number of times for the same bill. Never throws for stock problems. */
async function consumeBill(req, billId) {
  const cfg = (await kitchenSettings()).consumption;
  const bill = await RestaurantBill.findById(billId); if (!bill) throw notFound('Bill not found');
  const existing = await KitchenConsumption.findOne({ bill: bill._id });
  if (existing) return post(req, existing);
  if (bill.status !== 'Final') return { skipped: 'The bill is not finalised' };
  if (!cfg.autoConsume) return { skipped: 'Automatic consumption is switched off' };
  if (!cfg.enabledFrom || new Date(bill.finalisedAt) < new Date(cfg.enabledFrom)) return { skipped: 'This bill was finalised before ingredient consumption was started' };
  const order = await RestaurantOrder.findById(bill.order); if (!order) throw notFound('Order not found');
  const p = await plan(bill, order); const noRecipe = !p.requirements.length && !p.problems.length;
  const doc = { bill: bill._id, billNumber: bill.billNumber, order: order._id, orderNumber: order.orderNumber, orderType: order.type, businessDate: order.businessDate, department: cfg.department || 'Kitchen',
    status: noRecipe ? 'No Recipe' : 'Pending', lines: p.lines, requirements: p.requirements, sellingValue: p.sellingValue, triggeredBy: req?.user?._id, triggeredByName: req?.user?.name || 'System', postedAt: noRecipe ? new Date() : undefined, history: [hist(req, 'Created', `${p.lines.length} line(s)`)] };
  let rec;
  try { rec = await KitchenConsumption.create(doc); }
  catch (e) { if (e.code === 11000 || /E11000/.test(e.message || '')) { const again = await KitchenConsumption.findOne({ bill: bill._id }); if (again) return post(req, again); } throw e; }
  rec.idempotencyKey = `kitchen-consume:${rec._id}`; await KitchenConsumption.updateOne({ _id: rec._id }, { $set: { idempotencyKey: rec.idempotencyKey } });
  if (p.problems.length) return { consumption: await fail(req, rec, 'build', p.problems.join('; ')), failed: true };
  return post(req, rec);
}
/** Called by billing after finalising. Consumption problems must never undo or block the sale. */
async function onBillFinalised(req, billId) { try { return await consumeBill(req, billId); } catch (e) { console.error(`ingredient consumption for bill ${billId} deferred: ${e.message}`); return { deferred: true }; } }

async function retry(req, id) {
  const rec = await KitchenConsumption.findById(id); if (!rec) throw notFound('Consumption record not found');
  if (DONE.includes(rec.status)) return { consumption: rec, replayed: true };
  if (rec.failureDetails?.stage === 'build' || !rec.idempotencyKey) {                  // nothing was posted: re-plan with today's recipes / inventory
    const bill = await RestaurantBill.findById(rec.bill); const order = await RestaurantOrder.findById(rec.order); const p = await plan(bill, order);
    await KitchenConsumption.updateOne({ _id: rec._id }, { $set: { lines: p.lines, requirements: p.requirements, sellingValue: p.sellingValue, idempotencyKey: rec.idempotencyKey || `kitchen-consume:${rec._id}` } });
    if (p.problems.length) return { consumption: await fail(req, await KitchenConsumption.findById(id), 'build', p.problems.join('; ')), failed: true };
  }
  await KitchenConsumption.updateOne({ _id: rec._id }, { $push: { history: hist(req, 'Retried') } });
  await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenConsumption', entityId: rec._id, entityLabel: `Consumption ${rec.billNumber} retried`, note: rec.failureReason });
  return post(req, await KitchenConsumption.findById(id));
}
async function waive(req, id, reason) {
  if (!reason || reason.trim().length < 3) throw bad('Enter a reason for waiving this consumption');
  const rec = await KitchenConsumption.findById(id); if (!rec) throw notFound('Consumption record not found');
  if (rec.status === 'Posted') throw conflict('This consumption was already posted to stock');
  if (rec.status === 'Waived') return { consumption: rec, replayed: true };
  const upd = await KitchenConsumption.findOneAndUpdate({ _id: id, status: { $in: ['Pending', 'Failed', 'No Recipe'] } }, { $set: { status: 'Waived', failureReason: `Waived: ${reason.trim()}` }, $push: { history: hist(req, 'Waived', reason.trim()) } }, { new: true });
  if (!upd) throw conflict('The record just changed - reload');
  await audit(req, { action: 'status', module: 'Kitchen', entity: 'KitchenConsumption', entityId: id, entityLabel: `Consumption ${rec.billNumber} waived`, oldValue: { status: rec.status }, newValue: { status: 'Waived' }, note: reason });
  return { consumption: upd };
}

/** Recovery: roll forward rows left Pending by a crash, and pick up finalised bills whose consumption never started (crash right after finalising). */
async function sweep({ olderThanMs = 60000, now = new Date() } = {}) {
  const cfg = (await kitchenSettings()).consumption; const out = { resumed: 0, created: 0 }; const sys = { user: null };
  for (const r of await KitchenConsumption.find({ status: 'Pending', updatedAt: { $lt: new Date(now - olderThanMs) } }).limit(100)) { try { await post(sys, r); out.resumed += 1; } catch (e) { console.error(`consumption resume ${r.billNumber}: ${e.message}`); } }
  if (cfg.autoConsume && cfg.enabledFrom) {
    const since = new Date(Math.max(new Date(cfg.enabledFrom), now - 30 * 864e5));
    const bills = await RestaurantBill.find({ status: 'Final', finalisedAt: { $gte: since, $lt: new Date(now - olderThanMs) } }).select('_id').limit(300).lean();
    const have = new Set((await KitchenConsumption.find({ bill: { $in: bills.map((b) => b._id) } }).select('bill').lean()).map((r) => String(r.bill)));
    for (const b of bills) if (!have.has(String(b._id))) { try { await consumeBill(sys, b._id); out.created += 1; } catch (e) { console.error(`consumption backfill ${b._id}: ${e.message}`); } }
  }
  return out;
}

/* ---------------------------------------------------------------- reads */
async function list(q = {}) {
  const f = {}; if (q.status) f.status = { $in: String(q.status).split(',') }; if (q.date) f.businessDate = q.date;
  if (q.from || q.to) { f.businessDate = {}; if (q.from) f.businessDate.$gte = q.from; if (q.to) f.businessDate.$lte = q.to; }
  if (q.q) { const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ billNumber: rx }, { orderNumber: rx }, { movementNumber: rx }]; }
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Number(q.limit) || 40);
  const [rows, total, counts] = await Promise.all([KitchenConsumption.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-lines.ingredients').lean(), KitchenConsumption.countDocuments(f),
    KitchenConsumption.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])]);
  const bills = new Map((await RestaurantBill.find({ _id: { $in: rows.map((r) => r.bill) } }).select('status').lean()).map((b) => [String(b._id), b.status]));
  return { data: rows.map((r) => ({ ...r, billStatus: bills.get(String(r.bill)) })), total, page, pages: Math.ceil(total / limit), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) };
}
async function get(id) { const r = await KitchenConsumption.findById(id).lean(); if (!r) throw notFound('Consumption record not found'); const b = await RestaurantBill.findById(r.bill).select('status').lean(); return { ...r, billStatus: b?.status }; }

/** Actual food cost by menu item for a date range, from the frozen sale snapshots (never from today's recipe). */
async function foodCostReport({ from, to } = {}) {
  const f = { status: 'Posted' }; if (from || to) { f.businessDate = {}; if (from) f.businessDate.$gte = from; if (to) f.businessDate.$lte = to; }
  const recs = await KitchenConsumption.find(f).lean(); const rows = new Map();
  for (const r of recs) {
    const unit = new Map((r.requirements || []).map((q) => [String(q.item), q.baseQty > 0 && q.cost != null ? { perBase: q.cost / q.baseQty, complete: q.costComplete } : { perBase: null, complete: false }]));
    for (const l of r.lines || []) {
      if (l.state !== 'Consumed') continue; const k = String(l.menuItem || l.name); const row = rows.get(k) || { menuItem: l.menuItem, name: l.name, portions: 0, menuValue: 0, foodCost: 0, complete: true };
      row.portions += l.portions; row.menuValue += l.sellingValue * (l.portions / (l.quantity || 1));
      for (const g of l.ingredients || []) { const u = unit.get(String(g.item)); if (!u || u.perBase == null) { row.complete = false; continue; } row.foodCost += g.baseQty * u.perBase; if (!u.complete) row.complete = false; }
      rows.set(k, row);
    }
  }
  const data = [...rows.values()].map((r) => ({ ...r, menuValue: rup(r.menuValue), foodCost: rup(r.foodCost), foodCostPercent: r.complete && r.menuValue > 0 ? Math.round((r.foodCost / r.menuValue) * 10000) / 100 : null })).sort((a, b) => b.foodCost - a.foodCost);
  return { data, totals: { portions: data.reduce((s, r) => s + r.portions, 0), menuValue: rup(data.reduce((s, r) => s + r.menuValue, 0)), foodCost: rup(data.reduce((s, r) => s + r.foodCost, 0)), complete: data.every((r) => r.complete) },
    note: 'Menu value = menu price x portions (before discounts). Food cost = the cost basis of the stock actually consumed. "Incomplete" means some stock had no recorded cost.' };
}
module.exports = { consumeBill, onBillFinalised, retry, waive, sweep, list, get, foodCostReport, plan };
