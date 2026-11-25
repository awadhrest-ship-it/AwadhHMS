/**
 * Bar wastage & breakage (Module 8.4). Two separate workflows (kind = Wastage | Breakage) that each post the matching Phase 4 movement type, so they are
 * distinguishable from sales and from each other in every report. Records are never edited or deleted: a mistake is corrected with a stock adjustment
 * (approval) and an append-only addendum note.
 */
const { z } = require('zod');
const { BarLoss, BarMenuItem, Counter } = require('../../models');
const C = require('./core');
const U = require('../inventory/units');
const { audit } = require('../audit');
const { barSettings } = require('../settings');
const { ApiError, bad, notFound } = require('../../utils/ApiError');
const { parse } = require('../../utils/wrap');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const schema = z.object({
  item: oid.optional(), quantity: z.number().positive().max(1e6), unit: z.string().trim().min(1).max(20).optional(), stockState: z.enum(['opened', 'sealed']).optional(),
  menuItem: oid.optional(), serving: oid.optional(), measure: z.enum(['30 ml', '60 ml', 'Full bottle']).optional(),
  reason: z.string().trim().min(3).max(100), notes: z.string().max(400).optional(), supportingRef: z.string().max(80).optional(), occurredAt: z.string().datetime().optional(),
}).refine((x) => x.item || x.menuItem, 'Choose a stock item or a drink');

