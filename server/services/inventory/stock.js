/**
 * Stock movement engine - the ONLY code that changes stock balances.
 *
 * Integrity model (no MongoDB transactions required, so it behaves identically on a standalone server or a replica set):
 *  1. Every request carries an idempotency key. The StockMovement row is inserted first (unique key) in status Pending with a
 *     fully planned list of operations (FEFO lot allocation for outgoing stock).
 *  2. Each operation is ONE atomic single-document update on a StockBalance row. The update's filter contains the quantity
 *     guard (qtyQ >= amount, so stock can never go negative) and "this operation key has not been applied yet"; its update
 *     increments the quantity and writes the operation key in the same step. A retried or replayed operation therefore
 *     matches nothing and is reported as "already applied" - stock is changed exactly once.
 *  3. Decrements run before increments. If a decrement loses a race (stock was used meanwhile) the decrements already applied
 *     are reversed (also idempotently) and the movement is marked Failed with nothing changed.
 *  4. A crash between steps leaves the movement Pending; resumePending() (run on start-up and on any retry with the same key)
 *     rolls it forward - every step is idempotent. Ledger rows are written with unique keys for the same reason.
 *  5. reconcile() re-derives every balance from the ledger so drift (if it ever happened) is detectable.
 */
const crypto = require('crypto');
const { StockBalance, StockMovement, StockLedger, InventoryItem, PriceHistory, Counter } = require('../../models');
const { audit } = require('../audit');
const { inventorySettings } = require('../settings');
const { scope, assertDepartment } = require('./access');
const U = require('./units');
const { ApiError, bad, conflict, notFound } = require('../../utils/ApiError');
const { today } = require('../../utils/dates');

const INCOMING = ['Stock In', 'Opening Stock'];
const OUTGOING = ['Stock Out', 'Wastage', 'Breakage', 'Damaged', 'Consumption'];
const NEEDS_REASON = ['Stock Out', 'Wastage', 'Breakage', 'Damaged', 'Adjustment'];
const OPS_RETENTION_MS = 30 * 864e5;

const dateKey = (d) => new Date(d).toISOString().slice(0, 10);
const lotKeyFor = ({ lotNo, expiryDate }) => {
  const b = String(lotNo || '').trim().toUpperCase().replace(/[.$]/g, '~');   // lotKey is embedded in dotted update paths (ops.<id>): it must never contain '.' or '$'
  if (!b && !expiryDate) return 'DEFAULT';
  return `${expiryDate ? dateKey(expiryDate) : 'NOEXP'}|${b}`;
};
const hotelDate = (v) => { const s = String(v).slice(0, 10); const d = new Date(`${s}T00:00:00.000Z`); if (Number.isNaN(d.getTime())) throw bad(`Invalid date: ${v}`); return d; };

/* ------------------------------------------------------------------ normalisation */
async function loadContext(rawLines) {
  const ids = [...new Set(rawLines.map((l) => String(l.item)))];
  if (ids.some((i) => !/^[a-f0-9]{24}$/i.test(i))) throw bad('Invalid item');
  const items = new Map((await InventoryItem.find({ _id: { $in: ids } }).lean()).map((i) => [String(i._id), i]));
  return { items, units: await U.loadUnits(), settings: await inventorySettings() };
}

