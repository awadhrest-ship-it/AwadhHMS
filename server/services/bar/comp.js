/**
 * Complimentary drinks (Module 8.4) - an approval-gated control built on the common approval framework (type "Complimentary drinks").
 *   request (Pending Approval)  -> GM / Owner approves (Approved) or rejects (Rejected) -> bar issues (Issuing -> Issued, stock deducted ONCE).
 * Pending and rejected requests never touch stock. There is no endpoint that records a complimentary drink without a request, and an Approved request can be issued only once.
 */
const { z } = require('zod');
const { BarComplimentary, BarMenuItem, Counter } = require('../../models');
const C = require('./core');
const P = require('./pricing');
const approvals = require('../approvals');
const { audit } = require('../audit');
const { barSettings } = require('../settings');
const U = require('../inventory/units');
const { ApiError, bad, notFound, conflict } = require('../../utils/ApiError');
const { parse } = require('../../utils/wrap');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const schema = z.object({ menuItem: oid, serving: oid.optional(), measure: z.enum(['30 ml', '60 ml', 'Full bottle']).optional(), quantity: z.number().int().min(1).max(50), reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300) })
  .refine((x) => x.serving || x.measure, 'Choose a serving');

async function planFor(menuId, servingId, measure, qty) {
  const settings = await barSettings(); const m = await BarMenuItem.findById(menuId); if (!m || !m.active) throw bad('Drink not found on the bar menu');
  const s = servingId ? m.servings.id(servingId) : m.servings.find((x) => x.measure === measure); if (!s || s.active === false) throw bad(`${m.name} is not served as that measure`);
  const ids = [m.stockItem, ...m.mixers.map((x) => x.item)].filter(Boolean); const ctx = { items: await C.loadItems(ids), units: await U.loadUnits(), settings };
  return { m, s, settings, plan: C.planServing(m, s, qty, ctx) };
}
async function request(req, body, idempotencyKey) {
  const b = parse(schema, body); const key = `u:${req.user._id}:${idempotencyKey}`;
  const existing = await BarComplimentary.findOne({ idempotencyKey: key }); if (existing) return { request: existing, replayed: true };
  const { m, s, settings, plan } = await planFor(b.menuItem, b.serving, b.measure, b.quantity);
  if (plan.status === 'Incomplete' && !settings.allowSalesWithoutConsumption) throw bad(`${m.name} (${s.measure}) cannot be given yet: its stock consumption is not fully configured - ${plan.problems.join('; ')}`);
  const shift = await C.myOpenShift(req, settings);
  let rec;
  try {
    rec = await BarComplimentary.create({ requestNumber: await Counter.next('BCM', 4), idempotencyKey: key, menuItem: m._id, itemName: m.name, serving: s._id, measure: s.measure, quantity: b.quantity,
      listValue: P.rup(s.price * b.quantity), reason: b.reason, requestedBy: req.user._id, requestedByName: req.user.name, shift: shift?._id });
  } catch (e) { if (C.isDup(e)) { const again = await BarComplimentary.findOne({ idempotencyKey: key }); if (again) return { request: again, replayed: true }; } throw e; }
  try {
    const ar = await approvals.createRequest(req, { type: 'Complimentary drinks', referenceModel: 'BarComplimentary', referenceId: rec._id, referenceLabel: `${rec.requestNumber} · ${b.quantity} x ${m.name} (${s.measure})`, amount: rec.listValue, payload: { requestId: String(rec._id) }, comments: b.reason });
    rec.approval = ar._id; await rec.save();
  } catch (e) { await BarComplimentary.deleteOne({ _id: rec._id, status: 'Pending Approval', approval: { $exists: false } }); throw e; }
  await audit(req, { action: 'create', module: 'Bar', entity: 'BarComplimentary', entityId: rec._id, entityLabel: `${rec.requestNumber} complimentary request`, newValue: rec, note: b.reason });
  return { request: rec, replayed: false };
}
/* approval framework callbacks (registered in approvalHandlers.js) */
async function onApproved(ar, req) {
  const upd = await BarComplimentary.findOneAndUpdate({ _id: ar.referenceId, status: 'Pending Approval' }, { $set: { status: 'Approved', decidedBy: req.user._id, decidedAt: new Date(), approval: ar._id } }, { new: true });
  if (!upd) throw conflict('This complimentary request is no longer waiting for approval');
  await audit(req, { action: 'approve', module: 'Bar', entity: 'BarComplimentary', entityId: upd._id, entityLabel: `${upd.requestNumber} approved`, newValue: { status: 'Approved' } });
}
async function onRejected(ar, req) {
  const reason = req.body?.reason || req.body?.comments || 'Rejected';
  const upd = await BarComplimentary.findOneAndUpdate({ _id: ar.referenceId, status: 'Pending Approval' }, { $set: { status: 'Rejected', decidedBy: req.user._id, decidedAt: new Date(), decisionReason: reason } }, { new: true });
  if (upd) await audit(req, { action: 'reject', module: 'Bar', entity: 'BarComplimentary', entityId: upd._id, entityLabel: `${upd.requestNumber} rejected`, newValue: { status: 'Rejected' }, note: reason });
}
/** Issue an approved drink: stock is deducted exactly once. Safe to call repeatedly / concurrently. */
async function issue(req, id) {
  const r = await BarComplimentary.findById(id); if (!r) throw notFound('Complimentary request not found');
  if (r.status === 'Issued') return { request: r, replayed: true };
  if (!['Approved', 'Issuing'].includes(r.status)) throw bad(`${r.requestNumber} is ${r.status.toLowerCase()} - only an approved request can be issued`);
  const settings = await barSettings(); const shift = await C.myOpenShift(req, settings);
  await BarComplimentary.updateOne({ _id: id, status: 'Approved' }, { $set: { status: 'Issuing' } });
  const { m, s, plan } = await planFor(r.menuItem, r.serving, r.measure, r.quantity);
  const lines = plan.status === 'Incomplete' ? [] : plan.lines;
  if (plan.status === 'Incomplete' && !settings.allowSalesWithoutConsumption) { await BarComplimentary.updateOne({ _id: id, status: 'Issuing' }, { $set: { status: 'Approved', issueError: plan.problems.join('; ') } }); throw bad(`${m.name} cannot be issued: ${plan.problems.join('; ')}`); }
  const key = `bar-comp:${r._id}:a${r.attempt}`; let movement = null;
  try {
    if (lines.length) movement = await C.consume(req, { key, source: 'bar-comp', reason: `Complimentary ${r.requestNumber}`, reference: { model: 'BarComplimentary', id: r._id, label: r.requestNumber }, lines, kind: 'complimentary', ref: { model: 'BarComplimentary', id: r._id, label: r.requestNumber } });
  } catch (e) {
    if (e instanceof ApiError && [400, 409].includes(e.status)) await BarComplimentary.updateOne({ _id: id, status: 'Issuing' }, { $set: { status: 'Approved', issueError: e.message }, $inc: { attempt: 1 } });
    throw e;
  }
  const won = await BarComplimentary.findOneAndUpdate({ _id: id, status: 'Issuing' }, { $set: { status: 'Issued', issuedAt: new Date(), issuedBy: req.user._id, issuedByName: req.user.name, movement: movement?._id, shift: r.shift || shift?._id,
    consumption: lines.map((x) => ({ item: x.item, itemName: x.itemName, baseQty: x.baseQty, unit: x.unit, from: x.from, role: x.role })), consumptionIncomplete: plan.status === 'Incomplete' }, $unset: { issueError: 1 } }, { new: true });
  if (won) { await audit(req, { action: 'status', module: 'Bar', entity: 'BarComplimentary', entityId: id, entityLabel: `${r.requestNumber} issued`, newValue: { status: 'Issued', movement: movement?.movementNumber } }); return { request: won, replayed: false }; }
  return { request: await BarComplimentary.findById(id), replayed: true };
}
async function cancel(req, id) {
  const r = await BarComplimentary.findById(id); if (!r) throw notFound('Complimentary request not found');
  if (String(r.requestedBy) !== String(req.user._id) && !req.permissions.has('bar.variance.adjust') && !req.permissions.has('approvals.approve')) throw bad('Only the requester or a manager can withdraw a request');
  const upd = await BarComplimentary.findOneAndUpdate({ _id: id, status: { $in: ['Pending Approval', 'Approved'] } }, { $set: { status: 'Cancelled', decisionReason: 'Withdrawn' } }, { new: true });
  if (!upd) throw conflict(`${r.requestNumber} is ${r.status.toLowerCase()} and cannot be withdrawn`);
  if (r.status === 'Pending Approval' && r.approval) { const { ApprovalRequest } = require('../../models'); await ApprovalRequest.updateOne({ _id: r.approval, status: 'Pending' }, { $set: { status: 'Rejected', rejectionReason: 'Request withdrawn by the bar', approvedAt: new Date() } }); }
  await audit(req, { action: 'status', module: 'Bar', entity: 'BarComplimentary', entityId: id, entityLabel: `${r.requestNumber} withdrawn`, newValue: { status: 'Cancelled' } });
  return upd;
}
async function list(q = {}) {
  const f = {}; if (q.status) f.status = q.status; if (q.user) f.requestedBy = q.user;
  if (q.from || q.to) { f.createdAt = {}; if (q.from) f.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.createdAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); }
  return BarComplimentary.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(q.limit) || 100, 500)).populate('approval', 'requestNumber status approver').lean();
}
module.exports = { request, onApproved, onRejected, issue, cancel, list };
