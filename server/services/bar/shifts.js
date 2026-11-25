/**
 * Bartender shift closing (Module 8.5). A shift records: who, start/end, the opening stock of every tracked bar item, what was sold / given complimentary /
 * wasted / broken during the shift, the EXPECTED closing stock (from the persisted ledger - never typed in), the bartender's physical count, and the variance.
 * Shift timings and the number of shifts are not specified by the client: shifts are started ad hoc (optionally labelled from configurable definitions).
 * A closed shift cannot be closed again or edited; a correction needs bar.shift.manage + a reason, keeps the original figures and is audited.
 */
const { BarShift, BarOrder, BarComplimentary, BarLoss, Counter } = require('../../models');
const C = require('./core');
const V = require('./variance');
const U = require('../inventory/units');
const { audit } = require('../audit');
const { barSettings } = require('../settings');
const { bad, forbidden, notFound, conflict } = require('../../utils/ApiError');

const shiftLine = (l) => ({ item: l.item, itemName: l.itemName, sku: l.sku, isLiquor: l.isLiquor, baseUnit: l.baseUnit, capacityMl: l.capacityMl, pegMl: l.pegMl,
  openingQ: l._openingQ != null ? l._openingQ / U.SCALE : l.breakdown?.opening, openingOpenQ: l._openingOpenQ != null ? l._openingOpenQ / U.SCALE : undefined,
  expectedQ: l.expectedQ, expectedOpenQ: l.expectedOpenQ, expectedSealedBottles: l.expectedSealedBottles, countedQ: l.countedQ, countedOpenQ: l.countedOpenQ, countedSealedBottles: l.countedSealedBottles,
  varianceQ: l.varianceQ, varianceOpenQ: l.varianceOpenQ, varianceBottles: l.varianceBottles, variancePegs: l.variancePegs, varianceValue: l.varianceValue, exceedsTolerance: l.exceedsTolerance, hasVariance: l.hasVariance, breakdown: l.breakdown });

async function start(req, body = {}) {
  const settings = await barSettings(); const defs = settings.shifts?.definitions || [];
  let definition = body.definition ? String(body.definition).trim().slice(0, 40) : undefined;
  if (defs.length && !defs.some((d) => d.name === definition)) throw bad(`Choose a shift: ${defs.map((d) => d.name).join(', ')}`);
  if (await BarShift.exists({ bartender: req.user._id, status: { $in: ['Open', 'Closing'] } })) throw conflict('You already have an open shift. Close it before starting another.');
  const ids = await C.trackedItemIds(settings); const ex = await V.expectedStock({ itemIds: ids, settings }); const items = await C.loadItems(ids); const units = await U.loadUnits(); const opening = [];
  for (const [id, it] of items) { const e = ex.get(id); const liquor = C.isLiquor(it, settings); const cap = C.capacityOf(it, units);
    opening.push({ item: it._id, itemName: it.name, sku: it.sku, isLiquor: liquor, baseUnit: it.baseUnit, capacityMl: cap || undefined, pegMl: liquor ? settings.pegMl : undefined, openingQ: e.expectedQ / U.SCALE, openingOpenQ: liquor ? e.expectedOpenQ / U.SCALE : undefined }); }
  let shift;
  try { shift = await BarShift.create({ shiftNumber: await Counter.next('BSH', 4), bartender: req.user._id, bartenderName: req.user.name, definition, department: settings.department, startedBy: req.user._id, notes: body.notes?.toString().slice(0, 300), opening }); }
  catch (e) { if (C.isDup(e)) throw conflict('You already have an open shift. Close it before starting another.'); throw e; }
  await audit(req, { action: 'create', module: 'Bar', entity: 'BarShift', entityId: shift._id, entityLabel: `${shift.shiftNumber} started`, newValue: { definition, items: opening.length } });
  return shift;
}
function canClose(req, shift) { if (req.permissions.has('bar.shift.manage')) return true; if (req.permissions.has('bar.shift.work') && String(shift.bartender) === String(req.user._id)) return true; return false; }