async function normalizeLines(req, spec, ctx, sc) {
  const { type } = spec;
  const out = [];
  for (const [i, raw] of spec.lines.entries()) {
    const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof ApiError) e.message = `Line ${i + 1}: ${e.message}`; throw e; } };
    const item = ctx.items.get(String(raw.item));
    if (!item) throw bad(`Line ${i + 1}: item not found`);
    if (!item.active) throw bad(`Line ${i + 1}: ${item.name} is inactive`);
    const incoming = INCOMING.includes(type) || (type === 'Adjustment' && raw.direction === 'increase');
    const unit = (raw.unit || (incoming ? item.purchaseUnit : item.usageUnit) || item.baseUnit).toLowerCase();
    const { baseQty } = wrap(() => U.toBase(item, raw.quantity, unit, ctx.units));
    const line = { item: item._id, sku: item.sku, itemName: item.name, quantity: Number(raw.quantity), unit, baseQty, baseUnit: item.baseUnit };

    const stockDepts = ctx.settings.stockDepartments;
    const needDept = (d, label) => { if (!d || !stockDepts.includes(d)) throw bad(`Line ${i + 1}: choose a valid ${label} department`); return d; };
    const access = async (d) => { if (!spec.trusted) await assertDepartment(req, d, sc); };
    if (INCOMING.includes(type)) {
      line.toDepartment = needDept(raw.toDepartment, 'destination'); await access(line.toDepartment);
    } else if (type === 'Transfer') {
      line.fromDepartment = needDept(raw.fromDepartment, 'source'); line.toDepartment = needDept(raw.toDepartment, 'destination');
      if (line.fromDepartment === line.toDepartment) throw bad(`Line ${i + 1}: source and destination must be different`);
      await access(line.fromDepartment);
    } else if (type === 'Adjustment') {
      if (!['increase', 'decrease'].includes(raw.direction)) throw bad(`Line ${i + 1}: choose increase or decrease`);
      line.direction = raw.direction;
      const dept = needDept(raw.department || raw.toDepartment || raw.fromDepartment, 'stock'); await access(dept);
      if (raw.direction === 'increase') line.toDepartment = dept; else line.fromDepartment = dept;
    } else {
      line.fromDepartment = needDept(raw.fromDepartment, 'stock'); await access(line.fromDepartment);
    }
    if (raw.lotId) line.lotId = raw.lotId;
    // expiry / batch (incoming stock only)
    if (incoming) {
      if (raw.expiryDate) { line.expiryDate = hotelDate(raw.expiryDate); if (line.expiryDate < today() && type !== 'Opening Stock') throw bad(`Line ${i + 1}: ${item.name} is already past its expiry date`); }
      else if (item.trackExpiry && !spec.trusted) throw bad(`Line ${i + 1}: ${item.name} is expiry-tracked - enter its expiry date`);
      if (raw.lotNo) { line.lotNo = String(raw.lotNo).trim().slice(0, 40); if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#-]*$/.test(line.lotNo)) throw bad(`Line ${i + 1}: batch number may only contain letters, numbers and . _ / # -`); }
      if (raw.unitPrice != null && raw.unitPrice !== '') {
        const p = Number(raw.unitPrice); if (!Number.isFinite(p) || p < 0) throw bad(`Line ${i + 1}: price must be zero or more`);
        line.unitPrice = p; line.unitCost = p / U.factorToBase(item, unit, ctx.units);
        if (raw.supplier) line.supplier = String(raw.supplier).slice(0, 80);
      }
    }
    out.push(line);
  }
  return out;
}

/* ------------------------------------------------------------------ planning (FEFO) */
const expiryRank = (l) => (l.expiryDate ? new Date(l.expiryDate).getTime() : Infinity);
async function planDecrease({ item, department, needQ, lotId, taken, itemName, baseUnit }) {
  let lots = await StockBalance.find({ item, department, qtyQ: { $gt: 0 } }).lean();
  if (lotId) lots = lots.filter((l) => String(l._id) === String(lotId));
  lots.sort((a, b) => expiryRank(a) - expiryRank(b) || new Date(a.receivedAt) - new Date(b.receivedAt));
  const picks = []; let left = needQ, available = 0;
  for (const l of lots) {
    const free = l.qtyQ - (taken.get(String(l._id)) || 0); if (free <= 0) continue; available += free;
    if (left <= 0) continue;
    const take = Math.min(free, left); picks.push({ lot: l, take }); left -= take; taken.set(String(l._id), (taken.get(String(l._id)) || 0) + take);
  }
  if (left > 0) throw conflict(`Insufficient stock: ${itemName} has ${U.fromQ(available)} ${baseUnit} in ${department}, ${U.fromQ(needQ)} ${baseUnit} requested`, { item: String(item), department, available: U.fromQ(available), requested: U.fromQ(needQ), unit: baseUnit });
  return picks;
}

