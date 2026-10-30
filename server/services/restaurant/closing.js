/**
 * Module 6.5 - restaurant daily closing (PROVISIONAL: the exact closing steps and the link to Phase 13 Night Audit are TBC in the PDF).
 * Operating period = one calendar day in hotel time (Asia/Kolkata), `businessDate`. Everything is recomputed from persisted orders, bills and
 * payments - the client's numbers are never used. A day closes once (unique businessDate) and the snapshot is stored for Night Audit.
 *
 * Definitions (these are the provisional rules documented in the README):
 *   Sales            = finalised, non-void bills of orders opened that day (gross, complimentary, discount, net, tax, total)
 *   Collected        = restaurant payments RECEIVED that day, by method (cash basis; may include earlier days' bills)
 *   Posted to rooms  = room-service charges posted to guest folios - NOT cash, shown separately
 *   Outstanding      = unpaid balance of that day's finalised bills (not room-service, which is on the folio)
 *   Cancelled/voided = shown separately, never counted as sales
 * Blockers must be fixed; "acknowledge" exceptions may be carried forward if the manager explicitly acknowledges them.
 */
const { RestaurantOrder, RestaurantBill, RestaurantPayment, RestaurantClosing, ApprovalRequest } = require('../../models');
const { restaurantSettings } = require('../settings');
const { audit } = require('../audit');
const { notify } = require('../notify');
const events = require('../events');
const { toMinor, fromMinor } = require('./money');
const { todayStr } = require('../../utils/dates');
const { bad, conflict } = require('../../utils/ApiError');

const TYPES = RestaurantOrder.TYPES; const sum = (a, f) => a.reduce((s, x) => s + f(x), 0); const rup = fromMinor;
const empty = () => ({ orders: 0, gross: 0, complimentary: 0, discount: 0, net: 0, tax: 0, total: 0 });

