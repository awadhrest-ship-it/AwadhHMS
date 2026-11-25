const { z } = require('zod');
const { Property, Role, KitchenTicket, KitchenConsumption, KitchenDelayAlert, MenuItem } = require('../models');
const tickets = require('../services/kitchen/tickets');
const delays = require('../services/kitchen/delays');
const stations = require('../services/kitchen/stations');
const recipes = require('../services/kitchen/recipes');
const consumption = require('../services/kitchen/consumption');
const wastage = require('../services/kitchen/wastage');
const prep = require('../services/kitchen/prep');
const performance = require('../services/kitchen/performance');
const prepSvc = prep; const C = require('../services/kitchen/core');
const { kitchenSettings, KITCHEN_DEFAULTS, inventorySettings } = require('../services/settings');
const prepReport = require('../services/kitchen/prep');
const { audit } = require('../services/audit');
const { todayStr } = require('../utils/dates');
const { wrap, parse } = require('../utils/wrap');
const { bad } = require('../utils/ApiError');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const station = z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor', 'Unassigned']);
const ok = (res, data, extra = {}, status = 200) => res.status(status).json({ success: true, data, ...extra });
const keyOf = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const needKey = (req, what) => { const k = keyOf(req); if (!k || String(k).length < 8) throw bad(`An Idempotency-Key (header or "idempotencyKey") of at least 8 characters is required to ${what}, so a retry can never be applied twice`); return String(k).slice(0, 80); };