/** Build the ordered operation list for a movement (reads current balances; does not change them). */
async function planOps(movement) {
  const ops = []; const taken = new Map(); const id = `${movement._id}-a${movement.attempt || 0}`;
  for (const [i, l] of movement.lines.entries()) {
    const needQ = U.toQ(l.baseQty);
    const incoming = INCOMING.includes(movement.type) || (movement.type === 'Adjustment' && l.direction === 'increase');
    if (incoming) {
      const lotKey = lotKeyFor(l);
      ops.push({ key: `${id}:${i}:in:${lotKey}`, kind: 'inc', lineNo: i, side: 'in', item: l.item, department: l.toDepartment, lotKey, lotNo: l.lotNo, expiryDate: l.expiryDate, unitCost: l.unitCost, qtyQ: needQ });
      continue;
    }
    const picks = await planDecrease({ item: l.item, department: l.fromDepartment, needQ, lotId: l.lotId, taken, itemName: l.itemName, baseUnit: l.baseUnit });
    for (const p of picks) {
      ops.push({ key: `${id}:${i}:out:${p.lot.lotKey}`, kind: 'dec', lineNo: i, side: 'out', item: l.item, department: l.fromDepartment, balance: p.lot._id, lotKey: p.lot.lotKey, lotNo: p.lot.lotNo, expiryDate: p.lot.expiryDate, qtyQ: p.take });
      if (movement.type === 'Transfer') ops.push({ key: `${id}:${i}:in:${p.lot.lotKey}`, kind: 'inc', lineNo: i, side: 'in', item: l.item, department: l.toDepartment, lotKey: p.lot.lotKey, lotNo: p.lot.lotNo, expiryDate: p.lot.expiryDate, unitCost: p.lot.unitCost, qtyQ: p.take });
    }
  }
  return ops;
}

/* ------------------------------------------------------------------ atomic single-op application */
const markerPath = (key) => `ops.${key.replace(/\./g, '_')}`;
const isDup = (e) => e && (e.code === 11000 || /E11000|duplicate key/i.test(e.message || ''));

async function maybePrune(doc) {
  const keys = Object.keys(doc?.ops || {});
  if (keys.length < 400) return;
  const cutoff = Date.now() - OPS_RETENTION_MS; const unset = {};
  for (const k of keys) if (doc.ops[k] < cutoff) unset[`ops.${k}`] = '';
  if (Object.keys(unset).length) await StockBalance.updateOne({ _id: doc._id }, { $unset: unset });
}

/** Returns { applied, already, afterQ }. Throws 409 when a decrement would make stock negative. */
async function applyOp(op, { reverse = false } = {}) {
  const key = reverse ? `${op.key}:rv` : op.key;
  const marker = markerPath(key); const now = Date.now();
  const kind = reverse ? (op.kind === 'dec' ? 'inc' : 'dec') : op.kind;
  if (kind === 'dec') {
    const filter = op.balance ? { _id: op.balance } : { item: op.item, department: op.department, lotKey: op.lotKey };
    const r = await StockBalance.findOneAndUpdate({ ...filter, qtyQ: { $gte: op.qtyQ }, [marker]: { $exists: false } }, { $inc: { qtyQ: -op.qtyQ }, $set: { [marker]: now } }, { new: true }).lean();
    if (r) { await maybePrune(r); return { applied: true, afterQ: r.qtyQ }; }
    const cur = await StockBalance.findOne(filter).lean();
    if (cur?.ops && cur.ops[key.replace(/\./g, '_')]) return { applied: false, already: true, afterQ: cur.qtyQ };
    throw conflict('Stock levels changed while saving. Please review the quantities and try again.');
  }
  // increment: find-or-create the lot row
  const filter = { item: op.item, department: op.department, lotKey: op.lotKey };
  const set = { [marker]: now }; if (op.unitCost > 0) set.unitCost = op.unitCost;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await StockBalance.findOneAndUpdate({ ...filter, [marker]: { $exists: false } },
        { $inc: { qtyQ: op.qtyQ }, $set: set, $setOnInsert: { lotNo: op.lotNo, expiryDate: op.expiryDate || null, receivedAt: new Date() } }, { new: true, upsert: true, setDefaultsOnInsert: false }).lean();
      await maybePrune(r); return { applied: true, afterQ: r.qtyQ };
    } catch (e) {
      if (!isDup(e)) throw e;
      const cur = await StockBalance.findOne(filter).lean();      // either already applied, or a concurrent creator won the insert race
      if (cur?.ops && cur.ops[key.replace(/\./g, '_')]) return { applied: false, already: true, afterQ: cur.qtyQ };
    }
  }
  throw conflict('Could not update stock - please retry');
}

async function rollback(movement) {
  for (let i = movement.ops.length - 1; i >= 0; i -= 1) {
    const op = movement.ops[i];
    if (op.applied && op.kind === 'dec') { await applyOp(op, { reverse: true }); op.applied = false; await StockMovement.updateOne({ _id: movement._id }, { $set: { [`ops.${i}.applied`]: false } }); }
  }
}

