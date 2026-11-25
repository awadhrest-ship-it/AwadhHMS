const { z } = require('zod');
const { Property, RestaurantOrder, KitchenTicket, RestaurantBill } = require('../models');
const tables = require('../services/restaurant/tables');
const menu = require('../services/restaurant/menu');
const orders = require('../services/restaurant/orders');
const billing = require('../services/restaurant/billing');
const closing = require('../services/restaurant/closing');
const { restaurantSettings, RESTAURANT_DEFAULTS } = require('../services/settings');
const { isMoney } = require('../services/restaurant/money');
const { audit } = require('../services/audit');
const { todayStr } = require('../utils/dates');
const { wrap, parse } = require('../utils/wrap');
const { bad } = require('../utils/ApiError');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const money = z.number().refine(isMoney, 'Use at most 2 decimal places');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const keyOf = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const needKey = (req, what) => { const k = keyOf(req); if (!k || String(k).length < 8) throw bad(`An Idempotency-Key (header or "idempotencyKey") of at least 8 characters is required to ${what}, so a retry can never be applied twice`); return String(k).slice(0, 80); };
const ok = (res, data, extra = {}, status = 200) => res.status(status).json({ success: true, data, ...extra });

/* ---- overview & settings ---- */
exports.overview = wrap(async (req, res) => {
  const [tbl, active, tickets, pending] = await Promise.all([tables.listTables(), RestaurantOrder.find({ status: { $in: RestaurantOrder.ACTIVE } }).select('status type'), KitchenTicket.countDocuments({ status: { $in: ['Queued', 'Preparing'] } }), billing.listAdjustments({ status: 'Pending' })]);
  const out = { today: todayStr(), tables: tbl.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {}), tableTotal: tbl.length,
    activeOrders: active.length, ordersByStatus: active.reduce((a, o) => ((a[o.status] = (a[o.status] || 0) + 1), a), {}), kitchenQueue: tickets, pendingApprovals: pending.length };
  if (req.permissions.has('restaurant.close')) { const p = await closing.preview(todayStr()); out.todaySales = p.totals.sales; out.collectedToday = p.totals.collected.total; out.closingExceptions = p.exceptions.length; out.closedToday = !!p.closed; }
  ok(res, out);
});
exports.getSettings = wrap(async (_req, res) => ok(res, await restaurantSettings(), { defaults: RESTAURANT_DEFAULTS }));
const taxSchema = z.object({ code: z.string().trim().min(1).max(12).optional(), name: z.string().trim().min(1).max(40), ratePercent: z.number().min(0).max(100).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max 2 decimals') });
exports.updateSettings = wrap(async (req, res) => {
  const b = parse(z.object({
    taxes: z.array(taxSchema).max(6).optional(), paymentMethods: z.array(z.string().trim().min(1).max(30)).max(12).nullable().optional(),
    reservationDurationMinutes: z.number().int().min(15).max(480).optional(), reservationHoldMinutes: z.number().int().min(0).max(240).optional(),
    deliveryRequiredFields: z.array(z.enum(['contactName', 'phone', 'address', 'landmark', 'instructions'])).optional(), maxQuantityPerLine: z.number().int().min(1).max(500).optional(),
  }), req.body);
  if (b.taxes) { const codes = b.taxes.map((t, i) => t.code || `TAX${i + 1}`); if (new Set(codes).size !== codes.length) throw bad('Tax codes must be unique'); b.taxes = b.taxes.map((t, i) => ({ ...t, code: t.code || `TAX${i + 1}` })); }
  const p = await Property.findOne(); const before = await restaurantSettings();
  const stored = { ...(p.settings?.restaurant || {}), ...b };
  p.set('settings.restaurant', stored); p.markModified('settings'); await p.save();
  const after = await restaurantSettings();
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'Settings', entityId: p._id, entityLabel: 'Restaurant settings (tax / payment methods / rules)', oldValue: before, newValue: after });
  ok(res, after);
});

/* ---- tables & reservations ---- */
const tableBody = z.object({ number: z.string().trim().min(1).max(12), section: z.string().trim().max(40).optional(), capacity: z.number().int().min(1).max(50), notes: z.string().max(200).optional(), sortOrder: z.number().int().optional() });
exports.listTables = wrap(async (req, res) => ok(res, await tables.listTables({ includeInactive: req.query.includeInactive === 'true' })));
exports.getTable = wrap(async (req, res) => ok(res, await tables.getTable(req.params.id)));
exports.createTable = wrap(async (req, res) => ok(res, await tables.createTable(req, parse(tableBody, req.body)), {}, 201));
exports.updateTable = wrap(async (req, res) => ok(res, await tables.updateTable(req, req.params.id, parse(tableBody.partial().extend({ active: z.boolean().optional(), outOfService: z.boolean().optional(), outOfServiceReason: z.string().max(200).optional() }), req.body))));
const resBody = z.object({ guestName: z.string().trim().min(1).max(80), phone: z.string().trim().max(20).optional(), guest: oid.optional(), partySize: z.number().int().min(1).max(50), table: oid, startsAt: z.string().min(10), durationMinutes: z.number().int().min(15).max(480).optional(), notes: z.string().max(300).optional() });
exports.listReservations = wrap(async (req, res) => ok(res, await tables.listReservations(req.query)));
exports.createReservation = wrap(async (req, res) => ok(res, await tables.createReservation(req, parse(resBody, req.body)), {}, 201));
exports.updateReservation = wrap(async (req, res) => ok(res, await tables.updateReservation(req, req.params.id, parse(resBody.partial(), req.body))));
exports.cancelReservation = wrap(async (req, res) => ok(res, await tables.cancelReservation(req, req.params.id, parse(z.object({ reason: z.string().trim().min(3, 'Enter a reason') }), req.body).reason)));
exports.noShowReservation = wrap(async (req, res) => ok(res, await tables.noShowReservation(req, req.params.id)));
exports.seatReservation = wrap(async (req, res) => ok(res, await tables.seatReservation(req, req.params.id)));
exports.completeReservation = wrap(async (req, res) => ok(res, await tables.completeReservation(req, req.params.id)));