async function preview(businessDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate || '')) throw bad('Enter a valid date (YYYY-MM-DD)');
  if (businessDate > todayStr()) throw bad('A future day cannot be closed');
  const settings = await restaurantSettings();
  const closed = await RestaurantClosing.findOne({ businessDate });
  const orders = await RestaurantOrder.find({ businessDate }).select('orderNumber type status billingStatus subtotal tableNumber stay.roomNumber items').lean();
  const ids = orders.map((o) => o._id);
  const [bills, payments] = await Promise.all([
    ids.length ? RestaurantBill.find({ order: { $in: ids } }).lean() : [],
    RestaurantPayment.find({ businessDate }).lean(),
  ]);
  const finals = bills.filter((b) => b.status === 'Final'), voided = bills.filter((b) => b.status === 'Void' && b.finalisedAt), drafts = bills.filter((b) => b.status === 'Draft');
  const money = (list) => ({ gross: sum(list, (b) => toMinor(b.totals.gross)), complimentary: sum(list, (b) => toMinor(b.totals.complimentary)), discount: sum(list, (b) => toMinor(b.totals.discount)), net: sum(list, (b) => toMinor(b.totals.net)), tax: sum(list, (b) => toMinor(b.totals.tax)), total: sum(list, (b) => toMinor(b.totals.total)) });
  const m = money(finals);
  const byType = Object.fromEntries(TYPES.map((t) => { const l = finals.filter((b) => b.orderType === t); const x = money(l); return [t, { orders: new Set(l.map((b) => String(b.order))).size, bills: l.length, gross: rup(x.gross), complimentary: rup(x.complimentary), discount: rup(x.discount), net: rup(x.net), tax: rup(x.tax), total: rup(x.total) }]; }));
  const methods = [...new Set(payments.map((p) => p.method))].sort();
  const byMethod = Object.fromEntries(methods.map((mth) => { const l = payments.filter((p) => p.method === mth); return [mth, { count: l.length, amount: rup(sum(l, (p) => p.amountMinor)) }]; }));
  const orderSet = new Set(ids.map(String));
  const fromOtherDays = payments.filter((p) => !orderSet.has(String(p.order)));
  const posted = finals.filter((b) => b.posting?.state === 'Posted');
  const outstanding = finals.filter((b) => b.orderType !== 'Room Service' && ['Unsettled', 'Part-paid'].includes(b.settlement));
  const cancelled = orders.filter((o) => o.status === 'Cancelled');

  // ---- exceptions
  const ex = []; const add = (code, severity, message, refs) => refs.length && ex.push({ code, severity, message, count: refs.length, refs: refs.slice(0, 50) });
  const label = (o) => `${o.orderNumber}${o.tableNumber ? ' (T' + o.tableNumber + ')' : ''}`;
  add('OPEN_ORDERS', 'blocker', 'Orders not yet served - serve or cancel them before closing', orders.filter((o) => ['Draft', 'Confirmed', 'Preparing', 'Ready'].includes(o.status)).map(label));
  const served = orders.filter((o) => o.status === 'Served');
  add('UNBILLED_ORDERS', 'blocker', 'Served orders without a bill', served.filter((o) => !bills.some((b) => String(b.order) === String(o._id) && b.status !== 'Void')).map(label));
  add('DRAFT_BILLS', 'blocker', 'Bills that are not finalised', drafts.map((b) => b.billNumber));
  const pendingIds = drafts.flatMap((b) => b.adjustments.filter((a) => a.status === 'Pending').map((a) => a.approval));
  const pendingAr = pendingIds.length ? await ApprovalRequest.find({ _id: { $in: pendingIds }, status: 'Pending' }).select('requestNumber type') : [];
  add('PENDING_APPROVALS', 'blocker', 'Discount / complimentary requests still waiting for approval', pendingAr.map((a) => `${a.requestNumber} ${a.type}`));
  add('POSTING_PENDING', 'blocker', 'Room-service charges not posted to the guest bill', finals.filter((b) => b.orderType === 'Room Service' && b.totalMinor > 0 && b.posting?.state !== 'Posted').map((b) => `${b.billNumber} (${b.orderNumber})`));
  add('OUTSTANDING_BILLS', 'acknowledge', 'Bills with an unpaid balance that will be carried forward', outstanding.map((b) => `${b.billNumber}: ${rup(b.balanceMinor)}`));
  if (!settings.taxes.length && finals.length) ex.push({ code: 'TAX_NOT_CONFIGURED', severity: 'info', message: 'No restaurant tax is configured (TBC with the hotel) - bills carry no tax', count: finals.length, refs: [] });
  if (fromOtherDays.length) ex.push({ code: 'PAYMENTS_FROM_OTHER_DAYS', severity: 'info', message: 'Payments received today for bills of earlier days (counted as collected today)', count: fromOtherDays.length, refs: fromOtherDays.map((p) => p.billNumber).slice(0, 50) });

  const totals = {
    orders: { total: orders.length, completed: orders.filter((o) => o.status === 'Completed').length, served: served.length, open: orders.filter((o) => ACTIVE_OPEN.includes(o.status)).length, cancelled: cancelled.length },
    sales: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, rup(v)])), byType,
    collected: { total: rup(sum(payments, (p) => p.amountMinor)), count: payments.length, byMethod, fromOtherDays: rup(sum(fromOtherDays, (p) => p.amountMinor)) },
    postedToRooms: { count: posted.length, amount: rup(sum(posted, (b) => toMinor(b.totals.total))) },
    outstanding: { count: outstanding.length, amount: rup(sum(outstanding, (b) => b.balanceMinor)) },
    cancelledOrders: { count: cancelled.length, value: rup(sum(cancelled, (o) => toMinor(o.subtotal))) },
    voidedBills: { count: voided.length, value: rup(sum(voided, (b) => toMinor(b.totals.total))) },
    taxes: settings.taxes.map((t) => ({ code: t.code, name: t.name, ratePercent: t.ratePercent, amount: rup(sum(finals, (b) => toMinor((b.totals.taxes.find((x) => x.code === t.code) || {}).amount || 0))) })),
    currency: settings.currency,
  };
  return { businessDate, closed: closed || null, canClose: !closed && !ex.some((e) => e.severity === 'blocker'), exceptions: ex, totals,
    references: { orders: ids, bills: finals.map((b) => b._id), payments: payments.map((p) => p._id) } };
}
const ACTIVE_OPEN = ['Draft', 'Confirmed', 'Preparing', 'Ready'];

