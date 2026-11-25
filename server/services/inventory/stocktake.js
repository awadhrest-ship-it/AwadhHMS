/**
 * Physical-stock verification (Module 4.3). Count -> compare with the system balance snapshot -> record discrepancies ->
 * request an adjustment through the approval framework. Nothing here changes stock directly: corrections are posted as
 * 'Adjustment' movements only after an approver says yes, with the variance (counted - system at count start) applied as a delta.
 */
const { Stocktake, StockMovement, InventoryItem, StockBalance, InventoryCategory, Counter, ApprovalRequest } = require('../../models');
const approvals = require('../approvals');
const { audit } = require('../audit');
const { notify } = require('../notify');
const stock = require('./stock');
const { scope, assertDepartment } = require('./access');
const U = require('./units');
const { bad, conflict, notFound } = require('../../utils/ApiError');

const OPEN_VARIANCE = ['Variance', 'Adjustment Requested', 'Rejected'];
const load = async (id) => { const s = await Stocktake.findById(id); if (!s) throw notFound('Stocktake not found'); return s; };
async function guard(req, s) { await assertDepartment(req, s.department); return s; }

async function start(req, { department, category, notes }) {
  await assertDepartment(req, department);
  const open = await Stocktake.findOne({ department, status: 'Counting' });
  if (open) throw conflict(`${open.stocktakeNumber} is already being counted for ${department}. Submit or cancel it first.`);
  const itemF = { active: true }; if (category) { if (!(await InventoryCategory.exists({ _id: category }))) throw bad('Category not found'); itemF.category = category; }
  const items = await InventoryItem.find(itemF).sort({ name: 1 }).lean();
  const lots = await StockBalance.find({ department, qtyQ: { $gt: 0 } }).lean();
  const sys = new Map(); for (const l of lots) sys.set(String(l.item), (sys.get(String(l.item)) || 0) + l.qtyQ);
  const lines = items.filter((i) => sys.has(String(i._id)) || (i.minLevels || []).some((m) => m.department === department))
    .map((i) => ({ item: i._id, sku: i.sku, itemName: i.name, baseUnit: i.baseUnit, systemQty: U.fromQ(sys.get(String(i._id)) || 0) }));
  if (!lines.length) throw bad(`No stocked items found for ${department}${category ? ' in that category' : ''}`);
  const st = await Stocktake.create({ stocktakeNumber: await Counter.next('STT', 4), department, category: category || undefined, lines, notes, startedBy: req.user._id });
  await audit(req, { action: 'create', module: 'Inventory', entity: 'Stocktake', entityId: st._id, entityLabel: `${st.stocktakeNumber} ${department}`, newValue: { department, lines: lines.length } });
  return st;
}

async function addLine(req, id, itemId) {
  const st = await guard(req, await load(id));
  if (st.status !== 'Counting') throw bad('Items can only be added while counting');
  if (st.lines.some((l) => String(l.item) === String(itemId))) throw bad('That item is already on the count sheet');
  const item = await InventoryItem.findById(itemId); if (!item || !item.active) throw bad('Item not found');
  st.lines.push({ item: item._id, sku: item.sku, itemName: item.name, baseUnit: item.baseUnit, systemQty: await stock.onHand(item._id, st.department) });
  await st.save(); return st;
}

async function saveCounts(req, id, counts) {
  const st = await guard(req, await load(id));
  if (st.status !== 'Counting') throw bad('This stocktake is no longer being counted');
  const units = await U.loadUnits();
  for (const c of counts) {
    const line = st.lines.id(c.lineId); if (!line) throw bad('Unknown line');
    if (c.quantity === null || c.quantity === '' || c.quantity === undefined) { line.countedQty = null; line.variance = 0; line.status = 'Not Counted'; continue; }
    const item = await InventoryItem.findById(line.item).lean();
    const qty = Number(c.quantity); if (!Number.isFinite(qty) || qty < 0) throw bad(`${line.itemName}: counted quantity must be zero or more`);
    const base = qty === 0 ? 0 : U.toBase(item, qty, c.unit || item.baseUnit, units).baseQty;
    line.countedQty = base; line.variance = U.round6(base - line.systemQty); line.status = Math.abs(line.variance) < 1e-6 ? 'Matched' : 'Variance';
    if (c.note !== undefined) line.note = c.note;
  }
  await st.save(); return st;
}

async function submit(req, id) {
  const st = await guard(req, await load(id));
  if (st.status !== 'Counting') throw bad('This stocktake was already submitted');
  const counted = st.lines.filter((l) => l.countedQty != null);
  if (!counted.length) throw bad('Count at least one item before submitting');
  st.lines = st.lines.filter((l) => l.countedQty != null);       // uncounted items are not part of this verification
  st.status = 'Submitted'; st.submittedBy = req.user._id; st.submittedAt = new Date();
  const variances = st.lines.filter((l) => l.status === 'Variance');
  if (!variances.length) { st.status = 'Resolved'; st.resolvedAt = new Date(); }
  await st.save();
  await audit(req, { action: 'status', module: 'Inventory', entity: 'Stocktake', entityId: st._id, entityLabel: `${st.stocktakeNumber} submitted`, newValue: { counted: st.lines.length, discrepancies: variances.map((l) => ({ item: l.itemName, system: l.systemQty, counted: l.countedQty, variance: l.variance, unit: l.baseUnit })) } });
  if (variances.length) await notify({ type: 'stocktake', title: `Stock discrepancies: ${st.stocktakeNumber}`, message: `${st.department}: ${variances.length} item(s) differ from the system`, link: '/inventory/stocktake', severity: 'warning', permission: 'inventory.adjust' });
  return st;
}

