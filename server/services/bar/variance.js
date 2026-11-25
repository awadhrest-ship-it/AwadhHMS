/**
 * Stock variance (Module 8.3) + the book-stock calculation shared with shift closing (8.5) and the reports.
 *
 * EXPECTED stock is never typed in or estimated: it is derived from the persisted Phase 4 ledger of the bar department
 *   opening + received + sold + complimentary + wastage + breakage + adjustments + other = expected closing
 * (sales/complimentary are told apart by the movement's source - bar-sale / bar-comp; wastage/breakage by the Phase 4 movement type).
 * The opened-liquor pool has its own ledger (BarOpenLedger), so expected "opened" and expected "sealed" bottles are derived the same way.
 * A recorded count is IMMUTABLE and never changes stock. A variance that needs correcting becomes a normal Phase 4 stock adjustment (approval required).
 */
const { z } = require('zod');
const { Types } = require('mongoose');
const { StockLedger, StockMovement, BarOpenLedger, BarReconciliation, BarVarianceAlert, Counter, Role, User, InventoryItem } = require('../../models');
const C = require('./core');
const U = require('../inventory/units');
const stock = require('../inventory/stock');
const { audit } = require('../audit');
const { notify } = require('../notify');
const { barSettings } = require('../settings');
const { startOfIstDay, todayStr } = require('../../utils/dates');
const { bad, notFound, conflict } = require('../../utils/ApiError');
const { parse } = require('../../utils/wrap');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const EMPTY = () => ({ opening: 0, received: 0, sold: 0, complimentary: 0, wastage: 0, breakage: 0, adjustments: 0, other: 0 });

/** Group the bar department's ledger for the given items between `from` (inclusive) and `to` (exclusive). All figures in micro-units, outflows negative. */
async function ledgerSummary({ department, itemIds, from, to }) {
  const ids = itemIds.map(String); const out = new Map(ids.map((i) => [i, EMPTY()]));
  const q = { department, item: { $in: ids } }; if (to) q.at = { $lt: to };
  const rows = await StockLedger.find(q).select('item deltaQ type side movement at').lean();
  const mv = new Map((await StockMovement.find({ _id: { $in: [...new Set(rows.filter((r) => r.type === 'Consumption').map((r) => String(r.movement)))] } }).select('source').lean()).map((m) => [String(m._id), m.source]));
  for (const r of rows) {
    const b = out.get(String(r.item)); if (!b) continue;
    if (from && r.at < from) { b.opening += r.deltaQ; continue; }
    if (['Stock In', 'Opening Stock'].includes(r.type) || (r.type === 'Transfer' && r.side === 'in')) b.received += r.deltaQ;
    else if (r.type === 'Wastage') b.wastage += r.deltaQ;
    else if (['Breakage', 'Damaged'].includes(r.type)) b.breakage += r.deltaQ;
    else if (r.type === 'Adjustment') b.adjustments += r.deltaQ;
    else if (r.type === 'Consumption' && mv.get(String(r.movement)) === 'bar-sale') b.sold += r.deltaQ;
    else if (r.type === 'Consumption' && mv.get(String(r.movement)) === 'bar-comp') b.complimentary += r.deltaQ;
    else b.other += r.deltaQ;
  }
  return out;
}
const sumQ = (b) => b.opening + b.received + b.sold + b.complimentary + b.wastage + b.breakage + b.adjustments + b.other;
async function openPoolAt(itemIds, t) {
  const q = { item: { $in: itemIds.map((i) => new Types.ObjectId(String(i))) } }; if (t) q.at = { $lt: t };   // aggregate() does not cast ids like find() does
  const rows = await BarOpenLedger.aggregate([{ $match: q }, { $group: { _id: '$item', q: { $sum: '$deltaQ' } } }]);
  return new Map(rows.map((r) => [String(r._id), r.q]));
}
const toDisplay = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v / U.SCALE]));