/* ---- menu ---- */
exports.posMenu = wrap(async (_req, res) => ok(res, await menu.posMenu()));
exports.listCategories = wrap(async (req, res) => ok(res, await menu.listCategories({ all: req.query.all === 'true' })));
exports.createCategory = wrap(async (req, res) => ok(res, await menu.createCategory(req, parse(z.object({ name: z.string().trim().min(1).max(40), sortOrder: z.number().int().optional() }), req.body)), {}, 201));
exports.updateCategory = wrap(async (req, res) => ok(res, await menu.updateCategory(req, req.params.id, parse(z.object({ name: z.string().trim().min(1).max(40).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }), req.body))));
const itemBody = z.object({ code: z.string().trim().max(12).optional().or(z.literal('')), name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), category: oid, price: money.refine((n) => n >= 0 && n <= 100000, 'Enter a price between 0 and 1,00,000'), taxable: z.boolean().optional(), isVeg: z.boolean().nullable().optional(), available: z.boolean().optional() });
exports.listItems = wrap(async (req, res) => ok(res, await menu.listItems(req.query)));
exports.getItem = wrap(async (req, res) => ok(res, await menu.getItem(req.params.id)));
exports.createItem = wrap(async (req, res) => ok(res, await menu.createItem(req, parse(itemBody, req.body)), {}, 201));
exports.updateItem = wrap(async (req, res) => ok(res, await menu.updateItem(req, req.params.id, parse(itemBody.partial().omit({ available: true }).extend({ active: z.boolean().optional() }), req.body))));
exports.setAvailability = wrap(async (req, res) => { const b = parse(z.object({ available: z.boolean(), reason: z.string().max(120).optional() }), req.body); ok(res, await menu.setAvailability(req, req.params.id, b.available, b.reason)); });
exports.resetAvailability = wrap(async (req, res) => ok(res, await menu.resetAvailability(req)));

/* ---- orders & tickets ---- */
const line = z.object({ menuItem: oid, quantity: z.number().int().min(1).max(500), notes: z.string().max(200).optional() });
const orderBody = z.object({
  type: z.enum(['Dine-in', 'Takeaway', 'Delivery', 'Room Service']), items: z.array(line).min(1).max(60), notes: z.string().max(300).optional(), send: z.boolean().optional(),
  table: oid.optional(), covers: z.number().int().min(1).max(50).optional(), reservation: oid.optional(),
  customer: z.object({ name: z.string().max(80).optional(), phone: z.string().max(20).optional() }).optional(),
  delivery: z.object({ contactName: z.string().max(80).optional(), phone: z.string().max(20).optional(), address: z.string().max(250).optional(), landmark: z.string().max(100).optional(), instructions: z.string().max(200).optional() }).optional(),
  stayReservation: oid.optional(), roomNumber: z.string().max(10).optional(),
}); // NB: no price, total, status or billing field is accepted - unknown keys are stripped by zod
exports.inHouse = wrap(async (req, res) => ok(res, await orders.inHouse(req.query.q)));
exports.listOrders = wrap(async (req, res) => { const r = await orders.listOrders(req.query); res.json({ success: true, ...r }); });
exports.getOrder = wrap(async (req, res) => ok(res, await orders.getOrder(req.params.id)));
exports.createOrder = wrap(async (req, res) => { const b = parse(orderBody, req.body); const { order, replayed } = await orders.createOrder(req, { ...b, idempotencyKey: needKey(req, 'place an order') }); ok(res, order, { replayed }, replayed ? 200 : 201); });
exports.updateOrder = wrap(async (req, res) => ok(res, await orders.updateDetails(req, req.params.id, parse(orderBody.pick({ notes: true, covers: true, customer: true, delivery: true }), req.body))));
exports.addItems = wrap(async (req, res) => ok(res, await orders.addItems(req, req.params.id, parse(z.object({ items: z.array(line).min(1).max(60) }), req.body).items)));
exports.updateItem2 = wrap(async (req, res) => ok(res, await orders.updateItem(req, req.params.id, req.params.itemId, parse(z.object({ quantity: z.number().int().min(1).max(500).optional(), notes: z.string().max(200).optional() }), req.body))));
exports.removeItem = wrap(async (req, res) => ok(res, await orders.removeItem(req, req.params.id, req.params.itemId, parse(z.object({ reason: z.string().max(200).optional() }), req.body || {}).reason)));
exports.send = wrap(async (req, res) => { const r = await orders.sendToKitchen(req, req.params.id); ok(res, r.order, { ticket: r.ticket, replayed: r.replayed }); });
exports.serve = wrap(async (req, res) => ok(res, await orders.serveOrder(req, req.params.id)));
exports.cancelOrder = wrap(async (req, res) => ok(res, await orders.cancelOrder(req, req.params.id, parse(z.object({ reason: z.string().trim().min(3, 'Enter a reason') }), req.body).reason)));
exports.transfer = wrap(async (req, res) => ok(res, await orders.transferOrder(req, req.params.id, parse(z.object({ table: oid }), req.body).table)));
exports.listTickets = wrap(async (req, res) => ok(res, await orders.listTickets(req.query)));
exports.ticketStatus = wrap(async (req, res) => { const r = await orders.advanceTicket(req, req.params.id, parse(z.object({ status: z.enum(['Preparing', 'Ready', 'Served']) }), req.body).status); ok(res, r.ticket, { order: r.order }); });

