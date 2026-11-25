const { z } = require('zod');
const { Property, Role, User, BarOrder, BarComplimentary, BarShift, BarVarianceAlert, BarMenuItem, BarBottleOpening } = require('../models');
const menu = require('../services/bar/menu');
const orders = require('../services/bar/orders');
const bottles = require('../services/bar/bottles');
const variance = require('../services/bar/variance');
const comp = require('../services/bar/comp');
const loss = require('../services/bar/loss');
const shifts = require('../services/bar/shifts');
const reports = require('../services/bar/reports');
const pricing = require('../services/bar/pricing');
const C = require('../services/bar/core');
const { barSettings, BAR_DEFAULTS, inventorySettings } = require('../services/settings');
const { audit } = require('../services/audit');
const { todayStr, startOfIstDay } = require('../utils/dates');
const { wrap, parse } = require('../utils/wrap');
const { bad } = require('../utils/ApiError');
require('../services/bar/approvalHandlers');          // registers the 'Complimentary drinks' approval handler
require('../services/inventory/approvalHandlers');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const ok = (res, data, extra = {}, status = 200) => res.status(status).json({ success: true, data, ...extra });
/** Query filters are validated before they reach the database (an invalid id must be a 400, never a crash). */
const query = (req) => parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), date: dateStr.optional(), item: oid.optional(), user: oid.optional(), shift: oid.optional(), status: z.string().max(30).optional(), kind: z.string().max(20).optional(),
  reason: z.string().max(100).optional(), open: z.string().max(5).optional(), onlyVariance: z.string().max(5).optional(), variance: z.string().max(5).optional(), limit: z.string().regex(/^\d+$/).optional(), q: z.string().max(60).optional(), category: z.string().max(40).optional(), active: z.string().max(5).optional() }).passthrough(), req.query);
const key = (req, what) => C.needKey(req, what);

/* ---- overview ---- */
exports.overview = wrap(async (req, res) => {
  const settings = await barSettings(); const day = startOfIstDay(todayStr()); const end = new Date(day.getTime() + 864e5); const can = (p) => req.permissions.has(p);
  const served = await BarOrder.find({ status: 'Served', servedAt: { $gte: day, $lt: end } }).select('total lines').lean();
  const inv = await bottles.inventory(); const menus = await menu.list({});
  const tol = variance.tolerance(settings); const rules = settings.happyHour.rules || [];
  ok(res, {
    today: { orders: served.length, drinks: served.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.quantity, 0), 0), sales: Math.round(served.reduce((s, o) => s + o.total, 0) * 100) / 100 },
    openOrders: await BarOrder.countDocuments({ status: 'Open' }), pendingComplimentary: await BarComplimentary.countDocuments({ status: 'Pending Approval' }), approvedToIssue: await BarComplimentary.countDocuments({ status: { $in: ['Approved', 'Issuing'] } }),
    openShifts: await BarShift.find({ status: { $in: ['Open', 'Closing'] } }).select('shiftNumber bartenderName startedAt').lean(),
    myShift: await shifts.current(req),
    unacknowledgedAlerts: can('bar.variance.view') ? await BarVarianceAlert.countDocuments({ acknowledgedAt: { $exists: false } }) : 0,
    liquor: inv.filter((i) => i.isLiquor).map((i) => ({ item: i.item, name: i.name, sealedBottles: i.sealedBottles, openedMl: i.openedMl, totalQty: i.totalQty, capacityConfigured: i.capacityConfigured })),
    menu: { total: menus.length, incomplete: menus.filter((m) => m.consumptionStatus === 'Incomplete').map((m) => ({ _id: m._id, name: m.name, problems: m.consumptionProblems })) },
    config: { happyHourConfigured: rules.some((r) => r.active !== false), varianceToleranceConfigured: tol.configured, varianceRecipientsConfigured: (settings.variance.recipients.roles.length + settings.variance.recipients.users.length) > 0, shiftDefinitionsConfigured: settings.shifts.definitions.length > 0, billingDestination: settings.billing.mode || null },
  });
});

/* ---- settings ---- */
exports.getSettings = wrap(async (_req, res) => ok(res, await barSettings(), { defaults: BAR_DEFAULTS, provisional: ['happyHour', 'variance.toleranceMl', 'variance.tolerancePercent', 'variance.toleranceOther', 'variance.recipients', 'shifts', 'billing'],
  recipientRoles: await Role.find({ department: { $in: ['Bar', 'Management', 'Stores'] } }).select('key name').sort({ name: 1 }).lean(), stockDepartments: (await inventorySettings()).stockDepartments, measures: ['30 ml', '60 ml', 'Full bottle'] }));