/** What the closing screen needs: the tracked items, the shift's opening stock and (managers only) the book figures. */
async function closingSheet(req, id) {
  const shift = await BarShift.findById(id).lean(); if (!shift) throw notFound('Shift not found'); if (!canClose(req, shift) && !req.permissions.has('bar.shift.work')) throw forbidden();
  const ctx = await V.loadCtx(); const ids = [...new Set([...(shift.opening || []).map((o) => String(o.item)), ...(await C.trackedItemIds(ctx.settings))])];
  const items = await C.loadItems(ids); const showExpected = req.permissions.has('bar.shift.manage'); const ex = showExpected ? await V.expectedStock({ itemIds: ids, from: shift.startedAt, settings: ctx.settings }) : null; const out = [];
  for (const [iid, it] of items) { const liquor = C.isLiquor(it, ctx.settings); const o = shift.opening.find((x) => String(x.item) === iid); const e = ex?.get(iid);
    out.push({ item: it._id, sku: it.sku, name: it.name, isLiquor: liquor, baseUnit: it.baseUnit, capacityMl: C.capacityOf(it, ctx.units), openingQ: o?.openingQ, openingOpenQ: o?.openingOpenQ, ...(e ? { expectedQ: e.expectedQ / U.SCALE, expectedOpenQ: e.expectedOpenQ / U.SCALE, breakdown: V.toDisplay(e.breakdown) } : {}) }); }
  return { shift, tolerance: ctx.tol, blindCount: !showExpected, items: out.sort((a, b) => (b.isLiquor - a.isLiquor) || a.name.localeCompare(b.name)) };
}
async function activity(shiftId) {
  const orders = await BarOrder.find({ shift: shiftId, status: 'Served' }).select('lines total').lean(); const byMeasure = {}; let drinks = 0; let revenue = 0;
  for (const o of orders) { revenue += o.total; for (const l of o.lines) { drinks += l.quantity; byMeasure[l.measure] = (byMeasure[l.measure] || 0) + l.quantity; } }
  const comps = await BarComplimentary.find({ shift: shiftId, status: 'Issued' }).select('quantity').lean();
  return { sales: { orders: orders.length, drinks, revenue: Math.round(revenue * 100) / 100, byMeasure }, complimentary: { requests: comps.length, drinks: comps.reduce((s, c) => s + c.quantity, 0) },
    wastage: { records: await BarLoss.countDocuments({ shift: shiftId, kind: 'Wastage' }) }, breakage: { records: await BarLoss.countDocuments({ shift: shiftId, kind: 'Breakage' }) } };
}
async function close(req, id, body = {}) {
  const shift0 = await BarShift.findById(id); if (!shift0) throw notFound('Shift not found'); if (!canClose(req, shift0)) throw forbidden('You can only close your own shift');
  if (shift0.status === 'Closed') throw conflict(`${shift0.shiftNumber} was already closed - a closed shift cannot be closed again. Ask a manager for a correction if a figure is wrong.`);
  const claimed = await BarShift.findOneAndUpdate({ _id: id, status: 'Open' }, { $set: { status: 'Closing' } }, { new: true });
  if (!claimed) throw conflict(`${shift0.shiftNumber} is already being closed or is closed`);
  try {
    const ctx = await V.loadCtx(); const to = new Date(); const ids = [...new Set([...claimed.opening.map((o) => String(o.item)), ...(await C.trackedItemIds(ctx.settings))])];
    const ex = await V.expectedStock({ itemIds: ids, from: claimed.startedAt, to: new Date(to.getTime() + 1), settings: ctx.settings }); const items = await C.loadItems(ids);
    const given = new Set((body.counts || []).map((c) => String(c.item))); const need = [];
    for (const [iid, e] of ex) { const touched = e.expectedQ !== 0 || Object.values(e.breakdown).some((v) => v !== 0); if (touched && !given.has(iid)) need.push(items.get(iid)?.name || iid); }
    if (need.length) throw bad(`Count every item before closing. Missing: ${need.join(', ')}`);
    const lines = (await V.buildLines(body.counts || [], ex, ctx)).map(shiftLine); const act = await activity(claimed._id);
    const done = await BarShift.findOneAndUpdate({ _id: id, status: 'Closing' }, { $set: { status: 'Closed', endedAt: to, closedBy: req.user._id, closedByName: req.user.name, closingNotes: body.notes?.toString().slice(0, 400),
      closing: { lines, window: { from: claimed.startedAt, to }, ...act, linesWithVariance: lines.filter((l) => l.hasVariance).length, toleranceConfigured: ctx.tol.configured } } }, { new: true });
    await audit(req, { action: 'status', module: 'Bar', entity: 'BarShift', entityId: id, entityLabel: `${done.shiftNumber} closed (${done.closing.linesWithVariance} with variance)`, newValue: { closing: done.closing } });
    await V.raiseAlerts(req, { source: 'shift', sourceId: done._id, sourceLabel: done.shiftNumber, lines, ctx });
    return done;
  } catch (e) { await BarShift.updateOne({ _id: id, status: 'Closing' }, { $set: { status: 'Open' } }); throw e; }
}
/** Correct a closed shift's physical count. Original figures are preserved in the correction history. */
async function correct(req, id, body = {}) {
  const reason = String(body.reason || '').trim(); if (reason.length < 10) throw bad('Explain the correction (at least 10 characters)');
  const shift = await BarShift.findById(id); if (!shift) throw notFound('Shift not found'); if (shift.status !== 'Closed') throw bad('Only a closed shift can be corrected');
  if (!(body.counts || []).length) throw bad('Enter the corrected count for at least one item');
  const ctx = await V.loadCtx(); const win = shift.closing.window; const ids = shift.closing.lines.map((l) => String(l.item));
  const ex = await V.expectedStock({ itemIds: ids, from: win.from, to: new Date(new Date(win.to).getTime() + 1), settings: ctx.settings });
  const changed = new Map(body.counts.map((c) => [String(c.item), c]));
  for (const k of changed.keys()) if (!ids.includes(k)) throw bad('That item is not part of this shift');
  const merged = shift.closing.lines.map((l) => changed.get(String(l.item)) || (l.isLiquor ? { item: String(l.item), sealedBottles: l.countedSealedBottles, openMl: l.countedOpenQ } : { item: String(l.item), quantity: l.countedQ, unit: l.baseUnit }));
  const lines = (await V.buildLines(merged, ex, ctx)).map(shiftLine); const before = shift.closing.toObject().lines;
  const upd = await BarShift.findOneAndUpdate({ _id: id, status: 'Closed', revision: shift.revision }, { $set: { 'closing.lines': lines, 'closing.linesWithVariance': lines.filter((l) => l.hasVariance).length }, $inc: { revision: 1 },
    $push: { corrections: { at: new Date(), by: req.user._id, byName: req.user.name, reason, before, after: lines } } }, { new: true });
  if (!upd) throw conflict('The shift was changed by someone else - reload and try again');
  await audit(req, { action: 'update', module: 'Bar', entity: 'BarShift', entityId: id, entityLabel: `${upd.shiftNumber} closing corrected (revision ${upd.revision})`, oldValue: { lines: before }, newValue: { lines }, note: reason });
  await V.raiseAlerts(req, { source: 'shift', sourceId: upd._id, sourceLabel: `${upd.shiftNumber} (corrected)`, lines, revision: upd.revision, ctx });
  return upd;
}
async function list(req, q = {}) {
  const f = {}; if (q.status) f.status = q.status; if (q.user) f.bartender = q.user;
  if (!req.permissions.has('bar.shift.manage')) f.bartender = req.user._id;
  if (q.from || q.to) { f.startedAt = {}; if (q.from) f.startedAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.startedAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); }
  return BarShift.find(f).select('-opening -corrections.before -corrections.after').sort({ startedAt: -1 }).limit(Math.min(Number(q.limit) || 100, 500)).lean();
}
async function get(req, id) {
  const s = await BarShift.findById(id).lean(); if (!s) throw notFound('Shift not found');
  if (!req.permissions.has('bar.shift.manage') && String(s.bartender) !== String(req.user._id)) throw forbidden('You can only view your own shifts');
  if (s.status === 'Open') s.liveActivity = await activity(s._id);
  return s;
}
const current = (req) => BarShift.findOne({ bartender: req.user._id, status: { $in: ['Open', 'Closing'] } }).lean();
module.exports = { start, closingSheet, close, correct, list, get, current, activity };