/* ---- display & tickets ---- */
exports.board = wrap(async (req, res) => { delays.sweepThrottled().catch(() => {}); ok(res, await tickets.board(req, req.query)); });
exports.getTicket = wrap(async (req, res) => ok(res, await tickets.getTicket(req, req.params.id)));
exports.itemsStatus = wrap(async (req, res) => {
  const b = parse(z.object({ to: z.enum(['Preparing', 'Ready']), itemIds: z.array(oid).min(1).optional(), station: station.optional() }).refine((x) => x.itemIds || x.station, 'Choose a station or items'), req.body);
  ok(res, await tickets.transition(req, req.params.id, b));
});
exports.assign = wrap(async (req, res) => ok(res, await tickets.assign(req, req.params.id, parse(z.object({ userId: oid, station: station.optional() }), req.body))));
exports.unassign = wrap(async (req, res) => ok(res, await tickets.unassign(req, req.params.id, parse(z.object({ userId: oid, station: station.optional() }), req.body))));
exports.claim = wrap(async (req, res) => ok(res, await tickets.claim(req, req.params.id, parse(z.object({ station: station.optional() }), req.body || {}))));
exports.itemStation = wrap(async (req, res) => ok(res, await tickets.reassignStation(req, req.params.id, req.params.itemId, parse(z.object({ station: z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor']) }), req.body).station)));
exports.staff = wrap(async (_req, res) => ok(res, await tickets.staff()));

/* ---- overview ---- */
exports.overview = wrap(async (req, res) => {
  const today = todayStr(); const sc = C.scopeFor(req);
  const [b, failed, pending, unassigned, openAlerts, noRecipe] = await Promise.all([tickets.board(req, { recent: 'false' }), KitchenConsumption.countDocuments({ status: { $in: ['Failed', 'Pending'] } }), KitchenConsumption.countDocuments({ status: 'Pending' }), MenuItem.countDocuments({ active: true, $or: [{ station: null }, { station: { $exists: false } }] }), KitchenDelayAlert.countDocuments({ resolvedAt: null }), recipes.menuWithoutRecipe()]);
  const out = { today, totals: b.totals, counts: b.counts, stations: b.stations, unavailable: b.unavailable, unassignedMenuItems: unassigned, openDelayAlerts: openAlerts, consumptionNeedsAttention: failed, consumptionPending: pending, menuWithoutRecipe: noRecipe.length, scope: sc };
  if (req.permissions.has('kitchen.wastage.view')) { const w = await wastage.report({ from: today, to: today }); out.wastageToday = { records: w.totals.records, cost: w.totals.cost, costComplete: w.totals.costComplete }; }
  if (req.permissions.has('kitchen.prep.work') || req.permissions.has('kitchen.prep.manage')) { const l = await prep.byDate(today); out.prepToday = l ? { _id: l._id, progress: l.progress } : null; }
  ok(res, out);
});

/* ---- settings ---- */
exports.getSettings = wrap(async (_req, res) => ok(res, await kitchenSettings(), { defaults: KITCHEN_DEFAULTS, stations: C.STATIONS, orderTypes: ['Dine-in', 'Takeaway', 'Delivery', 'Room Service'],
  provisional: ['delay.defaultMinutes', 'delay.stationMinutes', 'recipients', 'escalation', 'performance'], recipientRoles: (await Role.find({ department: { $in: ['Kitchen', 'Restaurant', 'Management', 'Stores'] } }).select('key name').sort({ name: 1 }).lean()) }));
const mins = z.number().int().min(1).max(480); const roleKeys = z.array(z.string().trim().min(1).max(40)).max(20); const userIds = z.array(oid).max(30);
exports.updateSettings = wrap(async (req, res) => {
  const b = parse(z.object({
    delay: z.object({ enabled: z.boolean().optional(), defaultMinutes: mins.optional(), stationMinutes: z.record(z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor']), mins).optional(), orderTypeThresholdsEnabled: z.boolean().optional(), orderTypeMinutes: z.record(z.enum(['Dine-in', 'Takeaway', 'Delivery', 'Room Service']), mins).optional() }).optional(),
    recipients: z.object({ roles: roleKeys.optional(), users: userIds.optional() }).optional(),
    escalation: z.object({ enabled: z.boolean().optional(), afterMinutes: mins.optional(), roles: roleKeys.optional(), users: userIds.optional() }).optional(),
    wastageReasons: z.array(z.string().trim().min(2).max(40)).min(1).max(30).optional(),
    consumption: z.object({ autoConsume: z.boolean().optional(), department: z.string().max(30).optional(), enabledFrom: z.string().datetime().nullable().optional() }).optional(),
    prep: z.object({ referenceDays: z.number().int().min(1).max(60).optional() }).optional(),
    performance: z.object({ onTimeUsesDelayThreshold: z.boolean().optional(), composite: z.object({ enabled: z.boolean().optional(), onTimeWeight: z.number().min(0).max(100).optional(), taskWeight: z.number().min(0).max(100).optional() }).optional() }).optional(),
    board: z.object({ pollSeconds: z.number().int().min(3).max(60).optional(), newHighlightSeconds: z.number().int().min(10).max(900).optional() }).optional(),
  }), req.body);
  if (b.wastageReasons) { b.wastageReasons = [...new Set(b.wastageReasons)]; if (!b.wastageReasons.includes('Other')) b.wastageReasons.push('Other'); }
  for (const k of ['roles']) for (const sec of [b.recipients, b.escalation]) if (sec?.[k]) { const have = new Set((await Role.find({ key: { $in: sec[k] } }).select('key').lean()).map((r) => r.key)); const miss = sec[k].filter((x) => !have.has(x)); if (miss.length) throw bad(`Unknown role: ${miss.join(', ')}`); }
  if (b.consumption?.department && !(await inventorySettings()).stockDepartments.includes(b.consumption.department)) throw bad('That is not a stock department');
  const p = await Property.findOne(); const before = await kitchenSettings(); const stored = { ...(p.settings?.kitchen || {}) };
  const REPLACE = new Set(['stationMinutes', 'orderTypeMinutes']);       // maps the user edits as a whole (so an entry can be removed); everything else merges recursively
  const deep = (a = {}, v = {}) => { const o = { ...a }; for (const [k, x] of Object.entries(v)) o[k] = x && typeof x === 'object' && !Array.isArray(x) && !REPLACE.has(k) ? deep(a[k], x) : x; return o; };
  for (const [k, v] of Object.entries(b)) stored[k] = Array.isArray(v) ? v : deep(stored[k], v);
  p.set('settings.kitchen', stored); p.markModified('settings'); await p.save();
  const after = await kitchenSettings();
  await audit(req, { action: 'update', module: 'Kitchen', entity: 'Settings', entityId: p._id, entityLabel: 'Kitchen settings (delay thresholds / alert recipients / rules)', oldValue: before, newValue: after });
  ok(res, after);
});
exports.delays = wrap(async (req, res) => ok(res, await delays.list(req.query)));
exports.sweepDelays = wrap(async (_req, res) => { delays.resetThrottle(); ok(res, await delays.sweep()); });

/* ---- stations ---- */
exports.menu = wrap(async (req, res) => ok(res, await stations.listMenu(req.query)));
exports.setStation = wrap(async (req, res) => { const b = parse(z.object({ station: z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor']).nullable() }), req.body); ok(res, await stations.setStation(req, req.params.id, b.station)); });
exports.bulkStations = wrap(async (req, res) => ok(res, await stations.bulk(req, parse(z.object({ items: z.array(z.object({ menuItem: oid, station: z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor']).nullable() })).min(1).max(200) }), req.body).items)));

/* ---- recipes ---- */
const ing = z.object({ item: oid, quantity: z.number().positive().max(1e7), unit: z.string().trim().min(1).max(16).optional(), note: z.string().max(120).optional() });
const recipeBody = z.object({ menuItem: oid, name: z.string().trim().max(120).optional(), description: z.string().max(1000).optional(), instructions: z.string().max(4000).optional(), yield: z.object({ quantity: z.number().positive().max(10000), label: z.string().trim().max(30).optional() }).optional(), ingredients: z.array(ing).min(1).max(60), active: z.boolean().optional() });
exports.listRecipes = wrap(async (req, res) => ok(res, await recipes.listRecipes(req.query)));
exports.getRecipe = wrap(async (req, res) => ok(res, await recipes.getRecipe(req.params.id)));
exports.recipeVersions = wrap(async (req, res) => ok(res, await recipes.versions(req.params.id)));
exports.createRecipe = wrap(async (req, res) => ok(res, await recipes.createRecipe(req, parse(recipeBody, req.body)), {}, 201));
exports.updateRecipe = wrap(async (req, res) => ok(res, await recipes.updateRecipe(req, req.params.id, parse(recipeBody.omit({ menuItem: true }).partial().extend({ changeNote: z.string().max(200).optional() }), req.body))));
exports.recipeActive = wrap(async (req, res) => { const b = parse(z.object({ active: z.boolean(), reason: z.string().max(200).optional() }), req.body); ok(res, await recipes.setActive(req, req.params.id, b.active, b.reason)); });
exports.ingredients = wrap(async (req, res) => ok(res, await recipes.ingredientPicker(req.query)));
exports.menuWithoutRecipe = wrap(async (_req, res) => ok(res, await recipes.menuWithoutRecipe()));

/* ---- consumption ---- */
exports.listConsumption = wrap(async (req, res) => { const r = await consumption.list(req.query); res.json({ success: true, ...r }); });
exports.getConsumption = wrap(async (req, res) => ok(res, await consumption.get(req.params.id)));
exports.retryConsumption = wrap(async (req, res) => ok(res, await consumption.retry(req, req.params.id)));
exports.waiveConsumption = wrap(async (req, res) => ok(res, await consumption.waive(req, req.params.id, parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body).reason)));
exports.foodCost = wrap(async (req, res) => ok(res, await consumption.foodCostReport(req.query)));

/* ---- wastage ---- */
const wasteBody = z.object({ kind: z.enum(['ingredient', 'dish']), item: oid.optional(), menuItem: oid.optional(), quantity: z.number().positive().max(1e7), unit: z.string().trim().max(16).optional(), station: z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor']).optional(), reason: z.string().trim().min(2).max(40), notes: z.string().max(300).optional(), occurredAt: z.string().optional(), order: oid.optional(), orderNumber: z.string().max(20).optional(), prepList: oid.optional(), prepTask: oid.optional() })
  .refine((x) => (x.kind === 'ingredient' ? !!x.item : !!x.menuItem), 'Choose the ingredient or dish that was wasted');
exports.recordWastage = wrap(async (req, res) => { const k = needKey(req, 'record wastage'); const r = await wastage.record(req, parse(wasteBody, req.body), k); ok(res, r.wastage, { replayed: r.replayed }, r.replayed ? 200 : 201); });
exports.listWastage = wrap(async (req, res) => { const r = await wastage.list(req.query); res.json({ success: true, ...r }); });
exports.wastageReport = wrap(async (req, res) => ok(res, await wastage.report(req.query)));
exports.wastageNotes = wrap(async (req, res) => ok(res, await wastage.updateNotes(req, req.params.id, parse(z.object({ notes: z.string().max(300) }), req.body).notes)));

/* ---- preparation lists ---- */
const task = z.object({ menuItem: oid.optional(), title: z.string().trim().max(120).optional(), station: z.enum(['Main kitchen', 'Indian', 'Chinese', 'Tandoor']).optional(), plannedQty: z.number().min(0).max(100000), unit: z.string().trim().max(20).optional(), assignedTo: oid.optional(), instructions: z.string().max(400).optional() });
exports.listPrep = wrap(async (_req, res) => ok(res, await prep.list()));
exports.prepByDate = wrap(async (req, res) => ok(res, await prep.byDate(parse(date, req.params.date))));
exports.getPrep = wrap(async (req, res) => ok(res, await prep.get(req.params.id)));
exports.createPrep = wrap(async (req, res) => ok(res, await prep.create(req, parse(z.object({ businessDate: date.optional(), title: z.string().max(80).optional(), notes: z.string().max(500).optional(), tasks: z.array(task).max(100).optional() }), req.body)), {}, 201));
exports.updatePrep = wrap(async (req, res) => ok(res, await prep.update(req, req.params.id, parse(z.object({ title: z.string().max(80).optional(), notes: z.string().max(500).optional() }), req.body))));
exports.addPrepTask = wrap(async (req, res) => ok(res, await prep.addTask(req, req.params.id, parse(task, req.body)), {}, 201));
exports.updatePrepTask = wrap(async (req, res) => ok(res, await prep.updateTask(req, req.params.id, req.params.taskId, parse(task.partial().extend({ actualQty: z.number().min(0).nullable().optional(), remainingQty: z.number().min(0).nullable().optional(), status: z.enum(['Pending', 'In Progress', 'Completed']).optional() }), req.body))));
exports.removePrepTask = wrap(async (req, res) => ok(res, await prep.removeTask(req, req.params.id, req.params.taskId)));
exports.prepReference = wrap(async (req, res) => ok(res, await prep.reference(req.query.date || todayStr())));

/* ---- performance ---- */
exports.performance = wrap(async (req, res) => ok(res, await performance.dashboard({ from: req.query.from, to: req.query.to, station: req.query.station })));
