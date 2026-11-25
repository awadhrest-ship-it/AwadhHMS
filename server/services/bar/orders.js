/**
 * Drink orders (Module 8.1).
 *   Open  -> Served : stock is deducted EXACTLY ONCE, when the order is served (core.consume with a stable per-order key).
 *   Open  -> Cancelled : nothing was deducted, so nothing is reversed.
 * Prices are resolved on the backend when lines are saved (normal price, or a configured active happy-hour rule). The client only sends what was ordered.
 * Billing is TBC (Q28 - separate bill / room bill / both): an order stays "Pending destination decision" and is NEVER posted to a bill or folio here.
 */
const { z } = require('zod');
const { BarOrder, BarMenuItem, Counter } = require('../../models');
const C = require('./core');
const P = require('./pricing');
const bottles = require('./bottles');
const { audit } = require('../audit');
const { barSettings } = require('../settings');
const U = require('../inventory/units');
const { ApiError, bad, notFound, conflict } = require('../../utils/ApiError');
const { parse } = require('../../utils/wrap');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const line = z.object({ menuItem: oid, serving: oid.optional(), measure: z.enum(['30 ml', '60 ml', 'Full bottle']).optional(), quantity: z.number().int().min(1).max(50), notes: z.string().max(120).optional() })
  .refine((l) => l.serving || l.measure, 'Choose a serving for every drink');
const createSchema = z.object({ lines: z.array(line).min(1).max(30), customerLabel: z.string().trim().max(60).optional(), roomNumber: z.string().trim().max(10).optional(), notes: z.string().max(300).optional(), serve: z.boolean().optional() });

async function buildLines(raw, settings, now = new Date()) {
  const menus = new Map((await BarMenuItem.find({ _id: { $in: raw.map((l) => l.menuItem) } })).map((m) => [String(m._id), m]));
  const ids = [...menus.values()].flatMap((m) => [m.stockItem, ...m.mixers.map((x) => x.item)]).filter(Boolean);
  const ctx = { items: await C.loadItems(ids), units: await U.loadUnits(), settings }; const out = [];
  for (const l of raw) {
    const m = menus.get(String(l.menuItem)); if (!m) throw bad('A drink on this order is not on the bar menu');
    if (!m.active || !m.available) throw bad(`${m.name} is not available right now`);
    const s = l.serving ? m.servings.id(l.serving) : m.servings.find((x) => x.measure === l.measure);
    if (!s || s.active === false) throw bad(`${m.name} is not sold as ${l.measure || 'that serving'}`);
    const plan = C.planServing(m, s, l.quantity, ctx);
    if (plan.status === 'Incomplete' && !settings.allowSalesWithoutConsumption) throw bad(`${m.name} (${s.measure}) cannot be sold yet: its stock consumption is not fully configured - ${plan.problems.join('; ')}`, { code: 'CONSUMPTION_INCOMPLETE', problems: plan.problems });
    const pr = P.priceFor(m, s, settings, now); const it = m.stockItem && ctx.items.get(String(m.stockItem)); const cap = it && C.capacityOf(it, ctx.units);
    out.push({ menuItem: m._id, name: m.name, category: m.category, serving: s._id, measure: s.measure, ml: s.measure === 'Full bottle' ? cap || undefined : s.ml, quantity: l.quantity, basePrice: pr.basePrice, unitPrice: pr.unitPrice, lineTotal: P.rup(pr.unitPrice * l.quantity),
      happyHour: pr.happyHour, consumptionStatus: plan.status, consumptionIncomplete: plan.status === 'Incomplete', notes: l.notes,
      consumption: plan.status === 'Incomplete' ? [] : plan.lines.map((x) => ({ item: x.item, itemName: x.itemName, baseQty: x.baseQty, unit: x.unit, from: x.from, role: x.role })) });
  }
  return out;
}
const totals = (lines) => { const subtotal = P.rup(lines.reduce((s, l) => s + l.lineTotal, 0)); return { subtotal, total: subtotal }; };

