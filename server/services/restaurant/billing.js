/**
 * Module 6.4 - restaurant billing. Totals are ALWAYS computed here from persisted lines + approved adjustments; nothing the client sends
 * can set a price, total, discount, tax or payment status.
 *
 * Bill:  Draft (editable: discount / complimentary requests) --finalise--> Final (frozen, tax snapshot) --> Void (Draft: free; Final: approval)
 * Settlement: Unsettled -> Part-paid -> Paid   |   Posted to Room (room-service, a folio charge - never counted as cash)   |   No charge
 * Splits: every active item quantity must be assigned to exactly one bill. Tax is calculated on the combined taxable amount of all the order's
 * bills and allocated to the bills by largest remainder, so split bills always add up to the unsplit bill to the paisa.
 */
const mongoose = require('mongoose');
const { RestaurantBill, RestaurantOrder, RestaurantPayment, RestaurantClosing, ApprovalRequest, Counter } = require('../../models');
const { restaurantSettings } = require('../settings');
const approvals = require('../approvals');
const { audit } = require('../audit');
const { notify } = require('../notify');
const { calcBill, baseBeforeDiscount } = require('./calc');
const { toMinor, fromMinor, percentOf, allocate } = require('./money');
const folio = require('./folio');
const { todayStr } = require('../../utils/dates');
const { bad, conflict, forbidden, notFound } = require('../../utils/ApiError');

const orders = () => require('./orders');
const BILLABLE = ['Confirmed', 'Preparing', 'Ready', 'Served'];
const rup = fromMinor;

/* ---------------------------------------------------------------- recompute (Draft bills of one order) */
const totalsDoc = (c) => ({ gross: rup(c.grossMinor), complimentary: rup(c.complimentaryMinor), discount: rup(c.discountMinor), net: rup(c.netMinor), taxable: rup(c.taxableMinor),
  taxes: c.taxLines.map((t) => ({ code: t.code, name: t.name, ratePercent: t.ratePercent, amount: rup(t.amountMinor) })), tax: rup(c.taxMinor), total: rup(c.totalMinor) });

async function recomputeDraftBills(orderId) {
  const settings = await restaurantSettings();
  const bills = await RestaurantBill.find({ order: orderId, status: { $ne: 'Void' } }).sort({ splitIndex: 1 });
  const calcs = new Map(bills.map((b) => [String(b._id), b.status === 'Final' ? null : calcBill({ lines: b.lines, adjustments: b.adjustments, taxes: settings.taxes })]));
  const drafts = bills.filter((b) => b.status === 'Draft'); if (!drafts.length) return;
  // tax = tax on the COMBINED taxable amount of every bill, minus what finalised bills already carry, allocated across the drafts
  const allTaxable = bills.reduce((s, b) => s + (b.status === 'Final' ? toMinor(b.totals.taxable) : calcs.get(String(b._id)).taxableMinor), 0);
  settings.taxes.forEach((t, ti) => {
    const ref = percentOf(allTaxable, t.ratePercent);
    const frozen = bills.filter((b) => b.status === 'Final').reduce((s, b) => s + toMinor((b.totals.taxes.find((x) => x.code === t.code) || {}).amount || 0), 0);
    const parts = allocate(Math.max(0, ref - frozen), drafts.map((b) => calcs.get(String(b._id)).taxableMinor));
    drafts.forEach((b, i) => { calcs.get(String(b._id)).taxLines[ti].amountMinor = parts[i]; });
  });
  for (const b of drafts) {
    const c = calcs.get(String(b._id)); c.taxMinor = c.taxLines.reduce((s, t) => s + t.amountMinor, 0); c.totalMinor = c.netMinor + c.taxMinor;
    await RestaurantBill.updateOne({ _id: b._id, status: 'Draft' }, { $set: { totals: totalsDoc(c), totalMinor: c.totalMinor, balanceMinor: c.totalMinor } });
  }
}

/** Draft bills are throw-away: when the order changes (items, cancel, re-split) they are voided and any pending approval is withdrawn. */
async function supersedeDraftBills(orderId, why, req) {
  const drafts = await RestaurantBill.find({ order: orderId, status: 'Draft' });
  for (const b of drafts) {
    const pending = b.adjustments.filter((a) => a.status === 'Pending');
    pending.forEach((a) => { a.status = 'Superseded'; a.decisionNote = why; });
    for (const a of pending) if (a.approval) await ApprovalRequest.updateOne({ _id: a.approval, status: 'Pending' }, { $set: { status: 'Rejected', rejectionReason: `Withdrawn automatically: ${why}`, approvedAt: new Date() } });
    b.status = 'Void'; b.voidedAt = new Date(); b.voidReason = why; await b.save();
  }
  return drafts.length;
}