async function plan(b, settings) {
  const units = await U.loadUnits();
  if (b.menuItem) {   // a drink was wasted / broken: use its configured consumption (liquor + mixers), never a guess
    if (!Number.isInteger(b.quantity)) throw bad('Enter a whole number of drinks');
    const m = await BarMenuItem.findById(b.menuItem); if (!m) throw bad('Drink not found');
    const s = b.serving ? m.servings.id(b.serving) : m.servings.find((x) => x.measure === b.measure); if (!s) throw bad('Choose the serving that was lost');
    const ids = [m.stockItem, ...m.mixers.map((x) => x.item)].filter(Boolean); const p = C.planServing(m, s, b.quantity, { items: await C.loadItems(ids), units, settings });
    if (p.status !== 'Configured') throw bad(`${m.name} has no complete stock configuration (${p.status === 'Incomplete' ? p.problems.join('; ') : 'not stock-tracked'}) - record the loss against the stock item instead`);
    // for a lost drink the liquor comes from opened stock for pegs and sealed stock for a full bottle (the configured serving decides)
    return { lines: p.lines, primary: p.lines[0], drinks: b.quantity, menu: m, measure: s.measure, stockState: p.lines[0].from === 'open' ? 'opened' : p.lines[0].from === 'sealed' ? 'sealed' : 'unit' };
  }
  const item = (await C.loadItems([b.item])).get(String(b.item)); if (!item || !item.active) throw bad('Inventory item not found or inactive');
  const unit = (b.unit || item.usageUnit || item.baseUnit).toLowerCase(); const { baseQty } = U.toBase(item, b.quantity, unit, units);
  const liquor = C.isLiquor(item, settings); let from = 'unit';
  if (liquor) { if (!b.stockState) throw bad('Say whether the liquor was in an opened bottle or a sealed bottle'); from = b.stockState === 'opened' ? 'open' : 'sealed'; }
  const line = { item: item._id, itemName: item.name, baseQty, unit: item.baseUnit, from, role: 'item' };
  return { lines: [line], primary: line, item, unit, stockState: liquor ? b.stockState : 'unit' };
}
async function complete(req, rec) {
  if (rec.status === 'Posted') return rec;
  const key = `bar-loss:${rec._id}:a${rec.attempt}`;
  try {
    const mv = await C.consume(req, { key, type: rec.kind, source: `bar-${rec.kind.toLowerCase()}`, reason: `${rec.reason}${rec.notes ? ' - ' + rec.notes : ''}`.slice(0, 200), reference: { model: 'BarLoss', id: rec._id, label: rec.lossNumber },
      lines: rec.consumption.map((c) => ({ item: c.item, itemName: c.itemName, baseQty: c.baseQty, unit: c.unit, from: c.from })), kind: rec.kind.toLowerCase(), ref: { model: 'BarLoss', id: rec._id, label: rec.lossNumber } });
    const won = await BarLoss.findOneAndUpdate({ _id: rec._id, status: 'Pending' }, { $set: { status: 'Posted', movement: mv._id } }, { new: true });
    if (won) await audit(req, { action: 'create', module: 'Bar', entity: 'BarLoss', entityId: rec._id, entityLabel: `${rec.lossNumber} ${rec.kind}: ${rec.itemName}`, newValue: won, note: rec.reason });
    return won || (await BarLoss.findById(rec._id));
  } catch (e) { if (e instanceof ApiError && [400, 409].includes(e.status)) await BarLoss.updateOne({ _id: rec._id, status: 'Pending' }, { $inc: { attempt: 1 } }); throw e; }
}
async function record(req, kind, body, idempotencyKey) {
  const b = parse(schema, body); const key = `u:${req.user._id}:${idempotencyKey}`;
  const existing = await BarLoss.findOne({ idempotencyKey: key }); if (existing) return { record: await complete(req, existing), replayed: true };
  const settings = await barSettings(); const reasons = kind === 'Wastage' ? settings.wastageReasons : settings.breakageReasons;
  if (!reasons.includes(b.reason)) throw bad(`Choose a ${kind.toLowerCase()} reason from the list (${reasons.join(', ')})`);
  let at = new Date(); if (b.occurredAt) { const t = new Date(b.occurredAt); if (t > new Date(Date.now() + 5 * 60 * 1000)) throw bad('The time cannot be in the future'); if (t < new Date(Date.now() - 30 * 864e5)) throw bad('Records older than 30 days cannot be entered here'); at = t; }
  const p = await plan(b, settings); const shift = await C.myOpenShift(req, settings);
  let rec;
  try {
    const prim = p.primary;
    rec = await BarLoss.create({ lossNumber: await Counter.next(kind === 'Wastage' ? 'BWS' : 'BBK', 4), idempotencyKey: key, kind, item: prim.item, itemName: p.menu ? `${p.menu.name} (${p.measure})` : prim.itemName, quantity: b.quantity, unit: p.menu ? 'drink' : p.unit, baseQty: prim.baseQty, baseUnit: prim.unit,
      stockState: p.stockState, menuItem: p.menu?._id, measure: p.measure, drinks: p.drinks, consumption: p.lines.map((x) => ({ item: x.item, itemName: x.itemName, baseQty: x.baseQty, unit: x.unit, from: x.from, role: x.role })),
      reason: b.reason, notes: b.notes, supportingRef: b.supportingRef, occurredAt: at, recordedBy: req.user._id, recordedByName: req.user.name, shift: shift?._id });
  } catch (e) { if (C.isDup(e)) { const again = await BarLoss.findOne({ idempotencyKey: key }); if (again) return { record: await complete(req, again), replayed: true }; } throw e; }
  try { return { record: await complete(req, rec), replayed: false }; }
  catch (e) { if (e instanceof ApiError) await BarLoss.deleteOne({ _id: rec._id, status: 'Pending', attempt: { $lte: 1 } }); throw e; }   // refused before any stock moved: it never became a record
}
async function addendum(req, id, note) {
  if (!note || String(note).trim().length < 3) throw bad('Enter a note');
  const r = await BarLoss.findByIdAndUpdate(id, { $push: { addenda: { at: new Date(), by: req.user._id, byName: req.user.name, note: String(note).trim().slice(0, 400) } } }, { new: true });
  if (!r) throw notFound('Record not found'); await audit(req, { action: 'update', module: 'Bar', entity: 'BarLoss', entityId: id, entityLabel: `${r.lossNumber} note added`, newValue: { note } }); return r;
}
async function list(q = {}) {
  const f = {}; if (q.kind) f.kind = q.kind; if (q.item) f.item = q.item; if (q.user) f.recordedBy = q.user; if (q.reason) f.reason = q.reason;
  if (q.from || q.to) { f.occurredAt = {}; if (q.from) f.occurredAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.occurredAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); }
  return BarLoss.find(f).sort({ occurredAt: -1 }).limit(Math.min(Number(q.limit) || 200, 1000)).lean();
}
module.exports = { record, addendum, list };
