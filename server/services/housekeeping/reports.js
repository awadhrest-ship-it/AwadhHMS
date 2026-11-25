/** Damage, missing-item and lost-and-found reports (Module 5.4). One collection, kind-specific lifecycles. */
const crypto = require('crypto');
const { HousekeepingReport, Attachment, Room, HousekeepingTask, Counter } = require('../../models');
const storage = require('../storage');
const { audit } = require('../audit');
const { notify } = require('../notify');
const { bad, conflict, notFound, forbidden } = require('../../utils/ApiError');
const { escapeRegex } = require('../../utils/wrap');
const tasks = require('./tasks');

const STATUSES = HousekeepingReport.STATUSES;
const INITIAL = { Damage: 'Reported', 'Missing Item': 'Reported', 'Lost & Found': 'Found' };
const TERMINAL = ['Closed', 'Returned', 'Disposed', 'Written Off'];
const PREFIX = { Damage: 'DMG', 'Missing Item': 'MIS', 'Lost & Found': 'LNF' };
const canManage = (req) => req.permissions.has('housekeeping.assign') || req.permissions.has('housekeeping.inspect');
const isDup = (e) => e && (e.code === 11000 || /E11000/.test(e.message || ''));
const pop = [{ path: 'room', select: 'roomNumber floor' }, { path: 'task', select: 'taskNumber' }];

async function create(req, b) {
  if (!STATUSES[b.kind]) throw bad('Choose Damage, Missing Item or Lost & Found');
  if (!b.clientKey || String(b.clientKey).length < 8) throw bad('clientKey is required (double-submit protection)');
  const clientKey = `${req.user._id}:${b.clientKey}`;
  const dup = await HousekeepingReport.findOne({ clientKey }); if (dup) return { report: dup, replayed: true };
  let room = b.room, task;
  if (b.task) { task = await HousekeepingTask.findById(b.task); if (!task) throw bad('Task not found'); if (!tasks.canViewAll(req) && !tasks.isAssignee(req, task)) throw notFound('Task not found'); room = room || task.room; }
  if (room && !(await Room.exists({ _id: room }))) throw bad('Room not found');
  if (!room && !(b.location || '').trim()) throw bad('Choose a room or describe where it happened');
  const doc = { kind: b.kind, title: b.title.trim(), description: b.description, room, task: task?._id, location: b.location, eventDate: b.eventDate ? new Date(b.eventDate) : new Date(), status: INITIAL[b.kind],
    severity: b.kind === 'Damage' ? b.severity || 'Minor' : undefined, quantity: b.kind === 'Missing Item' ? Number(b.quantity) || 1 : undefined, estimatedValue: b.estimatedValue,
    maintenance: b.kind === 'Damage' ? { required: !!b.maintenanceRequired } : undefined, storageLocation: b.storageLocation, identifyingMarks: b.identifyingMarks,
    history: [{ at: new Date(), status: INITIAL[b.kind], by: req.user._id, byName: req.user.name, note: 'Reported' }], reportedBy: req.user._id, reportedByName: req.user.name, clientKey };
  let r;
  try { r = await HousekeepingReport.create({ ...doc, reportNumber: `${PREFIX[b.kind]}-${await Counter.next(PREFIX[b.kind], 4)}` }); }
  catch (e) { if (isDup(e)) { const again = await HousekeepingReport.findOne({ clientKey }); if (again) return { report: again, replayed: true }; } throw e; }
  await audit(req, { action: 'create', module: 'Housekeeping', entity: 'HousekeepingReport', entityId: r._id, entityLabel: `${r.reportNumber} ${r.kind}: ${r.title}`, newValue: { kind: r.kind, room, severity: r.severity, value: r.estimatedValue } });
  if (b.kind !== 'Lost & Found' || r.estimatedValue >= 1) await notify({ type: 'hk_report', title: `${r.kind} reported${room ? ` · Room ${(await Room.findById(room).select('roomNumber').lean()).roomNumber}` : ''}`, message: `${r.reportNumber}: ${r.title}${r.severity ? ` (${r.severity})` : ''}`, link: `/housekeeping/reports?id=${r._id}`, severity: r.severity === 'Severe' ? 'urgent' : 'warning', permission: 'housekeeping.reports' });
  return { report: r, replayed: false };
}