/* ---------------------------------------------------------------- generate / split */
async function generateBills(req, orderId, { splits } = {}) {
  const order = await RestaurantOrder.findById(orderId); if (!order) throw notFound('Order not found');
  if (!BILLABLE.includes(order.status)) throw bad(order.status === 'Draft' ? 'Send the order to the kitchen before billing it' : `A ${order.status.toLowerCase()} order cannot be billed`);
  const active = order.items.filter((i) => i.status === 'Active');
  if (active.some((i) => i.round == null)) throw bad('Some items have not been sent to the kitchen yet - send them first');
  if (await RestaurantBill.exists({ order: orderId, status: 'Final' })) throw conflict('This order already has a finalised bill. Void it (needs approval) to bill it differently.');
  const plan = splits?.length ? splits : [{ label: 'Bill', lines: active.map((i) => ({ orderItem: String(i._id), quantity: i.quantity })) }];
  // every active quantity must be assigned exactly once - splits can never exceed or lose what was ordered
  const assigned = new Map();
  plan.forEach((s, si) => {
    if (!s.lines?.length) throw bad(`Split ${si + 1} has no items`);
    s.lines.forEach((l) => { if (!active.some((i) => String(i._id) === String(l.orderItem))) throw bad('A split refers to an item that is not on this order'); assigned.set(String(l.orderItem), (assigned.get(String(l.orderItem)) || 0) + l.quantity); });
  });
  for (const i of active) {
    const a = assigned.get(String(i._id)) || 0;
    if (a > i.quantity) throw bad(`${i.name}: ${a} assigned across bills but only ${i.quantity} ordered`);
    if (a < i.quantity) throw bad(`${i.name}: ${i.quantity - a} not assigned to any bill`);
  }
  const claimed = await RestaurantOrder.findOneAndUpdate({ _id: orderId, billingRevision: order.billingRevision, status: { $in: BILLABLE } }, { $inc: { billingRevision: 1 } }, { new: true });
  if (!claimed) throw conflict('Bills for this order were just generated or the order changed - reload');
  await supersedeDraftBills(orderId, 'Bills were re-generated', req);
  const who = order.stay?.guestName || order.customer?.name;
  const created = [];
  for (let i = 0; i < plan.length; i += 1) {
    const s = plan[i];
    created.push(await RestaurantBill.create({
      billNumber: await Counter.next('BIL', 4), order: order._id, orderNumber: order.orderNumber, orderType: order.type, businessDate: order.businessDate,
      label: s.label || (plan.length > 1 ? `Guest ${i + 1}` : 'Bill'), splitIndex: i + 1, splitCount: plan.length, guest: { name: who, phone: order.customer?.phone }, createdBy: req.user._id,
      lines: s.lines.map((l) => { const it = active.find((x) => String(x._id) === String(l.orderItem)); return { orderItem: it._id, name: it.name, unitPrice: it.unitPrice, taxable: it.taxable, quantity: l.quantity }; }),
    }));
  }
  await recomputeDraftBills(orderId);
  await audit(req, { action: 'create', module: 'Restaurant Billing', entity: 'RestaurantBill', entityId: created[0]._id, entityLabel: `${created.map((b) => b.billNumber).join(', ')} for ${order.orderNumber}`, newValue: { splits: plan.length } });
  return listForOrder(orderId);
}
const listForOrder = (orderId) => RestaurantBill.find({ order: orderId, status: { $ne: 'Void' } }).sort({ splitIndex: 1 });