const nz = z.number().min(0).max(1e6).nullable();
exports.updateSettings = wrap(async (req, res) => {
  const b = parse(z.object({
    department: z.string().max(30).optional(), liquorCategories: z.array(z.string().trim().min(1).max(40)).min(1).max(10).optional(), trackedCategories: z.array(z.string().trim().min(1).max(40)).min(1).max(10).optional(),
    pegMl: z.number().int().min(5).max(200).optional(), autoOpenBottles: z.boolean().optional(), allowSalesWithoutConsumption: z.boolean().optional(), requireOpenShift: z.boolean().optional(),
    happyHour: z.object({ rules: z.array(z.object({}).passthrough()).max(20) }).optional(),
    variance: z.object({ toleranceMl: nz.optional(), tolerancePercent: z.number().min(0).max(100).nullable().optional(), toleranceOther: nz.optional(), recipients: z.object({ roles: z.array(z.string().trim().min(1).max(40)).max(20).optional(), users: z.array(oid).max(30).optional() }).optional() }).optional(),
    shifts: z.object({ definitions: z.array(z.object({ name: z.string().trim().min(2).max(40), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() })).max(10) }).optional(),
    wastageReasons: z.array(z.string().trim().min(2).max(40)).min(1).max(30).optional(), breakageReasons: z.array(z.string().trim().min(2).max(40)).min(1).max(30).optional(),
    billing: z.object({ note: z.string().max(300).optional(), mode: z.null().optional() }).optional(),
  }), req.body);
  if (b.department && !(await inventorySettings()).stockDepartments.includes(b.department)) throw bad('That is not a stock department');
  if (b.happyHour) b.happyHour = { rules: pricing.validateRules(b.happyHour.rules) };
  if (b.variance?.recipients?.roles) { const have = new Set((await Role.find({ key: { $in: b.variance.recipients.roles } }).select('key').lean()).map((r) => r.key)); const miss = b.variance.recipients.roles.filter((x) => !have.has(x)); if (miss.length) throw bad(`Unknown role: ${miss.join(', ')}`); }
  if (b.shifts) { const names = b.shifts.definitions.map((d) => d.name.toLowerCase()); if (new Set(names).size !== names.length) throw bad('Shift names must be different'); }
  for (const k of ['wastageReasons', 'breakageReasons']) if (b[k]) { b[k] = [...new Set(b[k])]; if (!b[k].includes('Other')) b[k].push('Other'); }
  const p = await Property.findOne(); const before = await barSettings(); const stored = { ...(p.settings?.bar || {}) };
  const REPLACE = new Set(['rules', 'definitions', 'roles', 'users']);
  const deep = (a = {}, v = {}) => { const o = { ...a }; for (const [k, x] of Object.entries(v)) o[k] = x && typeof x === 'object' && !Array.isArray(x) && !REPLACE.has(k) ? deep(a[k], x) : x; return o; };
  for (const [k, v] of Object.entries(b)) stored[k] = v && typeof v === 'object' && !Array.isArray(v) ? deep(stored[k], v) : v;   // scalars and arrays replace; only objects merge
  p.set('settings.bar', stored); p.markModified('settings'); await p.save();
  const after = await barSettings();
  await audit(req, { action: 'update', module: 'Bar', entity: 'Settings', entityId: p._id, entityLabel: 'Bar settings (happy hour / variance / shifts / rules)', oldValue: before, newValue: after });
  ok(res, after);
});

/* ---- menu ---- */
exports.menuList = wrap(async (req, res) => ok(res, await menu.list(query(req))));
exports.menuGet = wrap(async (req, res) => ok(res, await menu.get(req.params.id)));
exports.menuCreate = wrap(async (req, res) => ok(res, await menu.create(req, req.body), {}, 201));
exports.menuUpdate = wrap(async (req, res) => ok(res, await menu.update(req, req.params.id, req.body)));
exports.menuAvailable = wrap(async (req, res) => ok(res, await menu.setAvailable(req, req.params.id, parse(z.object({ available: z.boolean() }), req.body).available)));
exports.liquorItems = wrap(async (_req, res) => ok(res, await menu.liquorItems()));
exports.setCapacity = wrap(async (req, res) => ok(res, await menu.setCapacity(req, req.params.itemId, parse(z.object({ capacityMl: z.number() }), req.body).capacityMl)));

/* ---- orders ---- */
exports.ordersList = wrap(async (req, res) => ok(res, await orders.list(query(req))));
exports.orderGet = wrap(async (req, res) => ok(res, await orders.get(req.params.id)));
exports.orderCreate = wrap(async (req, res) => { const r = await orders.create(req, req.body, key(req, 'create a drink order')); ok(res, r.order, { replayed: r.replayed }, r.replayed ? 200 : 201); });
exports.orderLines = wrap(async (req, res) => ok(res, await orders.replaceLines(req, req.params.id, req.body)));
exports.orderServe = wrap(async (req, res) => ok(res, await orders.serve(req, req.params.id)));
exports.orderCancel = wrap(async (req, res) => ok(res, await orders.cancel(req, req.params.id, req.body?.reason)));