/** Book (expected) figures for items over [from, to). `to` omitted = now. */
async function expectedStock({ itemIds, from, to, settings }) {
  const s = settings || await barSettings(); const grouped = await ledgerSummary({ department: s.department, itemIds, from, to });
  const openAtTo = await openPoolAt(itemIds.map(String), to); const openAtFrom = from ? await openPoolAt(itemIds.map(String), from) : new Map();
  const out = new Map();
  for (const [id, b] of grouped) { const total = sumQ(b); out.set(id, { breakdown: b, expectedQ: total, expectedOpenQ: Math.max(0, Math.min(openAtTo.get(id) || 0, total)), openingOpenQ: Math.max(0, openAtFrom.get(id) || 0) }); }
  return out;
}

/* ------------------------------------------------------------------ counts -> variance lines */
const countSchema = z.object({ item: oid, sealedBottles: z.number().int().min(0).max(100000).optional(), openMl: z.number().min(0).max(1e7).optional(), quantity: z.number().min(0).max(1e9).optional(), unit: z.string().trim().min(1).max(20).optional(), note: z.string().max(200).optional() });
function tolerance(settings) { const v = settings.variance || {}; return { toleranceMl: v.toleranceMl ?? null, tolerancePercent: v.tolerancePercent ?? null, toleranceOther: v.toleranceOther ?? null, configured: [v.toleranceMl, v.tolerancePercent, v.toleranceOther].some((x) => x != null) }; }
function exceeds(varianceQ, expectedQ, liquor, tol) {
  const abs = Math.abs(varianceQ) / U.SCALE; if (!abs) return false;
  if (!tol.configured) return true;                                  // provisional: no tolerance configured -> every difference is reported
  const limit = liquor ? tol.toleranceMl : tol.toleranceOther;
  if (limit == null && tol.tolerancePercent == null) return true;    // no limit configured for this kind of item -> strict
  return (limit != null && abs > limit) || (tol.tolerancePercent != null && expectedQ > 0 && (abs / (expectedQ / U.SCALE)) * 100 > tol.tolerancePercent);
}
async function loadCtx() { const settings = await barSettings(); return { settings, units: await U.loadUnits(), tol: tolerance(settings) }; }

/** Build the per-item variance lines from entered counts and expected figures. */
async function buildLines(rawCounts, expected, ctx) {
  const counts = rawCounts.map((c) => parse(countSchema, c)); const seen = new Set();
  const items = await C.loadItems(counts.map((c) => c.item)); const lines = [];
  for (const c of counts) {
    if (seen.has(c.item)) throw bad('An item is listed twice in the count'); seen.add(c.item);
    const it = items.get(String(c.item)); if (!it) throw bad('An item in the count was not found');
    const ex = expected.get(String(c.item)); if (!ex) throw bad(`${it.name} is not a tracked bar item`);
    const liquor = C.isLiquor(it, ctx.settings); const cap = C.capacityOf(it, ctx.units); let countedQ; let countedOpenQ = 0; let countedSealed = 0;
    if (liquor) {
      if (!cap) throw bad(`${it.name} has no bottle capacity configured`);
      if (c.sealedBottles == null || c.openMl == null) throw bad(`${it.name}: enter the sealed bottles and the ml left in opened bottles`);
      countedSealed = c.sealedBottles; countedOpenQ = U.toQ(c.openMl); countedQ = U.toQ(cap * c.sealedBottles) + countedOpenQ;
    } else {
      if (c.quantity == null) throw bad(`${it.name}: enter the quantity counted`);
      countedQ = c.quantity === 0 ? 0 : U.toBase(it, c.quantity, (c.unit || it.usageUnit || it.baseUnit).toLowerCase(), ctx.units).qtyQ;
    }
    const expSealedQ = Math.max(0, ex.expectedQ - ex.expectedOpenQ); const expSealedBottles = liquor && cap ? Math.round((expSealedQ / U.toQ(cap)) * 1e4) / 1e4 : undefined;
    const varianceQ = countedQ - ex.expectedQ; const varianceOpenQ = liquor ? countedOpenQ - ex.expectedOpenQ : 0;
    const pegMl = ctx.settings.pegMl; const cost = it.lastPurchase?.pricePerBase;
    lines.push({ item: it._id, itemName: it.name, sku: it.sku, isLiquor: liquor, baseUnit: it.baseUnit, capacityMl: cap || undefined, pegMl: liquor ? pegMl : undefined,
      expectedQ: ex.expectedQ / U.SCALE, expectedOpenQ: liquor ? ex.expectedOpenQ / U.SCALE : undefined, expectedSealedBottles: expSealedBottles,
      countedQ: countedQ / U.SCALE, countedOpenQ: liquor ? countedOpenQ / U.SCALE : undefined, countedSealedBottles: liquor ? countedSealed : undefined,
      varianceQ: varianceQ / U.SCALE, varianceOpenQ: liquor ? varianceOpenQ / U.SCALE : undefined, varianceBottles: liquor && cap ? Math.round(((varianceQ / U.SCALE) / cap) * 1e4) / 1e4 : undefined,
      variancePegs: liquor ? Math.round(((varianceQ / U.SCALE) / pegMl) * 100) / 100 : undefined, varianceValue: cost ? Math.round((varianceQ / U.SCALE) * cost * 100) / 100 : undefined,
      hasVariance: varianceQ !== 0 || varianceOpenQ !== 0, exceedsTolerance: exceeds(varianceQ, ex.expectedQ, liquor, ctx.tol), note: c.note, breakdown: toDisplay(ex.breakdown),
      _openingQ: ex.breakdown.opening, _openingOpenQ: ex.openingOpenQ });
  }
  return lines;
}
const stripPrivate = (l) => { const { _openingQ, _openingOpenQ, ...rest } = l; return rest; };