/* ---------------------------------------------------------------- discount / complimentary: approval-gated */
async function requestAdjustment(req, billId, b) {
  const bill = await RestaurantBill.findById(billId); if (!bill) throw notFound('Bill not found');
  if (bill.status !== 'Draft') throw conflict(bill.status === 'Final' ? 'This bill is finalised - a discount or complimentary item can only be requested before finalising' : 'This bill is void');
  if (!b.reason || b.reason.trim().length < 3) throw bad('Enter the reason for this request');
  const live = bill.adjustments.filter((a) => ['Pending', 'Applied'].includes(a.status));
  const adj = { _id: new mongoose.Types.ObjectId(), kind: b.kind, status: 'Pending', reason: b.reason.trim(), requestedBy: req.user._id, requestedByName: req.user.name, requestedAt: new Date() };
  let type, amount;
  if (b.kind === 'Discount') {
    if (live.some((a) => a.kind === 'Discount')) throw conflict('This bill already has a discount (pending or approved)');
    adj.mode = b.mode; adj.value = b.value; type = 'Discount';
    const base = baseBeforeDiscount(bill.lines, live);
    const amt = b.mode === 'percent' ? percentOf(base, b.value) : toMinor(b.value);
    if (b.mode === 'percent' && (b.value <= 0 || b.value > 100)) throw bad('A percentage discount must be between 0 and 100');
    if (amt <= 0) throw bad('The discount must be greater than zero');
    if (amt > base) throw bad(`The discount (${rup(amt)}) is more than the bill amount (${rup(base)})`);
    amount = rup(amt);
  } else {
    type = 'Complimentary food';
    if (!b.lines?.length) throw bad('Select the complimentary items');
    const already = new Map(); live.filter((a) => a.kind === 'Complimentary').forEach((a) => a.lines.forEach((l) => already.set(String(l.orderItem), (already.get(String(l.orderItem)) || 0) + l.quantity)));
    let value = 0; const merged = new Map();
    for (const l of b.lines) merged.set(String(l.orderItem), (merged.get(String(l.orderItem)) || 0) + l.quantity);
    for (const [k, q] of merged) {
      const line = bill.lines.find((x) => String(x.orderItem) === k); if (!line) throw bad('A complimentary line is not on this bill');
      if (q + (already.get(k) || 0) > line.quantity) throw bad(`${line.name}: only ${line.quantity - (already.get(k) || 0)} left that can be complimentary`);
      value += toMinor(line.unitPrice) * q;
    }
    adj.lines = [...merged].map(([orderItem, quantity]) => ({ orderItem, quantity })); amount = rup(value);
  }
  adj.amount = amount;
  // Approval is ALWAYS required for these (PDF section 8). Amount-based thresholds (TBC) only choose WHO approves, via the existing framework.
  const ar = await approvals.createRequest(req, { type, referenceModel: 'RestaurantBill', referenceId: bill._id, referenceLabel: `${bill.billNumber} - ${bill.orderNumber}`, amount,
    payload: { billId: bill._id, adjustmentId: adj._id, kind: b.kind, mode: adj.mode, value: adj.value, lines: adj.lines, reason: adj.reason, amount }, comments: adj.reason });
  adj.approval = ar._id;
  const pushed = await RestaurantBill.updateOne({ _id: billId, status: 'Draft' }, { $push: { adjustments: adj } });
  if (!pushed.matchedCount) { await ApprovalRequest.updateOne({ _id: ar._id }, { $set: { status: 'Rejected', rejectionReason: 'The bill changed while the request was being made' } }); throw conflict('The bill changed - reload and retry'); }
  return { bill: await RestaurantBill.findById(billId), approval: ar };
}