/* ------------------------------------------------------------------ finalise: apply -> ledger -> prices -> Posted */
async function finalize(req, movement, { notifyAlerts = true } = {}) {
  const ordered = [...movement.ops.keys()].sort((a, b) => (movement.ops[a].kind === movement.ops[b].kind ? a - b : movement.ops[a].kind === 'dec' ? -1 : 1));
  for (const idx of ordered) {
    const op = movement.ops[idx];
    if (!op.applied) {
      try {
        const r = await applyOp(op); op.applied = true; op.afterQ = r.afterQ;
        // atomic progress marker (never a whole-document save: concurrent retries of the same movement must not clash on versioning)
        await StockMovement.updateOne({ _id: movement._id }, { $set: { [`ops.${idx}.applied`]: true, [`ops.${idx}.afterQ`]: r.afterQ } });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await rollback(movement);
          movement.status = 'Failed'; movement.failureReason = e.message;
          await StockMovement.updateOne({ _id: movement._id, status: { $ne: 'Posted' } }, { $set: { status: 'Failed', failureReason: e.message } });
        }
        throw e;
      }
    }
  }
  const at = new Date();
  for (const op of movement.ops) {
    const line = movement.lines[op.lineNo];
    const counterpart = movement.type === 'Transfer' ? (op.side === 'out' ? line.toDepartment : line.fromDepartment) : undefined;
    const row = { movement: movement._id, movementNumber: movement.movementNumber, type: movement.type, lineNo: op.lineNo, side: op.side, item: op.item, department: op.department,
      counterpartDepartment: counterpart, lotKey: op.lotKey, lotNo: op.lotNo, expiryDate: op.expiryDate, deltaQ: op.kind === 'dec' ? -op.qtyQ : op.qtyQ, afterQ: op.afterQ,
      enteredQuantity: line.quantity, enteredUnit: line.unit, reason: movement.reason, performedBy: movement.performedBy, performedByName: movement.performedByName, at };
    try { await StockLedger.updateOne({ opKey: op.key }, { $setOnInsert: row }, { upsert: true }); } catch (e) { if (!isDup(e)) throw e; }
  }
  if (movement.type === 'Stock In') {
    for (const [i, l] of movement.lines.entries()) {
      if (l.unitPrice == null) continue;
      const row = { item: l.item, unitPrice: l.unitPrice, unit: l.unit, pricePerBase: l.unitCost, quantity: l.quantity, supplier: l.supplier, reference: { model: 'StockMovement', id: movement._id, label: movement.movementNumber }, date: at, recordedBy: movement.performedBy };
      try { await PriceHistory.updateOne({ entryKey: `${movement._id}:${i}` }, { $setOnInsert: row }, { upsert: true }); } catch (e) { if (!isDup(e)) throw e; }
      await InventoryItem.updateOne({ _id: l.item }, { $set: { lastPurchase: { unitPrice: l.unitPrice, unit: l.unit, pricePerBase: l.unitCost, date: at, supplier: l.supplier, reference: movement.movementNumber } } });
    }
  }
  // exactly one caller flips the movement to Posted; only that caller audits and raises alerts
  const won = await StockMovement.findOneAndUpdate({ _id: movement._id, status: { $ne: 'Posted' } }, { $set: { status: 'Posted', postedAt: at }, $unset: { failureReason: 1 } }, { new: true });
  movement.status = 'Posted'; movement.postedAt = won?.postedAt || movement.postedAt || at; movement.failureReason = undefined;
  if (won) {
    await audit(req, { action: 'create', module: 'Inventory', entity: 'StockMovement', entityId: movement._id, entityLabel: `${movement.movementNumber} ${movement.type}`, newValue: summarize(movement), note: movement.reason });
    if (notifyAlerts) { try { await require('./alerts').evaluate(req, movement.ops.map((o) => ({ item: o.item, department: o.department }))); } catch (e) { console.error('alert evaluation failed', e.message); } }
  }
  return movement;
}

const summarize = (m) => ({ movementNumber: m.movementNumber, type: m.type, status: m.status, reason: m.reason, reference: m.reference,
  lines: m.lines.map((l) => ({ item: l.itemName, sku: l.sku, quantity: l.quantity, unit: l.unit, baseQty: l.baseQty, baseUnit: l.baseUnit, from: l.fromDepartment, to: l.toDepartment, direction: l.direction, lotNo: l.lotNo, expiryDate: l.expiryDate, unitPrice: l.unitPrice })) });

/* ------------------------------------------------------------------ public API */
function scopeKey(req, key) { return key ? `u:${req.user?._id || 'sys'}:${String(key).slice(0, 80)}` : `auto:${crypto.randomUUID()}`; }

