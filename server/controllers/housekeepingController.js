const { z } = require('zod');
const { wrap, parse } = require('../utils/wrap');
const { notFound, forbidden } = require('../utils/ApiError');
const hk = require('../services/housekeeping');
const { Attachment, HousekeepingTask, HousekeepingReport, InventoryItem } = require('../models');
const storage = require('../services/storage');
const settingsSvc = require('../services/settings');
const { audit } = require('../services/audit');
const { Property } = require('../models');

const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const priority = z.enum(['Normal', 'High', 'Urgent']);

exports.board = wrap(async (req, res) => ok(res, await hk.board(req)));
exports.staff = wrap(async (req, res) => ok(res, await hk.staff(req, { all: req.query.all === '1' })));
exports.list = wrap(async (req, res) => { const r = await hk.list(req, req.query); res.json({ success: true, ...r }); });
exports.get = wrap(async (req, res) => ok(res, await hk.load(req, req.params.id)));
exports.create = wrap(async (req, res) => {
  const b = parse(z.object({ room: oid, type: z.enum(['Manual', 'Stay-over']).optional(), priority: priority.optional(), notes: z.string().max(500).optional(), assignedTo: oid.optional() }), req.body);
  res.status(201).json({ success: true, data: await hk.createManual(req, b) });
});
exports.sync = wrap(async (req, res) => ok(res, await hk.syncDirtyRooms(req)));
exports.generateStayover = wrap(async (req, res) => ok(res, await hk.generateStayover(req, parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body || {}))));
exports.assign = wrap(async (req, res) => { const b = parse(z.object({ userId: oid, note: z.string().max(300).optional() }), req.body); ok(res, await hk.assign(req, req.params.id, b)); });
exports.update = wrap(async (req, res) => ok(res, await hk.update(req, req.params.id, parse(z.object({ priority: priority.optional(), notes: z.string().max(500).optional(), dueAt: z.string().optional() }), req.body))));
exports.cancel = wrap(async (req, res) => ok(res, await hk.cancel(req, req.params.id, parse(z.object({ reason: z.string().min(3).max(300) }), req.body).reason)));
exports.start = wrap(async (req, res) => ok(res, await hk.start(req, req.params.id)));
exports.toggle = wrap(async (req, res) => ok(res, await hk.toggleChecklist(req, req.params.id, req.params.itemId, parse(z.object({ done: z.boolean() }), req.body).done)));
exports.addItem = wrap(async (req, res) => res.status(201).json({ success: true, data: await hk.addChecklistItem(req, req.params.id, parse(z.object({ label: z.string().trim().min(1).max(100) }), req.body).label) }));
exports.removeItem = wrap(async (req, res) => ok(res, await hk.removeChecklistItem(req, req.params.id, req.params.itemId)));
exports.addPhoto = wrap(async (req, res) => ok(res, await hk.addPhoto(req, req.params.id, { kind: String(req.query.kind || ''), caption: String(req.query.caption || '').slice(0, 120) })));
exports.removePhoto = wrap(async (req, res) => ok(res, await hk.removePhoto(req, req.params.id, req.params.photoId)));
exports.submit = wrap(async (req, res) => ok(res, await hk.submit(req, req.params.id)));
exports.inspect = wrap(async (req, res) => {
  const b = parse(z.object({ result: z.enum(['Approved', 'Rejected']), reason: z.string().max(300).optional(), notes: z.string().max(500).optional(), failedItemIds: z.array(z.string()).max(50).optional() }), req.body);
  ok(res, await hk.inspect(req, req.params.id, b));
});
exports.inspections = wrap(async (req, res) => ok(res, await hk.inspections(req, req.query)));

/* supplies */
exports.supplyItems = wrap(async (req, res) => ok(res, await hk.supplies.pickList(req, String(req.query.kind || 'Linen Replacement'))));
exports.supplyUse = wrap(async (req, res) => {
  const b = parse(z.object({ kind: z.enum(['Linen Replacement', 'Toiletry Replacement', 'Cleaning Supplies']), item: oid, quantity: z.coerce.number().positive().max(100000), unit: z.string().max(20).optional(), room: oid.optional(), task: oid.optional(), notes: z.string().max(300).optional(), clientKey: z.string().min(8).max(80) }), req.body);
  const r = await hk.supplies.record(req, b); res.status(r.replayed ? 200 : 201).json({ success: true, data: r.use, replayed: r.replayed });
});
exports.supplyHistory = wrap(async (req, res) => ok(res, await hk.supplies.history(req, req.query)));
exports.stock = wrap(async (req, res) => ok(res, await hk.supplies.stockView(req)));