const adjOf = (bill, id) => bill.adjustments.id(id);
const saveVersioned = async (doc) => { try { await doc.save(); } catch (e) { if (e.name === 'VersionError') throw conflict('This request was just decided by someone else'); throw e; } };
approvalsRegister();
function approvalsRegister() {
  for (const type of ['Discount', 'Complimentary food']) {
    approvals.registerHandler(type, {
      async apply(ar, req) {
        const p = ar.payload || {}; if (!p.billId) return;                       // not a restaurant request
        if (String(ar.requestedBy) === String(req.user._id) && req.user.role.key !== 'hotel_owner') throw forbidden('You cannot approve your own request - another approver must decide it');
        const bill = await RestaurantBill.findById(p.billId);
        const adj = bill && adjOf(bill, p.adjustmentId);
        if (!bill || bill.status !== 'Draft' || !adj || adj.status !== 'Pending') throw conflict('This request is no longer applicable - the bill was changed, finalised or voided after it was made. Reject it and request again if needed.');
        const settings = await restaurantSettings();
        const before = calcBill({ lines: bill.lines, adjustments: bill.adjustments, taxes: settings.taxes });
        adj.status = 'Applied'; adj.decidedBy = req.user._id; adj.decidedByName = req.user.name; adj.decidedAt = new Date(); adj.beforeTotal = rup(before.totalMinor);
        if (p.kind === 'Discount' && (adj.mode === 'percent' ? percentOf(before.grossMinor - before.complimentaryMinor, adj.value) : toMinor(adj.value)) > before.grossMinor - before.complimentaryMinor) throw bad('The discount is now larger than the bill amount');
        await saveVersioned(bill);                                                // version-checked: a double approval cannot apply twice
        await recomputeDraftBills(bill.order);
        const after = await RestaurantBill.findById(bill._id); const a2 = adjOf(after, p.adjustmentId); a2.afterTotal = after.totals.total; await after.save();
        await audit(req, { action: 'update', module: 'Restaurant Billing', entity: 'RestaurantBill', entityId: bill._id, entityLabel: `${bill.billNumber} ${p.kind} approved`, oldValue: { total: adj.beforeTotal }, newValue: { total: after.totals.total, discount: after.totals.discount, complimentary: after.totals.complimentary }, note: `Approval ${ar.requestNumber}` });
      },
      async onReject(ar, req) {
        const p = ar.payload || {}; if (!p.billId) return;
        const bill = await RestaurantBill.findById(p.billId); const adj = bill && adjOf(bill, p.adjustmentId);
        if (adj && adj.status === 'Pending') { adj.status = 'Rejected'; adj.decidedBy = req.user._id; adj.decidedByName = req.user.name; adj.decidedAt = new Date(); adj.decisionNote = req.body?.reason; await bill.save(); }
      },
    });
  }
  approvals.registerHandler('Bill editing', {
    async apply(ar, req) {
      const p = ar.payload || {}; if (p.action !== 'void' || !p.billId) return;
      if (String(ar.requestedBy) === String(req.user._id) && req.user.role.key !== 'hotel_owner') throw forbidden('You cannot approve your own request - another approver must decide it');
      await applyVoid(req, p.billId, p.reason, ar);
    },
  });
}

/* ---------------------------------------------------------------- finalise */
async function finaliseBill(req, billId) {
  const bill = await RestaurantBill.findById(billId); if (!bill) throw notFound('Bill not found');
  if (bill.status === 'Final') return { bill, replayed: true };
  if (bill.status === 'Void') throw conflict('This bill is void');
  const order = await RestaurantOrder.findById(bill.order);
  if (!BILLABLE.includes(order.status)) throw bad(`A ${order.status.toLowerCase()} order cannot be billed`);
  if (order.items.some((i) => i.status === 'Active' && i.round == null)) throw bad('Some items have not been sent to the kitchen yet');
  if (bill.adjustments.some((a) => a.status === 'Pending')) throw conflict('A discount / complimentary request is still waiting for approval. Wait for the decision (or ask the approver) before finalising.');
  const settings = await restaurantSettings();
  await recomputeDraftBills(order._id);
  const fresh = await RestaurantBill.findById(billId);
  const final = await RestaurantBill.findOneAndUpdate({ _id: billId, status: 'Draft' }, { $set: { status: 'Final', finalisedAt: new Date(), finalisedBy: req.user._id, finalisedDate: todayStr(), paidMinor: 0, balanceMinor: fresh.totalMinor,
    settlement: fresh.totalMinor === 0 ? 'No charge' : 'Unsettled', taxSnapshot: { taxes: settings.taxes.map(({ code, name, ratePercent }) => ({ code, name, ratePercent })), configured: settings.taxes.length > 0, currency: settings.currency } } }, { new: true });
  if (!final) { const cur = await RestaurantBill.findById(billId); if (cur.status === 'Final') return { bill: cur, replayed: true }; throw conflict('The bill changed - reload'); }
  await audit(req, { action: 'status', module: 'Restaurant Billing', entity: 'RestaurantBill', entityId: final._id, entityLabel: `${final.billNumber} finalised`, newValue: { total: final.totals.total, tax: final.totals.tax, taxConfigured: settings.taxes.length > 0 } });
  let result = final;
  if (final.orderType === 'Room Service' && final.totalMinor > 0) result = await folio.postBill(req, final._id);   // charge to the guest's room bill (idempotent; a failure leaves a visible, retryable state)
  await orders().reconcile(order._id, req);
  return { bill: await RestaurantBill.findById(final._id), replayed: false, posting: result.posting };
}