async function resumeExisting(req, mv) {
  if (mv.status === 'Posted') return { movement: mv, replayed: true };
  if (mv.status === 'Awaiting Approval') return { movement: mv, replayed: true };
  if (mv.status === 'Rejected') throw conflict(`${mv.movementNumber} was rejected and cannot be re-submitted`);
  if (mv.status === 'Failed') { mv.attempt = (mv.attempt || 0) + 1; mv.ops = await planOps(mv); mv.status = 'Pending'; mv.failureReason = undefined; await mv.save(); }
  await finalize(req, mv); return { movement: mv, replayed: true };
}

/**
 * postMovement(req, { type, lines, idempotencyKey?, reason?, notes?, reference?, source?, supplier?, awaitApproval?, trusted?, rawKey? })
 * lines: [{ item, quantity, unit?, fromDepartment?, toDepartment?, unitPrice?, expiryDate?, lotNo?, lotId?, direction? }]
 * `rawKey: true` uses idempotencyKey exactly as given (internal callers such as approvals / housekeeping / future purchase receipts).
 * Returns { movement, replayed }.
 */
async function postMovement(req, spec) {
  if (!Array.isArray(spec.lines) || !spec.lines.length) throw bad('Add at least one line');
  if (spec.lines.length > 100) throw bad('Too many lines (max 100)');
  if (NEEDS_REASON.includes(spec.type) && (spec.reason || '').trim().length < 3) throw bad('A reason is required');
  const key = spec.rawKey ? spec.idempotencyKey : scopeKey(req, spec.idempotencyKey);
  const existing = await StockMovement.findOne({ idempotencyKey: key });
  if (existing) return resumeExisting(req, existing);

  const ctx = await loadContext(spec.lines);
  const sc = spec.trusted ? null : await scope(req, ctx.settings);
  const lines = await normalizeLines(req, spec, ctx, sc);
  const mv = new StockMovement({
    type: spec.type, idempotencyKey: key, source: spec.source || 'inventory', reason: spec.reason?.trim(), notes: spec.notes, reference: spec.reference,
    lines, performedBy: req.user?._id, performedByName: req.user?.name || 'System',
    status: spec.awaitApproval ? 'Awaiting Approval' : 'Pending', approvalStatus: spec.awaitApproval ? 'Pending' : 'Not Required',
  });
  if (!spec.awaitApproval) mv.ops = await planOps(mv);
  else for (const l of lines) if (l.direction === 'decrease') { // fail early if the stock to remove is not there (re-checked again on approval)
    await planDecrease({ item: l.item, department: l.fromDepartment, needQ: U.toQ(l.baseQty), lotId: l.lotId, taken: new Map(), itemName: l.itemName, baseUnit: l.baseUnit });
  }
  mv.movementNumber = await Counter.next('STK', 5);
  try { await mv.save(); } catch (e) {
    if (isDup(e)) { const again = await StockMovement.findOne({ idempotencyKey: key }); if (again) return resumeExisting(req, again); }   // lost the race for this key: continue the winner's movement
    throw e;
  }
  if (spec.awaitApproval) {
    await audit(req, { action: 'create', module: 'Inventory', entity: 'StockMovement', entityId: mv._id, entityLabel: `${mv.movementNumber} ${mv.type} (awaiting approval)`, newValue: summarize(mv), note: mv.reason });
    return { movement: mv, replayed: false };
  }
  await finalize(req, mv);
  return { movement: mv, replayed: false };
}

/** Roll forward movements left Pending by a crash. Safe to run at any time (every step is idempotent). */
async function resumePending(req = { user: null }, olderThanMs = 60 * 1000) {
  const stuck = await StockMovement.find({ status: 'Pending', updatedAt: { $lt: new Date(Date.now() - olderThanMs) } });
  let n = 0;
  for (const mv of stuck) { try { if (mv.ops?.length) { await finalize(req, mv); n += 1; } } catch (e) { console.error(`resume ${mv.movementNumber} failed: ${e.message}`); } }
  return n;
}