/* ---- bottle & peg-wise inventory ---- */
exports.inventory = wrap(async (_req, res) => ok(res, await bottles.inventory()));
exports.openings = wrap(async (req, res) => ok(res, await bottles.list(query(req))));
exports.openBottle = wrap(async (req, res) => { const b = parse(z.object({ item: oid, bottles: z.number().int().min(1).max(50), notes: z.string().max(300).optional() }), req.body);
  const r = await bottles.open(req, { ...b, idempotencyKey: key(req, 'record a bottle opening') }); ok(res, r.opening, { replayed: r.replayed }, r.replayed ? 200 : 201); });

/* ---- variance ---- */
exports.expected = wrap(async (req, res) => ok(res, await variance.expectedNow(req.query.items ? String(req.query.items).split(',').filter((x) => /^[a-f\d]{24}$/i.test(x)) : undefined)));
exports.reconList = wrap(async (req, res) => ok(res, await variance.list(query(req))));
exports.reconGet = wrap(async (req, res) => ok(res, await variance.get(req.params.id)));
exports.reconRecord = wrap(async (req, res) => { const r = await variance.record(req, req.body, key(req, 'record a stock count')); ok(res, r.reconciliation, { replayed: r.replayed, alertsRaised: r.alerts }, r.replayed ? 200 : 201); });
exports.reconAdjust = wrap(async (req, res) => ok(res, await variance.requestAdjustment(req, req.params.id, req.params.lineId, parse(z.object({ note: z.string().max(200).optional() }), req.body || {}))));
exports.alerts = wrap(async (req, res) => ok(res, await variance.listAlerts(query(req))));
exports.alertAck = wrap(async (req, res) => ok(res, await variance.acknowledge(req, req.params.id)));

/* ---- complimentary ---- */
exports.compList = wrap(async (req, res) => ok(res, await comp.list(query(req))));
exports.compRequest = wrap(async (req, res) => { const r = await comp.request(req, req.body, key(req, 'request a complimentary drink')); ok(res, r.request, { replayed: r.replayed }, r.replayed ? 200 : 201); });
exports.compIssue = wrap(async (req, res) => { const r = await comp.issue(req, req.params.id); ok(res, r.request, { replayed: r.replayed }); });
exports.compCancel = wrap(async (req, res) => ok(res, await comp.cancel(req, req.params.id)));

/* ---- wastage & breakage ---- */
exports.lossList = (kind) => wrap(async (req, res) => ok(res, await loss.list({ ...query(req), kind })));
exports.lossRecord = (kind) => wrap(async (req, res) => { const r = await loss.record(req, kind, req.body, key(req, `record ${kind.toLowerCase()}`)); ok(res, r.record, { replayed: r.replayed }, r.replayed ? 200 : 201); });
exports.lossNote = wrap(async (req, res) => ok(res, await loss.addendum(req, req.params.id, req.body?.note)));
exports.lossReasons = wrap(async (_req, res) => { const s = await barSettings(); ok(res, { wastage: s.wastageReasons, breakage: s.breakageReasons }); });

/* ---- shifts ---- */
exports.shiftCurrent = wrap(async (req, res) => ok(res, await shifts.current(req)));
exports.shiftList = wrap(async (req, res) => ok(res, await shifts.list(req, query(req))));
exports.shiftGet = wrap(async (req, res) => ok(res, await shifts.get(req, req.params.id)));
exports.shiftStart = wrap(async (req, res) => ok(res, await shifts.start(req, parse(z.object({ definition: z.string().max(40).optional(), notes: z.string().max(300).optional() }), req.body || {})), {}, 201));
exports.shiftSheet = wrap(async (req, res) => ok(res, await shifts.closingSheet(req, req.params.id)));
exports.shiftClose = wrap(async (req, res) => ok(res, await shifts.close(req, req.params.id, parse(z.object({ counts: z.array(z.object({}).passthrough()).min(1).max(200), notes: z.string().max(400).optional() }), req.body))));
exports.shiftCorrect = wrap(async (req, res) => ok(res, await shifts.correct(req, req.params.id, parse(z.object({ reason: z.string().max(300), counts: z.array(z.object({}).passthrough()).min(1).max(200) }), req.body))));

/* ---- reports ---- */
exports.repLiquor = wrap(async (_req, res) => ok(res, await reports.liquorStock()));
exports.repOpeningClosing = wrap(async (req, res) => ok(res, await reports.openingClosing(query(req))));
exports.repConsumption = wrap(async (req, res) => ok(res, await reports.consumption(query(req))));
exports.repVariance = wrap(async (req, res) => ok(res, await reports.variance(query(req))));
exports.repComp = wrap(async (req, res) => ok(res, await reports.complimentary(query(req))));
exports.repLoss = (kind) => wrap(async (req, res) => ok(res, await reports.loss(kind, query(req))));
exports.repShifts = wrap(async (req, res) => ok(res, await reports.shiftClosing(req, query(req))));
exports.repDaily = wrap(async (req, res) => ok(res, await reports.dailySummary(query(req))));
exports.staff = wrap(async (_req, res) => ok(res, await User.find({ active: true, department: 'Bar' }).select('name').sort({ name: 1 }).lean()));