function visible(req) { return canManage(req) || req.permissions.has('housekeeping.view') ? {} : { reportedBy: req.user._id }; }
async function list(req, q) {
  const f = { ...visible(req) }; if (q.kind) f.kind = q.kind; if (q.room) f.room = q.room; if (q.task) f.task = q.task;
  if (q.status === 'open') f.status = { $nin: TERMINAL }; else if (q.status) f.status = q.status;
  if (q.from || q.to) { f.createdAt = {}; if (q.from) f.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`); }
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); f.$or = [{ title: rx }, { reportNumber: rx }, { description: rx }, { identifyingMarks: rx }]; }
  return HousekeepingReport.find(f).populate(pop).sort({ createdAt: -1 }).limit(Math.min(500, Number(q.limit) || 200)).lean();
}
async function get(req, id) {
  const r = await HousekeepingReport.findOne({ _id: id, ...visible(req) }).populate(pop).lean(); if (!r) throw notFound('Report not found');
  r.photoList = await Attachment.find({ _id: { $in: r.photos || [] } }).select('kind caption mimeType size createdAt').lean();
  return r;
}
async function update(req, id, b) {
  if (!canManage(req)) throw forbidden('Only housekeeping managers and supervisors can update reports');
  const r = await HousekeepingReport.findById(id); if (!r) throw notFound('Report not found');
  if (TERMINAL.includes(r.status)) throw conflict(`This report is ${r.status.toLowerCase()} and can no longer be changed`);
  const before = { status: r.status };
  if (b.status && b.status !== r.status) {
    if (!STATUSES[r.kind].includes(b.status)) throw bad(`${b.status} is not a valid status for ${r.kind}`);
    if (r.kind === 'Lost & Found' && b.status === 'Returned') {
      const c = b.claim || {}; if (!c.name?.trim()) throw bad('Enter who collected the item'); if (!c.idChecked?.trim()) throw bad('Record the ID that was checked');
      r.claim = { name: c.name.trim(), phone: c.phone, idChecked: c.idChecked, notes: c.notes, returnedAt: new Date(), returnedBy: req.user._id, returnedByName: req.user.name };
    }
    if (r.kind === 'Lost & Found' && b.status === 'Disposed') { if (!(b.note || '').trim()) throw bad('A reason is required'); r.disposedReason = b.note.trim(); }
    if (['Written Off'].includes(b.status) && !(b.note || '').trim()) throw bad('A reason is required');
    r.status = b.status; r.history.push({ at: new Date(), status: b.status, note: b.note, by: req.user._id, byName: req.user.name });
  }
  for (const k of ['storageLocation', 'identifyingMarks', 'description', 'estimatedValue', 'severity']) if (b[k] !== undefined) r[k] = b[k];
  if (b.maintenanceRequired !== undefined && r.kind === 'Damage') r.maintenance = { ...(r.maintenance?.toObject?.() || {}), required: !!b.maintenanceRequired };
  await r.save();
  await audit(req, { action: 'status', module: 'Housekeeping', entity: 'HousekeepingReport', entityId: r._id, entityLabel: `${r.reportNumber} ${r.kind}`, oldValue: before, newValue: { status: r.status }, note: b.note });
  return get(req, id);
}
async function addPhoto(req, id) {
  const r = await HousekeepingReport.findOne({ _id: id, ...visible(req) }); if (!r) throw notFound('Report not found');
  if (TERMINAL.includes(r.status)) throw conflict('This report is closed');
  if ((r.photos || []).length >= 8) throw bad('A report can hold up to 8 photos');
  const mime = storage.validateImage(req.body, req.headers['content-type']);
  const key = await storage.store(req.body, mime);
  const att = await Attachment.create({ entityType: 'HousekeepingReport', entityId: r._id, kind: { Damage: 'damage', 'Missing Item': 'missing', 'Lost & Found': 'found' }[r.kind], caption: String(req.query.caption || '').slice(0, 120), mimeType: mime, size: req.body.length, storageKey: key, uploadedBy: req.user._id });
  r.photos.push(att._id); await r.save();
  return get(req, id);
}
module.exports = { STATUSES, TERMINAL, create, list, get, update, addPhoto };