/* ------------------------------------------------------------------ approval-driven manual adjustments */
async function requestAdjustment(req, body) {
  const approvals = require('../approvals');
  const spec = { type: 'Adjustment', reason: body.reason, notes: body.notes, idempotencyKey: body.idempotencyKey, awaitApproval: true,
    lines: [{ item: body.item, quantity: body.quantity, unit: body.unit, direction: body.direction, department: body.department, expiryDate: body.expiryDate, lotNo: body.lotNo, lotId: body.lotId }] };
  const { movement, replayed } = await postMovement(req, spec);
  if (replayed) return { movement, approval: movement.approval ? await require('../../models').ApprovalRequest.findById(movement.approval) : null, replayed };
  const l = movement.lines[0];
  const item = await InventoryItem.findById(l.item).lean();
  const unitCost = item?.lastPurchase?.pricePerBase || 0;
  const label = `${movement.movementNumber} · ${l.itemName} ${l.direction === 'increase' ? '+' : '−'}${l.quantity} ${l.unit} · ${l.toDepartment || l.fromDepartment}`;
  try {
    const ar = await approvals.createRequest(req, { type: 'Stock adjustment', referenceModel: 'StockMovement', referenceId: movement._id, referenceLabel: label, amount: Math.round(l.baseQty * unitCost * 100) / 100,
      payload: { movementId: String(movement._id), direction: l.direction, quantity: l.quantity, unit: l.unit }, comments: movement.reason });
    movement.approval = ar._id; await movement.save();
    return { movement, approval: ar, replayed: false };
  } catch (e) { await StockMovement.deleteOne({ _id: movement._id, status: 'Awaiting Approval' }); throw e; }
}

async function applyApprovedAdjustment(req, movementId) {
  const mv = await StockMovement.findById(movementId);
  if (!mv) throw notFound('The adjustment record no longer exists');
  if (mv.status === 'Posted') return mv;                                   // already applied - exactly once
  if (!['Awaiting Approval', 'Pending', 'Failed'].includes(mv.status)) throw bad(`Adjustment ${mv.movementNumber} is ${mv.status.toLowerCase()}`);
  mv.approvalStatus = 'Approved'; mv.decidedBy = req.user?._id; mv.decidedAt = new Date(); mv.status = 'Pending';
  if (mv.ops?.length) mv.attempt = (mv.attempt || 0) + 1;
  mv.ops = await planOps(mv); await mv.save();
  await finalize(req, mv);
  return mv;
}
async function rejectAdjustment(req, movementId) {
  const mv = await StockMovement.findById(movementId);
  if (!mv || mv.status === 'Posted') return;
  mv.status = 'Rejected'; mv.approvalStatus = 'Rejected'; mv.decidedBy = req.user?._id; mv.decidedAt = new Date(); await mv.save();
  await audit(req, { action: 'reject', module: 'Inventory', entity: 'StockMovement', entityId: mv._id, entityLabel: `${mv.movementNumber} Adjustment rejected`, newValue: summarize(mv) });
}

/* ------------------------------------------------------------------ queries */
/** Lots with stock, optionally narrowed. Returns lean rows with decoded quantity. */
async function loadLots(filter = {}) {
  const rows = await StockBalance.find({ qtyQ: { $gt: 0 }, ...filter }).lean();
  return rows.map((r) => ({ ...r, qty: U.fromQ(r.qtyQ), ops: undefined }));
}
async function onHand(item, department) {
  const rows = await StockBalance.find({ item, ...(department ? { department } : {}) }).select('qtyQ').lean();
  return U.fromQ(rows.reduce((s, r) => s + r.qtyQ, 0));
}
const sumLots = (lots) => U.fromQ(lots.reduce((s, r) => s + r.qtyQ, 0));

/** Re-derive every lot balance from the ledger; returns the lots whose stored quantity disagrees (should always be empty). */
async function reconcile() {
  const ledger = await StockLedger.aggregate([{ $group: { _id: { item: '$item', department: '$department', lotKey: '$lotKey' }, sum: { $sum: '$deltaQ' } } }]);
  const sums = new Map(ledger.map((r) => [`${r._id.item}|${r._id.department}|${r._id.lotKey}`, r.sum]));
  const lots = await StockBalance.find().lean(); const drift = [];
  for (const l of lots) { const exp = sums.get(`${l.item}|${l.department}|${l.lotKey}`) || 0; if (exp !== l.qtyQ) drift.push({ lot: l._id, item: l.item, department: l.department, lotKey: l.lotKey, stored: U.fromQ(l.qtyQ), ledger: U.fromQ(exp) }); }
  return drift;
}

module.exports = { INCOMING, OUTGOING, lotKeyFor, hotelDate, postMovement, resumePending, requestAdjustment, applyApprovedAdjustment, rejectAdjustment, finalize, planDecrease, planOps, loadLots, onHand, sumLots, reconcile, summarize, applyOp };