/* ------------------------------------------------------------------ alerts (one per variance event, never duplicated) */
async function recipientUsers(cfg = {}) {
  const roles = (cfg.roles || []).length ? await Role.find({ key: { $in: cfg.roles } }).select('_id') : []; const ids = (cfg.users || []).filter((x) => /^[a-f\d]{24}$/i.test(x));
  if (!roles.length && !ids.length) return [];
  const or = []; if (roles.length) or.push({ role: { $in: roles.map((r) => r._id) } }); if (ids.length) or.push({ _id: { $in: ids } });
  return User.find({ active: true, $or: or }).select('_id').lean();
}
/** Raise an alert for every line that is a reportable variance. The unique key makes a repeated call a no-op. */
async function raiseAlerts(req, { source, sourceId, sourceLabel, lines, revision = 0, ctx }) {
  const tol = ctx.tol; const raised = [];
  for (const l of lines.filter((x) => x.hasVariance && x.exceedsTolerance)) {
    const key = `${source}:${sourceId}:${l.item}:r${revision}`;
    const users = await recipientUsers(ctx.settings.variance?.recipients); const fallback = users.length === 0;
    let created = false;
    try { const r = await BarVarianceAlert.updateOne({ key }, { $setOnInsert: { key, source, sourceId, sourceLabel, item: l.item, itemName: l.itemName, varianceQ: l.varianceQ, variancePegs: l.variancePegs, varianceBottles: l.varianceBottles, baseUnit: l.baseUnit, toleranceConfigured: tol.configured,
      recipientCount: users.length, usedFallback: fallback, noRecipients: false, createdAt: new Date() } }, { upsert: true }); created = !!r.upsertedCount; } catch (e) { if (!C.isDup(e)) throw e; }
    if (!created) continue;
    const sign = l.varianceQ > 0 ? '+' : '−'; const mag = Math.abs(l.varianceQ); const pegs = l.variancePegs != null ? ` (${sign}${Math.abs(l.variancePegs)} pegs of ${l.pegMl} ml)` : '';
    const msg = `${sourceLabel}: ${l.itemName} counted ${l.countedQ} vs expected ${l.expectedQ} ${l.baseUnit} - ${sign}${mag} ${l.baseUnit}${pegs}${tol.configured ? '' : ' · tolerance not configured: every difference is reported'}`;
    const base = { type: 'bar_variance', title: `Bar stock variance: ${l.itemName}`, message: msg, link: '/bar/variance', severity: 'warning' };
    if (fallback) await notify({ ...base, permission: 'bar.variance.view' }); else for (const u of users) await notify({ ...base, user: u._id });
    raised.push(key);
  }
  return raised;
}
async function acknowledge(req, id) {
  const a = await BarVarianceAlert.findOneAndUpdate({ _id: id, acknowledgedAt: { $exists: false } }, { $set: { acknowledgedAt: new Date(), acknowledgedBy: req.user._id } }, { new: true });
  if (!a) throw notFound('Alert not found or already acknowledged'); await audit(req, { action: 'update', module: 'Bar', entity: 'BarVarianceAlert', entityId: id, entityLabel: `Variance alert ${a.itemName} acknowledged` }); return a;
}
const listAlerts = (q = {}) => BarVarianceAlert.find(q.open === 'true' ? { acknowledgedAt: { $exists: false } } : {}).sort({ createdAt: -1 }).limit(100).lean();