async function close(req, b) {
  const key = `${req.user._id}:${b.idempotencyKey}`;
  const mine = await RestaurantClosing.findOne({ idempotencyKey: key }); if (mine) return { closing: mine, replayed: true };
  const already = await RestaurantClosing.findOne({ businessDate: b.businessDate });
  if (already) throw conflict(`The restaurant day ${b.businessDate} was already closed by ${already.closedByName} on ${already.closedAt.toISOString()}`, [{ closingId: already._id }]);
  const p = await preview(b.businessDate);
  const blockers = p.exceptions.filter((e) => e.severity === 'blocker');
  if (blockers.length) throw conflict('Resolve these before closing: ' + blockers.map((e) => e.code).join(', '), blockers);
  const needAck = p.exceptions.filter((e) => e.severity === 'acknowledge').map((e) => e.code);
  const missing = needAck.filter((c) => !(b.acknowledge || []).includes(c));
  if (missing.length) throw bad(`Acknowledge these exceptions to close: ${missing.join(', ')}`, missing.map((c) => ({ field: 'acknowledge', message: c })));
  let closing;
  try {
    closing = await RestaurantClosing.create({ businessDate: b.businessDate, idempotencyKey: key, totals: p.totals, exceptions: p.exceptions, acknowledged: needAck, notes: b.notes?.trim(), references: p.references, closedBy: req.user._id, closedByName: req.user.name });
  } catch (e) {
    if (e.code === 11000) { const ex = await RestaurantClosing.findOne({ idempotencyKey: key }) || await RestaurantClosing.findOne({ businessDate: b.businessDate }); if (ex && ex.idempotencyKey === key) return { closing: ex, replayed: true }; throw conflict(`The restaurant day ${b.businessDate} was just closed by someone else`); }
    throw e;
  }
  await audit(req, { action: 'create', module: 'Restaurant Closing', entity: 'RestaurantClosing', entityId: closing._id, entityLabel: `Restaurant closed ${b.businessDate}`, newValue: { sales: p.totals.sales, collected: p.totals.collected.total, outstanding: p.totals.outstanding, acknowledged: needAck }, note: b.notes });
  events.publish('restaurant.closing.completed', { businessDate: b.businessDate, closingId: closing._id });
  await notify({ type: 'restaurant_closing', title: `Restaurant closed for ${b.businessDate}`, message: `Sales ${p.totals.sales.total}, collected ${p.totals.collected.total}${needAck.length ? ', ' + needAck.length + ' exception(s) carried forward' : ''}`, link: '/restaurant/closing', severity: needAck.length ? 'warning' : 'info', permission: 'dashboard.owner' });
  return { closing, replayed: false };
}
const list = () => RestaurantClosing.find().sort({ businessDate: -1 }).limit(60).select('-references');
const get = async (date) => { const c = await RestaurantClosing.findOne({ businessDate: date }); if (!c) throw require('../../utils/ApiError').notFound('No closing record for that date'); return c; };
/** Phase 13 (Night Audit) integration boundary: read-only status + snapshot for a business date. */
const statusFor = async (date) => { const c = await RestaurantClosing.findOne({ businessDate: date }).select('-references'); return c ? { closed: true, businessDate: date, closedAt: c.closedAt, closedBy: c.closedByName, totals: c.totals } : { closed: false, businessDate: date }; };
module.exports = { preview, close, list, get, statusFor };