/* reports */
const repBody = z.object({ kind: z.enum(['Damage', 'Missing Item', 'Lost & Found']), title: z.string().trim().min(2).max(120), description: z.string().max(1000).optional(), room: oid.optional(), task: oid.optional(), location: z.string().max(120).optional(),
  eventDate: z.string().optional(), severity: z.enum(['Minor', 'Moderate', 'Severe']).optional(), quantity: z.coerce.number().positive().max(1000).optional(), estimatedValue: z.coerce.number().min(0).max(100000000).optional(),
  maintenanceRequired: z.boolean().optional(), storageLocation: z.string().max(120).optional(), identifyingMarks: z.string().max(200).optional(), clientKey: z.string().min(8).max(80) });
exports.createReport = wrap(async (req, res) => { const r = await hk.reports.create(req, parse(repBody, req.body)); res.status(r.replayed ? 200 : 201).json({ success: true, data: r.report, replayed: r.replayed }); });
exports.listReports = wrap(async (req, res) => ok(res, await hk.reports.list(req, req.query)));
exports.getReport = wrap(async (req, res) => ok(res, await hk.reports.get(req, req.params.id)));
exports.updateReport = wrap(async (req, res) => ok(res, await hk.reports.update(req, req.params.id, parse(z.object({ status: z.string().max(30).optional(), note: z.string().max(300).optional(), storageLocation: z.string().max(120).optional(), identifyingMarks: z.string().max(200).optional(), description: z.string().max(1000).optional(),
  estimatedValue: z.coerce.number().min(0).optional(), severity: z.enum(['Minor', 'Moderate', 'Severe']).optional(), maintenanceRequired: z.boolean().optional(), claim: z.object({ name: z.string().max(80), phone: z.string().max(30).optional(), idChecked: z.string().max(80), notes: z.string().max(300).optional() }).optional() }), req.body))));
exports.addReportPhoto = wrap(async (req, res) => ok(res, await hk.reports.addPhoto(req, req.params.id)));

exports.performance = wrap(async (req, res) => ok(res, await hk.performance(req, req.query)));

/* settings */
exports.getSettings = wrap(async (_req, res) => ok(res, await settingsSvc.housekeepingSettings()));
exports.updateSettings = wrap(async (req, res) => {
  const labels = z.array(z.string().trim().min(1).max(100)).min(1).max(40);
  const b = parse(z.object({ checklistTemplates: z.object({ checkout: labels.optional(), stayover: labels.optional() }).optional(), targetMinutes: z.object({ Checkout: z.number().int().min(5).max(480).optional(), 'Stay-over': z.number().int().min(5).max(480).optional(), Manual: z.number().int().min(5).max(480).optional() }).optional(),
    requireChecklistComplete: z.boolean().optional(), requirePhotos: z.boolean().optional(), inspectorMustDifferFromCleaner: z.boolean().optional(), stayoverNeedsInspection: z.boolean().optional(), priorityWhenArrivalToday: z.boolean().optional() }), req.body);
  const before = await settingsSvc.housekeepingSettings();
  const next = settingsSvc.merge(settingsSvc.HK_DEFAULTS, { ...before, ...b, checklistTemplates: { ...before.checklistTemplates, ...(b.checklistTemplates || {}) }, targetMinutes: { ...before.targetMinutes, ...(b.targetMinutes || {}) } });
  const p = await Property.findOne(); p.set('settings.housekeeping', next); p.markModified('settings'); await p.save();
  await audit(req, { action: 'update', module: 'Housekeeping', entity: 'Property', entityId: p._id, entityLabel: 'Housekeeping settings', oldValue: before, newValue: next });
  ok(res, next);
});

/* authenticated photo download: only people who may see the owning task / report */
exports.file = wrap(async (req, res) => {
  const a = await Attachment.findById(req.params.id); if (!a) throw notFound('File not found');
  let allowed = false;
  if (a.entityType === 'HousekeepingTask') { const t = await HousekeepingTask.findById(a.entityId).select('assignedTo cleanedBy'); allowed = !!t && (hk.canViewAll(req) || hk.isAssignee(req, t) || String(t.cleanedBy) === String(req.user._id)); }
  else { const r = await HousekeepingReport.findById(a.entityId).select('reportedBy'); allowed = !!r && (hk.canViewAll(req) || req.permissions.has('housekeeping.assign') || String(r.reportedBy) === String(req.user._id)); }
  if (!allowed) throw forbidden('You cannot view this file');
  let buf; try { buf = await storage.read(a.storageKey); } catch { throw notFound('File not found'); }
  res.set({ 'Content-Type': a.mimeType, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
  res.send(buf);
});