/* ---------------------------------------------------------------- payments */
async function addPayment(req, billId, b) {
  const key = `${req.user._id}:${b.idempotencyKey}`;
  const existing = await RestaurantPayment.findOne({ idempotencyKey: key });
  if (existing) return { payment: existing, bill: await RestaurantBill.findById(billId), replayed: true };
  const settings = await restaurantSettings();
  if (!settings.effectivePaymentMethods.includes(b.method)) throw bad(`Payment method must be one of: ${settings.effectivePaymentMethods.join(', ')}`);
  const bill = await RestaurantBill.findById(billId); if (!bill) throw notFound('Bill not found');
  if (bill.status !== 'Final') throw bad(bill.status === 'Draft' ? 'Finalise the bill before taking payment' : 'This bill is void');
  if (bill.orderType === 'Room Service') throw bad('Room-service bills are charged to the guest\'s room bill - the guest settles it at the front desk');
  const amountMinor = toMinor(b.amount);
  if (amountMinor <= 0) throw bad('Enter an amount greater than zero');
  if (amountMinor > bill.balanceMinor) throw bad(`The amount (${rup(amountMinor)}) is more than the balance due (${rup(bill.balanceMinor)})`);
  // atomic balance guard: the increment only happens if the balance still covers it, so concurrent payments can never over-collect
  const reserved = await RestaurantBill.findOneAndUpdate({ _id: billId, status: 'Final', balanceMinor: { $gte: amountMinor } }, { $inc: { paidMinor: amountMinor, balanceMinor: -amountMinor } }, { new: true });
  if (!reserved) throw conflict('The balance changed - reload the bill and try again');
  let payment;
  try {
    payment = await RestaurantPayment.create({ bill: bill._id, order: bill.order, billNumber: bill.billNumber, amount: rup(amountMinor), amountMinor, method: b.method, reference: b.reference, idempotencyKey: key, receivedBy: req.user._id, receivedByName: req.user.name, businessDate: todayStr() });
  } catch (e) {
    await RestaurantBill.updateOne({ _id: billId }, { $inc: { paidMinor: -amountMinor, balanceMinor: amountMinor } });  // compensate
    if (e.code === 11000) return { payment: await RestaurantPayment.findOne({ idempotencyKey: key }), bill: await RestaurantBill.findById(billId), replayed: true };
    throw e;
  }
  const cur = await RestaurantBill.findById(billId);
  await RestaurantBill.updateOne({ _id: billId }, { $set: { settlement: cur.balanceMinor === 0 ? 'Paid' : 'Part-paid' } });
  await audit(req, { action: 'create', module: 'Restaurant Billing', entity: 'RestaurantPayment', entityId: payment._id, entityLabel: `${bill.billNumber} ${b.method} ${payment.amount}`, oldValue: { balance: rup(bill.balanceMinor) }, newValue: { balance: rup(cur.balanceMinor) } });
  await orders().reconcile(bill.order, req);
  return { payment, bill: await RestaurantBill.findById(billId), replayed: false };
}

/* ---------------------------------------------------------------- void */
async function voidBill(req, billId, reason) {
  if (!reason || reason.trim().length < 3) throw bad('Enter a reason');
  const bill = await RestaurantBill.findById(billId); if (!bill) throw notFound('Bill not found');
  if (bill.status === 'Void') throw bad('This bill is already void');
  if (bill.status === 'Draft') {
    bill.adjustments.filter((a) => a.status === 'Pending').forEach((a) => { a.status = 'Superseded'; a.decisionNote = 'Bill voided'; });
    for (const a of bill.adjustments.filter((x) => x.status === 'Superseded' && x.approval)) await ApprovalRequest.updateOne({ _id: a.approval, status: 'Pending' }, { $set: { status: 'Rejected', rejectionReason: 'Withdrawn: bill voided' } });
    Object.assign(bill, { status: 'Void', voidedAt: new Date(), voidedBy: req.user._id, voidReason: reason.trim() }); await bill.save();
    await audit(req, { action: 'status', module: 'Restaurant Billing', entity: 'RestaurantBill', entityId: bill._id, entityLabel: `${bill.billNumber} voided (draft)`, note: reason });
    return { bill, approval: null };
  }
  if (!req.permissions.has('restaurant.void')) throw forbidden('Only a manager can void a finalised bill');
  if (bill.paidMinor > 0) throw bad('This bill has payments. Refunds belong to Accounts & Finance (Phase 12) and are not part of Phase 6.');
  if (await RestaurantClosing.exists({ businessDate: bill.businessDate })) throw conflict(`The restaurant day ${bill.businessDate} is closed - a finalised bill of a closed day cannot be voided in Phase 6`);
  const ar = await approvals.createRequest(req, { type: 'Bill editing', referenceModel: 'RestaurantBill', referenceId: bill._id, referenceLabel: `Void ${bill.billNumber} - ${bill.orderNumber}`, amount: bill.totals.total, payload: { billId: bill._id, action: 'void', reason: reason.trim() }, comments: reason.trim() });
  return { bill, approval: ar };
}
async function applyVoid(req, billId, reason, ar) {
  const bill = await RestaurantBill.findById(billId);
  if (!bill || bill.status !== 'Final') throw conflict('The bill is no longer final - nothing to void');
  if (bill.paidMinor > 0) throw conflict('The bill received a payment after this request - it can no longer be voided');
  if (await RestaurantClosing.exists({ businessDate: bill.businessDate })) throw conflict('The restaurant day is closed');
  if (bill.posting.state === 'Posted') await folio.reverseBill(req, bill._id);
  const upd = await RestaurantBill.findOneAndUpdate({ _id: billId, status: 'Final', paidMinor: 0 }, { $set: { status: 'Void', voidedAt: new Date(), voidedBy: req.user._id, voidReason: reason, 'posting.state': bill.posting.state === 'Posted' ? 'Reversed' : bill.posting.state } }, { new: true });
  if (!upd) throw conflict('The bill changed - reload');
  await audit(req, { action: 'status', module: 'Restaurant Billing', entity: 'RestaurantBill', entityId: bill._id, entityLabel: `${bill.billNumber} voided`, oldValue: { status: 'Final', total: bill.totals.total }, newValue: { status: 'Void' }, note: `${reason} (approval ${ar?.requestNumber})` });
  await orders().reconcile(bill.order, req);
}

