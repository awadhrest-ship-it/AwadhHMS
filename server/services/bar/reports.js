/** Bar reports (all read persisted records - nothing is fabricated): liquor stock, opening/closing, consumption, variance, complimentary, wastage, breakage, shift closing, daily summary (for Phase 12 / 13). */
const { BarOrder, BarComplimentary, BarLoss, BarReconciliation, BarShift, BarOpenLedger, BarBottleOpening } = require('../../models');
const C = require('./core');
const V = require('./variance');
const bottles = require('./bottles');
const orders = require('./orders');
const U = require('../inventory/units');
const { barSettings } = require('../settings');
const { startOfIstDay, todayStr } = require('../../utils/dates');
const { bad } = require('../../utils/ApiError');

const dayStart = (s) => new Date(`${s}T00:00:00+05:30`); const dayEnd = (s) => new Date(dayStart(s).getTime() + 864e5);
function window(q) { const from = q.from || todayStr(); const to = q.to || from; if (from > to) throw bad('"From" cannot be after "To"'); return { from, to, start: dayStart(from), end: dayEnd(to) }; }

async function liquorStock() { return { generatedAt: new Date(), settings: { pegMl: (await barSettings()).pegMl }, items: await bottles.inventory() }; }

/** Opening / closing stock per item for a date range, straight from the ledger. */
async function openingClosing(q) {
  const w = window(q); const settings = await barSettings(); let ids = await C.trackedItemIds(settings); if (q.item) ids = ids.filter((i) => i === String(q.item));
  const items = await C.loadItems(ids); const ex = await V.expectedStock({ itemIds: ids, from: w.start, to: w.end, settings }); const units = await U.loadUnits(); const rows = [];
  for (const [id, e] of ex) { const it = items.get(id); const b = V.toDisplay(e.breakdown); const cap = C.capacityOf(it, units); const closing = e.expectedQ / U.SCALE;
    rows.push({ item: it._id, sku: it.sku, name: it.name, category: it.categoryName, baseUnit: it.baseUnit, isLiquor: C.isLiquor(it, settings), capacityMl: cap, opening: b.opening, received: b.received, sold: b.sold, complimentary: b.complimentary, wastage: b.wastage, breakage: b.breakage, adjustments: b.adjustments, other: b.other, closing, closingBottles: cap ? Math.round((closing / cap) * 100) / 100 : null }); }
  return { from: w.from, to: w.to, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}
/** Bottle & peg-wise consumption: pegs / bottles actually served, from served orders (and complimentary issues shown separately). */
async function consumption(q) {
  const w = window(q); const f = { status: 'Served', servedAt: { $gte: w.start, $lt: w.end } }; if (q.user) f.servedBy = q.user;
  const os = await BarOrder.find(f).select('lines servedBy servedByName').lean(); const rows = new Map();
  const add = (name, category, measure, qty, ml, rev, comp) => { const k = `${name}|${measure}`; const r = rows.get(k) || { name, category, measure, drinks: 0, ml: 0, revenue: 0, complimentary: 0 }; r.drinks += comp ? 0 : qty; r.complimentary += comp ? qty : 0; r.ml += (ml || 0) * qty; r.revenue += rev; rows.set(k, r); };
  for (const o of os) for (const l of o.lines) { if (q.item && !(l.consumption || []).some((c) => String(c.item) === String(q.item))) continue; add(l.name, l.category, l.measure, l.quantity, l.ml, l.lineTotal); }
  const cf = { status: 'Issued', issuedAt: { $gte: w.start, $lt: w.end } }; if (q.user) cf.issuedBy = q.user;
  for (const c of await BarComplimentary.find(cf).lean()) { if (q.item && !(c.consumption || []).some((x) => String(x.item) === String(q.item))) continue; add(c.itemName, '', c.measure, c.quantity, (c.consumption || []).find((x) => x.role === 'liquor')?.baseQty / c.quantity, 0, true); }
  const out = [...rows.values()].map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100, ml: Math.round(r.ml * 100) / 100 })).sort((a, b) => a.name.localeCompare(b.name));
  return { from: w.from, to: w.to, rows: out, totals: { drinks: out.reduce((s, r) => s + r.drinks, 0), complimentary: out.reduce((s, r) => s + r.complimentary, 0), revenue: Math.round(out.reduce((s, r) => s + r.revenue, 0) * 100) / 100 } };
}
/** Variance report + peg-variance report: every counted line from stock counts and shift closings. */
async function variance(q) {
  const w = window(q); const rows = [];
  const recs = await BarReconciliation.find({ countedAt: { $gte: w.start, $lt: w.end }, ...(q.user ? { countedBy: q.user } : {}) }).lean();
  for (const r of recs) for (const l of r.lines) rows.push({ source: 'Stock count', reference: r.reconNumber, at: r.countedAt, by: r.countedByName, ...pick(l), adjustment: l.adjustment?.status });
  const shifts = await BarShift.find({ status: 'Closed', endedAt: { $gte: w.start, $lt: w.end }, ...(q.user ? { bartender: q.user } : {}) }).lean();
  for (const s of shifts) for (const l of s.closing.lines) rows.push({ source: 'Shift closing', reference: s.shiftNumber, at: s.endedAt, by: s.bartenderName, ...pick(l) });
  const f = rows.filter((r) => (!q.item || String(r.item) === String(q.item)) && (q.onlyVariance !== 'true' || r.hasVariance)).sort((a, b) => new Date(b.at) - new Date(a.at));
  return { from: w.from, to: w.to, rows: f, totals: { lines: f.length, withVariance: f.filter((r) => r.hasVariance).length, exceedingTolerance: f.filter((r) => r.hasVariance && r.exceedsTolerance).length } };
}
const pick = (l) => ({ item: l.item, itemName: l.itemName, isLiquor: l.isLiquor, baseUnit: l.baseUnit, expectedQ: l.expectedQ, countedQ: l.countedQ, varianceQ: l.varianceQ, varianceBottles: l.varianceBottles, variancePegs: l.variancePegs, pegMl: l.pegMl, varianceValue: l.varianceValue, hasVariance: l.hasVariance, exceedsTolerance: l.exceedsTolerance });
async function complimentary(q) {
  const w = window(q); const f = { createdAt: { $gte: w.start, $lt: w.end } }; if (q.status) f.status = q.status; if (q.user) f.requestedBy = q.user;
  const rows = await BarComplimentary.find(f).sort({ createdAt: -1 }).populate('approval', 'requestNumber approver').lean();
  const issued = rows.filter((r) => r.status === 'Issued');
  return { from: w.from, to: w.to, rows, totals: { requests: rows.length, issuedDrinks: issued.reduce((s, r) => s + r.quantity, 0), issuedListValue: Math.round(issued.reduce((s, r) => s + (r.listValue || 0), 0) * 100) / 100, pending: rows.filter((r) => r.status === 'Pending Approval').length, rejected: rows.filter((r) => r.status === 'Rejected').length } };
}
async function loss(kind, q) {
  const w = window(q); const f = { kind, occurredAt: { $gte: w.start, $lt: w.end } }; if (q.item) f.item = q.item; if (q.user) f.recordedBy = q.user; if (q.reason) f.reason = q.reason;
  const rows = await BarLoss.find(f).sort({ occurredAt: -1 }).lean(); const byItem = new Map();
  for (const r of rows) for (const c of r.consumption || []) { const k = String(c.item); const x = byItem.get(k) || { item: c.item, itemName: c.itemName, baseQty: 0, unit: c.unit }; x.baseQty = Math.round((x.baseQty + c.baseQty) * 1e6) / 1e6; byItem.set(k, x); }
  return { from: w.from, to: w.to, kind, rows, byItem: [...byItem.values()], totals: { records: rows.length } };
}
async function shiftClosing(req, q) {
  const w = window(q); const f = { status: 'Closed', endedAt: { $gte: w.start, $lt: w.end } }; if (q.user) f.bartender = q.user; if (!req.permissions.has('bar.shift.manage') && !req.permissions.has('bar.reports')) f.bartender = req.user._id;
  const rows = await BarShift.find(f).select('-opening -corrections.before -corrections.after').sort({ endedAt: -1 }).lean(); return { from: w.from, to: w.to, rows };
}
/** One day's bar figures in a stable shape for Phase 12 (Finance) and Phase 13 (Night Audit). No accounting entries and no audit procedure are invented here. */
async function dailySummary(q) {
  const w = window({ from: q.date || todayStr() }); const served = await BarOrder.find({ status: 'Served', servedAt: { $gte: w.start, $lt: w.end } }).select('orderNumber total lines billing').lean();
  const byCat = {}; let drinks = 0; for (const o of served) for (const l of o.lines) { byCat[l.category || 'Uncategorised'] = Math.round(((byCat[l.category || 'Uncategorised'] || 0) + l.lineTotal) * 100) / 100; drinks += l.quantity; }
  const shifts = await BarShift.find({ endedAt: { $gte: w.start, $lt: w.end }, status: 'Closed' }).select('shiftNumber bartenderName startedAt endedAt closing.linesWithVariance closing.sales revision').lean();
  const open = await BarShift.find({ status: { $in: ['Open', 'Closing'] } }).select('shiftNumber bartenderName startedAt').lean();
  const comp = await BarComplimentary.find({ status: 'Issued', issuedAt: { $gte: w.start, $lt: w.end } }).select('quantity listValue').lean();
  const wst = await loss('Wastage', { from: w.from }); const brk = await loss('Breakage', { from: w.from });
  return { date: w.from, currency: 'INR', sales: { orders: served.length, drinks, grossTotal: Math.round(served.reduce((s, o) => s + o.total, 0) * 100) / 100, byCategory: byCat, taxIncluded: false },
    billing: { status: 'Pending destination decision', note: 'Bar billing destination is TBC (separate bill / room bill / both). No bar sale has been billed or posted.', unbilledOrders: served.filter((o) => !o.billing?.destination).length },
    complimentary: { issuedDrinks: comp.reduce((s, c) => s + c.quantity, 0), listValue: Math.round(comp.reduce((s, c) => s + (c.listValue || 0), 0) * 100) / 100 }, wastage: wst.totals, breakage: brk.totals,
    shifts: { closed: shifts, stillOpen: open } };
}
module.exports = { liquorStock, openingClosing, consumption, variance, complimentary, loss, shiftClosing, dailySummary, window };