/* ------------------------------------------------------------------ reconciliation (stock count) */
/** Expected figures right now for the given items (or every tracked item) - what the count screen shows BEFORE counting is typed in (never pre-fills the count). */
async function expectedNow(itemIds) {
  const ctx = await loadCtx(); const ids = itemIds?.length ? itemIds : await C.trackedItemIds(ctx.settings);
  const items = await C.loadItems(ids); const last = await BarReconciliation.findOne({ department: ctx.settings.department }).sort({ countedAt: -1 }).select('countedAt').lean();
  const from = last?.countedAt || startOfIstDay(todayStr()); const ex = await expectedStock({ itemIds: ids, from, settings: ctx.settings }); const out = [];
  for (const [id, it] of items) { const e = ex.get(id); const liquor = C.isLiquor(it, ctx.settings); const cap = C.capacityOf(it, ctx.units);
    out.push({ item: it._id, sku: it.sku, name: it.name, category: it.categoryName, baseUnit: it.baseUnit, isLiquor: liquor, capacityMl: cap, expectedQ: e.expectedQ / U.SCALE, expectedOpenQ: e.expectedOpenQ / U.SCALE,
      expectedSealedBottles: liquor && cap ? Math.round(((e.expectedQ - e.expectedOpenQ) / U.toQ(cap)) * 1e4) / 1e4 : null, breakdown: toDisplay(e.breakdown) }); }
  return { periodFrom: from, tolerance: ctx.tol, items: out.sort((a, b) => (b.isLiquor - a.isLiquor) || a.name.localeCompare(b.name)) };
}
async function record(req, body, idempotencyKey) {
  const b = parse(z.object({ counts: z.array(z.object({}).passthrough()).min(1).max(200), notes: z.string().max(400).optional() }), body);
  const key = `u:${req.user._id}:${idempotencyKey}`; const existing = await BarReconciliation.findOne({ idempotencyKey: key });
  if (existing) return { reconciliation: existing, replayed: true };
  const ctx = await loadCtx(); const ids = b.counts.map((c) => c.item).filter(Boolean);
  const tracked = new Set(await C.trackedItemIds(ctx.settings)); for (const id of ids) if (!tracked.has(String(id))) throw bad('One of the items is not tracked by the bar');
  const last = await BarReconciliation.findOne({ department: ctx.settings.department }).sort({ countedAt: -1 }).select('countedAt').lean();
  const from = last?.countedAt || startOfIstDay(todayStr()); const countedAt = new Date();
  const expected = await expectedStock({ itemIds: ids, from, to: new Date(countedAt.getTime() + 1), settings: ctx.settings });
  const lines = (await buildLines(b.counts, expected, ctx)).map(stripPrivate); const shift = await C.myOpenShift(req, ctx.settings);
  let rec;
  try {
    rec = await BarReconciliation.create({ reconNumber: await Counter.next('BRC', 4), idempotencyKey: key, department: ctx.settings.department, countedAt, periodFrom: from, lines, notes: b.notes, toleranceConfigured: ctx.tol.configured,
      linesWithVariance: lines.filter((l) => l.hasVariance).length, shift: shift?._id, countedBy: req.user._id, countedByName: req.user.name });
  } catch (e) { if (C.isDup(e)) { const again = await BarReconciliation.findOne({ idempotencyKey: key }); if (again) return { reconciliation: again, replayed: true }; } throw e; }
  await audit(req, { action: 'create', module: 'Bar', entity: 'BarReconciliation', entityId: rec._id, entityLabel: `${rec.reconNumber} stock count (${rec.linesWithVariance} with variance)`, newValue: rec });
  const alerts = await raiseAlerts(req, { source: 'reconciliation', sourceId: rec._id, sourceLabel: rec.reconNumber, lines, ctx });
  return { reconciliation: rec, alerts: alerts.length, replayed: false };
}
/** Turn one counted variance into a Phase 4 stock adjustment REQUEST (needs General Manager / Owner approval). Nothing changes until it is approved. */
async function requestAdjustment(req, reconId, lineId, { note } = {}) {
  const rec = await BarReconciliation.findById(reconId); if (!rec) throw notFound('Count not found');
  const line = rec.lines.id(lineId); if (!line) throw notFound('Line not found'); if (!line.varianceQ) throw bad('This line has no variance to adjust');
  if (line.adjustment && ['Requested', 'Applied'].includes(line.adjustment.status)) throw conflict(`An adjustment is already ${line.adjustment.status.toLowerCase()} for this line`);
  const direction = line.varianceQ > 0 ? 'increase' : 'decrease'; const { movement, approval } = await stock.requestAdjustment(req, { item: line.item, quantity: Math.abs(line.varianceQ), unit: line.baseUnit, direction, department: rec.department,
    reason: `Bar stock count ${rec.reconNumber}: ${line.itemName} counted ${line.countedQ} vs expected ${line.expectedQ} ${line.baseUnit}${note ? ' - ' + note : ''}`.slice(0, 250), idempotencyKey: `bar-var-adj:${reconId}:${lineId}${line.adjustment?.status === 'Rejected' ? `:r${Date.now()}` : ''}`.slice(0, 80) });
  await StockMovement.updateOne({ _id: movement._id }, { $set: { source: 'bar-variance', reference: { model: 'BarReconciliation', id: rec._id, label: rec.reconNumber } } });
  await BarReconciliation.updateOne({ _id: reconId, 'lines._id': lineId }, { $set: { 'lines.$.adjustment': { status: 'Requested', movement: movement._id, approval: approval?._id, requestedAt: new Date() } } });
  await audit(req, { action: 'create', module: 'Bar', entity: 'BarReconciliation', entityId: rec._id, entityLabel: `${rec.reconNumber} adjustment requested for ${line.itemName}`, newValue: { direction, quantity: Math.abs(line.varianceQ), approval: approval?.requestNumber } });
  return BarReconciliation.findById(reconId);
}
/** Called by the Phase 4 approval handler once a bar-variance adjustment is decided. */
async function onAdjustmentDecided(req, movement, status) {
  const recId = movement.reference?.id; if (!recId) return;
  const rec = await BarReconciliation.findById(recId); if (!rec) return; const line = rec.lines.find((l) => String(l.adjustment?.movement) === String(movement._id)); if (!line) return;
  if (status === 'Applied') {
    const cur = await C.openQOf(line.item); const target = Math.min(U.toQ(line.countedOpenQ || 0), await C.totalQOf(line.item, rec.department)); const delta = target - cur;
    if (delta) { const k = `bar-var-open:${movement._id}`; await C.applyOpen(line.item, delta, k); await C.writeOpenLedger([{ key: k, item: line.item, deltaQ: delta, kind: 'adjustment', refModel: 'BarReconciliation', refId: rec._id, refLabel: rec.reconNumber, by: req.user?._id }]); }
  }
  await BarReconciliation.updateOne({ _id: recId, 'lines._id': line._id }, { $set: { 'lines.$.adjustment.status': status, ...(status === 'Applied' ? { 'lines.$.adjustment.appliedAt': new Date() } : {}) } });
}
async function list(q = {}) {
  const f = {}; if (q.from || q.to) { f.countedAt = {}; if (q.from) f.countedAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.countedAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); }
  if (q.item) f['lines.item'] = q.item; if (q.user) f.countedBy = q.user; if (q.variance === 'true') f.linesWithVariance = { $gt: 0 };
  return BarReconciliation.find(f).sort({ countedAt: -1 }).limit(Math.min(Number(q.limit) || 100, 500)).lean();
}
const get = async (id) => { const r = await BarReconciliation.findById(id).lean(); if (!r) throw notFound('Count not found'); return r; };
module.exports = { ledgerSummary, expectedStock, buildLines, stripPrivate, raiseAlerts, acknowledge, listAlerts, expectedNow, record, requestAdjustment, onAdjustmentDecided, list, get, loadCtx, tolerance, exceeds, toDisplay, sumQ, EMPTY };