/* ---- billing ---- */
exports.listBills = wrap(async (req, res) => { const r = await billing.listBills(req.query); res.json({ success: true, ...r }); });
exports.getBill = wrap(async (req, res) => ok(res, await billing.getBill(req.params.id)));
exports.generateBills = wrap(async (req, res) => {
  const b = parse(z.object({ splits: z.array(z.object({ label: z.string().max(40).optional(), lines: z.array(z.object({ orderItem: oid, quantity: z.number().int().min(1) })).min(1) })).min(2).max(12).optional() }), req.body || {});
  const bills = await billing.generateBills(req, req.params.orderId, b); ok(res, bills, {}, 201);
});
exports.requestAdjustment = wrap(async (req, res) => {
  const b = parse(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('Discount'), mode: z.enum(['percent', 'amount']), value: z.number().positive().refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max 2 decimals'), reason: z.string().trim().min(3, 'Enter the reason') }),
    z.object({ kind: z.literal('Complimentary'), lines: z.array(z.object({ orderItem: oid, quantity: z.number().int().min(1) })).min(1), reason: z.string().trim().min(3, 'Enter the reason') }),
  ]), req.body);
  const r = await billing.requestAdjustment(req, req.params.id, b);
  res.status(202).json({ success: true, approvalRequired: true, data: r.bill, approval: r.approval, message: `${b.kind === 'Discount' ? 'Discount' : 'Complimentary item'} request sent for approval - it has no effect on the bill until approved` });
});
exports.finalise = wrap(async (req, res) => { const r = await billing.finaliseBill(req, req.params.id); ok(res, r.bill, { replayed: r.replayed, posting: r.posting, message: r.posting?.state === 'Failed' ? 'Bill finalised, but the room-service charge could not be posted yet. Fix the cause and retry posting.' : undefined }); });
exports.postToFolio = wrap(async (req, res) => ok(res, await billing.postBill(req, req.params.id)));
exports.addPayment = wrap(async (req, res) => {
  const b = parse(z.object({ amount: money.refine((n) => n > 0, 'Enter an amount greater than zero'), method: z.string().trim().min(1), reference: z.string().max(60).optional() }), req.body);
  const r = await billing.addPayment(req, req.params.id, { ...b, idempotencyKey: needKey(req, 'record a payment') });
  ok(res, r.bill, { payment: r.payment, replayed: r.replayed }, r.replayed ? 200 : 201);
});
exports.voidBill = wrap(async (req, res) => {
  const r = await billing.voidBill(req, req.params.id, parse(z.object({ reason: z.string().trim().min(3, 'Enter a reason') }), req.body).reason);
  res.status(r.approval ? 202 : 200).json({ success: true, approvalRequired: !!r.approval, data: r.bill, approval: r.approval, message: r.approval ? 'Void request sent for approval' : 'Draft bill voided' });
});
exports.listAdjustments = wrap(async (req, res) => ok(res, await billing.listAdjustments(req.query)));

/* ---- closing ---- */
exports.closingPreview = wrap(async (req, res) => ok(res, await closing.preview(parse(z.object({ date: date.optional() }), req.query).date || todayStr())));
exports.closeDay = wrap(async (req, res) => {
  const b = parse(z.object({ businessDate: date, acknowledge: z.array(z.string()).optional(), notes: z.string().max(500).optional() }), req.body);
  const r = await closing.close(req, { ...b, idempotencyKey: needKey(req, 'close the restaurant day') }); ok(res, r.closing, { replayed: r.replayed }, r.replayed ? 200 : 201);
});
exports.closings = wrap(async (_req, res) => ok(res, await closing.list()));
exports.closingFor = wrap(async (req, res) => ok(res, await closing.get(parse(date, req.params.date))));
exports.closingStatus = wrap(async (req, res) => ok(res, await closing.statusFor(parse(date, req.params.date))));