/* ---------------------------------------------------------------- reads */
async function getBill(id) {
  const b = await RestaurantBill.findById(id); if (!b) throw notFound('Bill not found');
  const [order, payments, siblings] = await Promise.all([RestaurantOrder.findById(b.order).lean(), RestaurantPayment.find({ bill: id }).sort({ receivedAt: 1 }), RestaurantBill.find({ order: b.order, status: { $ne: 'Void' } }).select('billNumber label status settlement totals.total').sort({ splitIndex: 1 })]);
  const f = order?.stay?.folio ? await require('../../models').Folio.findById(order.stay.folio).select('folioNumber status totalCharges totalPaid outstanding') : null;
  const taxes = (await restaurantSettings()).taxes;
  return { ...b.toObject(), order: order && { _id: order._id, orderNumber: order.orderNumber, type: order.type, status: order.status, tableNumber: order.tableNumber, stay: order.stay, customer: order.customer, delivery: order.delivery, createdAt: order.createdAt },
    payments, siblings, folio: f, taxConfigured: b.status === 'Final' ? b.taxSnapshot?.configured : taxes.length > 0 };
}
async function listBills(q = {}) {
  const f = {};
  if (q.status) f.status = { $in: String(q.status).split(',') }; else if (q.includeVoid !== 'true') f.status = { $ne: 'Void' };
  if (q.settlement) f.settlement = { $in: String(q.settlement).split(',') };
  if (q.order) f.order = q.order;
  if (q.date) f.businessDate = q.date;
  if (q.type) f.orderType = q.type;
  if (q.q) { const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ billNumber: rx }, { orderNumber: rx }, { 'guest.name': rx }]; }
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Number(q.limit) || 40);
  const [data, total] = await Promise.all([RestaurantBill.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-lines -adjustments.lines'), RestaurantBill.countDocuments(f)]);
  return { data, total, page, pages: Math.ceil(total / limit) };
}
/** Discount / complimentary requests across bills - the restaurant's own view of its approvals. */
async function listAdjustments(q = {}) {
  const bills = await RestaurantBill.find({ 'adjustments.0': { $exists: true } }).sort({ updatedAt: -1 }).limit(150).select('billNumber orderNumber status totals adjustments');
  const rows = bills.flatMap((b) => b.adjustments.map((a) => ({ ...a.toObject(), billId: b._id, billNumber: b.billNumber, orderNumber: b.orderNumber, billStatus: b.status, billTotal: b.totals?.total })));
  return rows.filter((r) => !q.status || r.status === q.status).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
}
module.exports = { calcBill, recomputeDraftBills, supersedeDraftBills, generateBills, requestAdjustment, finaliseBill, addPayment, voidBill, getBill, listBills, listAdjustments, listForOrder, postBill: folio.postBill };