async function create(req, body, idempotencyKey) {
  const b = parse(createSchema, body); const key = `u:${req.user._id}:${idempotencyKey}`;
  const existing = await BarOrder.findOne({ idempotencyKey: key });
  if (existing) return { order: b.serve ? await serve(req, existing._id) : existing, replayed: true };
  const settings = await barSettings(); const shift = await C.myOpenShift(req, settings); const now = new Date();
  const lines = await buildLines(b.lines, settings, now);
  let order;
  try {
    order = await BarOrder.create({ orderNumber: await Counter.next('BAR', 4), idempotencyKey: key, lines, ...totals(lines), customerLabel: b.customerLabel, roomNumber: b.roomNumber, notes: b.notes,
      billing: { status: 'Pending destination decision', destination: null, note: 'Bar billing destination is not confirmed (separate bill / room bill / both) - nothing has been billed or posted' },
      shift: shift?._id, createdBy: req.user._id, createdByName: req.user.name, pricedAt: now });
  } catch (e) { if (C.isDup(e)) { const again = await BarOrder.findOne({ idempotencyKey: key }); if (again) return { order: again, replayed: true }; } throw e; }
  await audit(req, { action: 'create', module: 'Bar', entity: 'BarOrder', entityId: order._id, entityLabel: `${order.orderNumber} (${order.total})`, newValue: order });
  return { order: b.serve ? await serve(req, order._id) : order, replayed: false };
}
async function replaceLines(req, id, body) {
  const b = parse(z.object({ lines: z.array(line).min(1).max(30) }), body); const settings = await barSettings();
  const lines = await buildLines(b.lines, settings);
  const before = await BarOrder.findById(id); if (!before) throw notFound('Order not found');
  const upd = await BarOrder.findOneAndUpdate({ _id: id, status: 'Open' }, { $set: { lines, ...totals(lines), pricedAt: new Date() } }, { new: true });
  if (!upd) throw conflict(`Order ${before.orderNumber} is ${before.status.toLowerCase()} and can no longer be changed`);
  await audit(req, { action: 'update', module: 'Bar', entity: 'BarOrder', entityId: id, entityLabel: upd.orderNumber, oldValue: { lines: before.lines, total: before.total }, newValue: { lines: upd.lines, total: upd.total } });
  return upd;
}
/** Deduct stock (once) and mark the order Served. Safe to call repeatedly. */
async function serve(req, id) {
  const o = await BarOrder.findById(id); if (!o) throw notFound('Order not found');
  if (o.status === 'Served') return o;
  if (o.status === 'Cancelled') throw conflict(`Order ${o.orderNumber} was cancelled`);
  const settings = await barSettings(); await C.myOpenShift(req, settings);
  const lines = o.lines.filter((l) => !l.consumptionIncomplete).flatMap((l) => l.consumption.map((c) => ({ item: c.item, itemName: c.itemName, baseQty: c.baseQty, unit: c.unit, from: c.from })));
  const key = `bar-order:${o._id}:a${o.stockAttempt}`; let movement = null;
  try {
    if (lines.length) {
      if (settings.autoOpenBottles) await autoOpen(req, lines, key, settings);
      movement = await C.consume(req, { key, source: 'bar-sale', reason: `Bar sale ${o.orderNumber}`, reference: { model: 'BarOrder', id: o._id, label: o.orderNumber }, lines, kind: 'sale', ref: { model: 'BarOrder', id: o._id, label: o.orderNumber } });
    }
  } catch (e) {
    if (e instanceof ApiError && [400, 409].includes(e.status)) await BarOrder.updateOne({ _id: o._id, status: 'Open' }, { $inc: { stockAttempt: 1 }, $set: { stockError: e.message } });
    throw e;
  }
  const won = await BarOrder.findOneAndUpdate({ _id: o._id, status: 'Open' }, { $set: { status: 'Served', servedAt: new Date(), servedBy: req.user._id, servedByName: req.user.name, movement: movement?._id }, $unset: { stockError: 1 } }, { new: true });
  if (won) { await audit(req, { action: 'status', module: 'Bar', entity: 'BarOrder', entityId: o._id, entityLabel: `${o.orderNumber} served`, newValue: { status: 'Served', total: won.total, movement: movement?.movementNumber } }); return won; }
  return BarOrder.findById(o._id);
}
async function autoOpen(req, lines, key, settings) {
  const need = new Map(); for (const l of C.mergeLines(lines).filter((x) => x.from === 'open')) need.set(String(l.item), l);
  const items = await C.loadItems([...need.keys()]); const units = await U.loadUnits(); const st = await C.stateOf([...need.keys()], settings.department);
  for (const [id, l] of need) {
    const cap = C.capacityOf(items.get(id), units); const open = st.get(id).openQ; const q = U.toQ(l.baseQty);
    if (!cap || open >= q) continue;
    const bottlesNeeded = Math.ceil((q - open) / U.toQ(cap));
    await bottles.open(req, { item: id, bottles: bottlesNeeded, source: 'auto', idempotencyKey: `${key}:auto:${id}`.slice(0, 80), notes: 'Opened automatically for a drink order' });
  }
}
async function cancel(req, id, reason) {
  if (!reason || String(reason).trim().length < 3) throw bad('Enter a reason for cancelling');
  const o = await BarOrder.findById(id); if (!o) throw notFound('Order not found');
  const upd = await BarOrder.findOneAndUpdate({ _id: id, status: 'Open' }, { $set: { status: 'Cancelled', cancelledAt: new Date(), cancelledBy: req.user._id, cancelReason: String(reason).trim() } }, { new: true });
  if (!upd) throw conflict(`Order ${o.orderNumber} is ${o.status.toLowerCase()}${o.status === 'Served' ? ' - stock was already used. Correct it with a stock adjustment (needs approval).' : ''}`);
  await audit(req, { action: 'status', module: 'Bar', entity: 'BarOrder', entityId: id, entityLabel: `${o.orderNumber} cancelled`, newValue: { reason } });
  return upd;
}
const range = (f, field, q) => { if (q.from || q.to) { f[field] = {}; if (q.from) f[field].$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f[field].$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); } };
async function list(q = {}) {
  const f = {}; if (q.status) f.status = q.status; if (q.user) f.createdBy = q.user; if (q.shift) f.shift = q.shift; range(f, 'createdAt', q);
  return BarOrder.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(q.limit) || 100, 500)).lean();
}
async function get(id) { const o = await BarOrder.findById(id).lean(); if (!o) throw notFound('Order not found'); return o; }
module.exports = { create, replaceLines, serve, cancel, list, get, buildLines, range };