async function resolveIfDone(st) {
  if (st.status === 'Submitted' && !st.lines.some((l) => OPEN_VARIANCE.includes(l.status))) { st.status = 'Resolved'; st.resolvedAt = new Date(); }
}

async function explain(req, id, lineId, note) {
  const st = await guard(req, await load(id));
  if (st.status !== 'Submitted') throw bad('Only a submitted stocktake can be reviewed');
  const line = st.lines.id(lineId); if (!line || !['Variance', 'Rejected'].includes(line.status)) throw bad('That line has no open discrepancy');
  if (!note || note.trim().length < 3) throw bad('Explain why no adjustment is needed');
  line.status = 'Explained'; line.resolutionNote = note.trim(); await resolveIfDone(st); await st.save();
  await audit(req, { action: 'update', module: 'Inventory', entity: 'Stocktake', entityId: st._id, entityLabel: `${st.stocktakeNumber} ${line.itemName}`, newValue: { status: 'Explained', variance: line.variance }, note });
  return st;
}

async function requestAdjustment(req, id, { lineIds, reason }) {
  const st = await guard(req, await load(id));
  if (st.status !== 'Submitted') throw bad('Only a submitted stocktake can be adjusted');
  const chosen = st.lines.filter((l) => (lineIds?.length ? lineIds.includes(String(l._id)) : true) && ['Variance', 'Rejected'].includes(l.status));
  if (!chosen.length) throw bad('There are no open discrepancies to adjust');
  const prices = await InventoryItem.find({ _id: { $in: chosen.map((l) => l.item) } }).select('lastPurchase').lean();
  const pm = new Map(prices.map((p) => [String(p._id), p.lastPurchase?.pricePerBase || 0]));
  const amount = Math.round(chosen.reduce((s, l) => s + Math.abs(l.variance) * (pm.get(String(l.item)) || 0), 0) * 100) / 100;
  const ar = await approvals.createRequest(req, { type: 'Stock adjustment', referenceModel: 'Stocktake', referenceId: st._id, referenceLabel: `${st.stocktakeNumber} · ${st.department} · ${chosen.length} item(s)`, amount,
    payload: { stocktakeId: String(st._id), lineIds: chosen.map((l) => String(l._id)) }, comments: reason || 'Stocktake discrepancy' });
  chosen.forEach((l) => { l.status = 'Adjustment Requested'; }); st.approval = ar._id; await st.save();
  return { stocktake: st, approval: ar };
}

/** Approval handler: post one Adjustment per requested line, exactly once (idempotency key per line). */
async function applyApproved(ar, req) {
  const st = await Stocktake.findById(ar.payload?.stocktakeId || ar.referenceId); if (!st) throw notFound('Stocktake no longer exists');
  for (const lid of ar.payload?.lineIds || []) {
    const line = st.lines.id(lid); if (!line || line.status === 'Adjusted') continue;
    const { movement } = await stock.postMovement(req, { type: 'Adjustment', rawKey: true, idempotencyKey: `stocktake:${st._id}:${lid}`, trusted: true, source: 'stocktake',
      reason: `Stocktake ${st.stocktakeNumber}: counted ${line.countedQty}, system ${line.systemQty}`, reference: { model: 'Stocktake', id: st._id, label: st.stocktakeNumber },
      lines: [{ item: line.item, quantity: Math.abs(line.variance), unit: line.baseUnit, direction: line.variance > 0 ? 'increase' : 'decrease', department: st.department }] });
    if (movement.approvalStatus !== 'Approved') { movement.approvalStatus = 'Approved'; movement.approval = ar._id; movement.decidedBy = req.user._id; movement.decidedAt = new Date(); await movement.save(); }
    line.status = 'Adjusted'; line.adjustmentMovement = movement._id; await st.save();
  }
  await resolveIfDone(st); await st.save();
}
async function onRejected(ar) {
  const st = await Stocktake.findById(ar.referenceId); if (!st) return;
  for (const lid of ar.payload?.lineIds || []) { const l = st.lines.id(lid); if (l && l.status === 'Adjustment Requested') l.status = 'Rejected'; }
  await st.save();
}

async function cancel(req, id) {
  const st = await guard(req, await load(id));
  if (st.status !== 'Counting') throw bad('Only a stocktake that is still being counted can be cancelled');
  st.status = 'Cancelled'; await st.save();
  await audit(req, { action: 'delete', module: 'Inventory', entity: 'Stocktake', entityId: st._id, entityLabel: `${st.stocktakeNumber} cancelled` });
  return st;
}

async function list(req, q) {
  const sc = await scope(req); const f = {};
  if (!sc.all) f.department = { $in: sc.departments };
  if (q.department) f.department = sc.all || sc.departments.includes(q.department) ? q.department : '__none__';
  if (q.status) f.status = q.status;
  return Stocktake.find(f).sort({ createdAt: -1 }).limit(100).lean();
}
async function get(req, id) { const s = await guard(req, await load(id)); return s; }

module.exports = { start, addLine, saveCounts, submit, explain, requestAdjustment, applyApproved, onRejected, cancel, list, get };
