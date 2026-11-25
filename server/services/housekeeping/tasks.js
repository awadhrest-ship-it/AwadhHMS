/**
 * Housekeeping tasks (Modules 5.1 & 5.2).
 *
 * Room workflow (enforced here, in the backend):
 *   check-out -> Vacant & Dirty -> [assign] -> start: Cleaning in Progress -> submit: Inspection Pending
 *   -> supervisor inspection -> approve: Vacant & Clean   |   reject: back to Cleaning in Progress with the reason
 * Only inspect() can move a room from the cleaning cycle to Vacant & Clean. Blocked / Out of Order / Maintenance Required rooms are never
 * touched by an approval. Every state change is a conditional update on the current status, so two requests racing for the same
 * transition cannot both win, and task creation is idempotent through a unique sourceKey.
 */
const crypto = require('crypto');
const { HousekeepingTask, RoomInspection, Room, Reservation, User, Attachment, Counter } = require('../../models');
const { setRoomStatus } = require('../roomStatus');
const { audit } = require('../audit');
const { notify } = require('../notify');
const events = require('../events');
const storage = require('../storage');
const { housekeepingSettings } = require('../settings');
const { bad, conflict, forbidden, notFound } = require('../../utils/ApiError');
const { escapeRegex } = require('../../utils/wrap');
const { today, toDate, todayStr, addDays } = require('../../utils/dates');

const { OPEN } = HousekeepingTask;
const CYCLE = ['Vacant & Dirty', 'Cleaning in Progress', 'Inspection Pending'];
const READY_TARGETS = ['Vacant & Clean', 'Available', 'Reserved'];
const START_OK = { Checkout: ['Vacant & Dirty', 'Cleaning in Progress'], Manual: ['Vacant & Dirty', 'Cleaning in Progress', 'Vacant & Clean', 'Available', 'Reserved'], 'Stay-over': ['Occupied'] };
const PRIORITY_RANK = { Urgent: 0, High: 1, Normal: 2 };
const isDup = (e) => e && (e.code === 11000 || /E11000|duplicate key/i.test(e.message || ''));
const ctxReq = (req) => req || { user: null, headers: {} };

const roomPop = { path: 'room', select: 'roomNumber floor status category capacity', populate: { path: 'category', select: 'name' } };
const taskPop = [roomPop, { path: 'assignedTo', select: 'name' }, { path: 'cleanedBy', select: 'name' }];
const fullPop = [...taskPop, { path: 'reservation', select: 'reservationNumber checkIn checkOut' }, { path: 'assignmentHistory.by assignmentHistory.to', select: 'name' }];

const canViewAll = (req) => req.permissions.has('housekeeping.view');
const isAssignee = (req, t) => t.assignedTo && String(t.assignedTo._id || t.assignedTo) === String(req.user._id);

/* ---------------------------------------------------------------- checklist helpers */
const roomCustomItems = (room) => (room.checklist || []).filter((i) => i.custom).map((i) => ({ label: i.label, custom: true, done: false }));
function checklistFor(type, settings, room) {
  const labels = (type === 'Stay-over' ? settings.checklistTemplates.stayover : settings.checklistTemplates.checkout) || [];
  const items = labels.map((label) => ({ label, custom: false, done: false }));
  if (type !== 'Stay-over') for (const c of roomCustomItems(room)) if (!items.some((i) => i.label.toLowerCase() === c.label.toLowerCase())) items.push(c);
  return items;
}
/** Room.checklist (Phase 2) mirrors the task checklist for cleaning-cycle tasks so the Rooms screen and its Available gate stay truthful. */
async function mirrorToRoom(task, { complete = false, by } = {}) {
  if (task.type === 'Stay-over') return;
  const room = await Room.findById(task.room._id || task.room); if (!room) return;
  room.checklist = task.checklist.map((i) => ({ label: i.label, custom: i.custom, done: complete ? true : i.done, doneBy: i.doneBy || (complete ? by?._id : undefined), doneByName: i.doneByName || (complete ? by?.name : undefined), doneAt: i.doneAt || (complete ? new Date() : undefined) }));
  await room.save();
}

async function openTaskForRoom(roomId, { includeStayover = false } = {}) {
  return HousekeepingTask.findOne({ room: roomId, status: { $in: OPEN }, ...(includeStayover ? {} : { type: { $ne: 'Stay-over' } }) });
}

/* ---------------------------------------------------------------- creation */
async function createTask({ sourceKey, room, reservation, type, priority = 'Normal', notes, status = 'Unassigned', assignedTo, createdBy, req, extra = {} }) {
  const existing = await HousekeepingTask.findOne({ sourceKey });
  if (existing) return { task: existing, created: false };
  const settings = await housekeepingSettings();
  const mins = settings.targetMinutes[type] ?? 60;
  const doc = { taskNumber: await Counter.next('HK', 4), sourceKey, room: room._id, reservation, type, priority, notes, status, checklist: checklistFor(type, settings, room),
    dueAt: new Date(Date.now() + mins * 60000), createdBy, ...extra };
  if (assignedTo) Object.assign(doc, { assignedTo, assignedBy: createdBy, assignedAt: new Date(), status: 'Assigned' });
  let task;
  try { task = await HousekeepingTask.create(doc); } catch (e) { if (isDup(e)) return { task: await HousekeepingTask.findOne({ sourceKey }), created: false }; throw e; }
  await audit(ctxReq(req), { action: 'create', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: task._id, entityLabel: `${task.taskNumber} · Room ${room.roomNumber} · ${type}`, newValue: { type, priority, status: task.status, room: room.roomNumber, sourceKey } });
  return { task, created: true };
}

/** Event listener for 'checkout.completed' (published by services/reservations.checkOut). Idempotent: one task per reservation. */
async function onCheckout(payload, ctx = {}) {
  const room = await Room.findById(payload.roomId); if (!room) return null;
  const settings = await housekeepingSettings();
  // a stay-over task for this room is moot once the guest has left
  const moot = await HousekeepingTask.find({ room: room._id, type: 'Stay-over', status: { $in: OPEN } });
  for (const m of moot) { m.status = 'Cancelled'; m.cancelledAt = new Date(); m.cancelReason = 'Guest checked out'; await m.save(); }
  let priority = 'Normal', notes;
  if (settings.priorityWhenArrivalToday && (await Reservation.exists({ room: room._id, status: 'Confirmed', checkIn: { $lte: today() } }))) { priority = 'High'; notes = 'A guest is due to arrive in this room today'; }
  const { task, created } = await createTask({ sourceKey: `checkout:${payload.reservationId}`, room, reservation: payload.reservationId, type: 'Checkout', priority, notes, createdBy: ctx.req?.user?._id, req: ctx.req });
  if (created) {
    await mirrorToRoom(task);
    await notify({ type: 'hk_task', title: `Room ${room.roomNumber} needs cleaning`, message: `${task.taskNumber} created after check-out${priority === 'High' ? ' · arrival today' : ''} - assign it to a housekeeper`, link: `/housekeeping/tasks/${task._id}`, severity: priority === 'High' ? 'warning' : 'info', permission: 'housekeeping.assign' });
  }
  return task;
}
let initialised = false;
function init() { if (initialised) return; initialised = true; events.on('checkout.completed', onCheckout); }

async function createManual(req, body) {
  const room = await Room.findById(body.room); if (!room || !room.active) throw bad('Room not found');
  const type = body.type || 'Manual';
  if (!['Manual', 'Stay-over'].includes(type)) throw bad('Checkout tasks are created automatically at check-out');
  if (type === 'Stay-over' && room.status !== 'Occupied') throw bad(`Stay-over cleaning is for occupied rooms (room ${room.roomNumber} is ${room.status})`);
  if (type === 'Manual' && !START_OK.Manual.includes(room.status)) throw conflict(`Room ${room.roomNumber} is ${room.status}; it cannot be scheduled for cleaning`);
  const open = await openTaskForRoom(room._id, { includeStayover: type === 'Stay-over' });
  if (open && (type === 'Manual' || open.type === 'Stay-over')) throw conflict(`Room ${room.roomNumber} already has an open cleaning task (${open.taskNumber})`);
  if (body.assignedTo) await assertAssignable(body.assignedTo);
  const { task } = await createTask({ sourceKey: `manual:${crypto.randomUUID()}`, room, type, priority: body.priority || 'Normal', notes: body.notes, assignedTo: body.assignedTo, createdBy: req.user._id, req });
  if (type !== 'Stay-over') await mirrorToRoom(task);
  if (body.assignedTo) await notifyAssignee(task, room, req);
  return load(req, task._id);
}

/** One stay-over task per occupied room per day (idempotent). */
async function generateStayover(req, { date } = {}) {
  const d = toDate(date || todayStr());
  const stays = await Reservation.find({ status: 'Checked In', room: { $ne: null }, checkIn: { $lt: d }, checkOut: { $gt: d } }).select('room').lean();
  let created = 0; const rooms = await Room.find({ _id: { $in: stays.map((s) => s.room) }, status: 'Occupied', active: true });
  for (const room of rooms) {
    const r = await createTask({ sourceKey: `stayover:${room._id}:${d.toISOString().slice(0, 10)}`, room, type: 'Stay-over', createdBy: req.user._id, req });
    if (r.created) created += 1;
  }
  return { created, occupied: rooms.length, date: d };
}

/** Make sure every room that is in the cleaning cycle has a task (covers rooms that were dirty before Phase 5 went live). Idempotent. */
async function syncDirtyRooms(req) {
  const rooms = await Room.find({ active: true, status: { $in: CYCLE } }); let created = 0;
  for (const room of rooms) {
    if (await openTaskForRoom(room._id)) continue;
    const last = (room.history || []).slice(-1)[0]?.at || room.updatedAt;
    const inspection = room.status === 'Inspection Pending';
    const r = await createTask({ sourceKey: `sync:${room._id}:${new Date(last).getTime()}`, room, type: 'Manual', notes: 'Created by sync for a room already in the cleaning cycle', status: inspection ? 'Inspection Pending' : 'Unassigned', createdBy: req.user._id, req,
      extra: inspection ? { submittedAt: new Date() } : {} });
    if (r.created) {
      created += 1;
      if (inspection) { r.task.checklist.forEach((i) => { i.done = true; }); await r.task.save(); }
    }
  }
  return { created, checked: rooms.length };
}

/* ---------------------------------------------------------------- queries */
async function load(req, id) {
  const t = await HousekeepingTask.findById(id).populate(fullPop);
  if (!t) throw notFound('Task not found');
  if (!canViewAll(req) && !isAssignee(req, t)) throw notFound('Task not found');   // staff cannot even tell other people's tasks exist
  return present(t);
}
async function present(t) {
  const o = t.toObject ? t.toObject() : t;
  const room = await Room.findById(o.room._id || o.room).select('statusReason').lean();
  const inspections = await RoomInspection.find({ task: o._id }).sort({ inspectedAt: -1 }).lean();
  const done = (o.checklist || []).filter((i) => i.done).length;
  return { ...o, progress: { done, total: (o.checklist || []).length }, overdue: OPEN.includes(o.status) && o.dueAt && new Date(o.dueAt) < new Date(), roomStatusReason: room?.statusReason, inspections };
}

async function list(req, q) {
  const f = {};
  const all = canViewAll(req);
  if (!all) f.assignedTo = req.user._id;
  else {
    if (q.assignedTo === 'me') f.assignedTo = req.user._id; else if (q.assignedTo === 'none') f.assignedTo = null; else if (q.assignedTo) f.assignedTo = q.assignedTo;
  }
  if (q.status === 'open') f.status = { $in: OPEN }; else if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.type) f.type = q.type; if (q.priority) f.priority = q.priority; if (q.room) f.room = q.room;
  if (q.from || q.to) { f.createdAt = {}; if (q.from) f.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`); }
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); const rooms = await Room.find({ roomNumber: rx }).select('_id'); f.$or = [{ taskNumber: rx }, { room: { $in: rooms.map((r) => r._id) } }]; }
  let rows = await HousekeepingTask.find(f).populate(taskPop).sort({ createdAt: -1 }).limit(500);
  rows = rows.map((t) => { const o = t.toObject(); const done = o.checklist.filter((i) => i.done).length; return { ...o, progress: { done, total: o.checklist.length }, overdue: OPEN.includes(o.status) && o.dueAt && new Date(o.dueAt) < new Date() }; });
  rows.sort((a, b) => (OPEN.includes(a.status) ? 0 : 1) - (OPEN.includes(b.status) ? 0 : 1) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(200, Number(q.limit) || 100);
  return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.ceil(rows.length / limit) || 1 };
}

async function board(req) {
  const all = canViewAll(req);
  const own = all ? {} : { assignedTo: req.user._id };
  const open = await HousekeepingTask.find({ status: { $in: OPEN }, ...own }).populate(taskPop).lean();
  const now = new Date(); const by = (s) => open.filter((t) => t.status === s).length;
  const startOfDay = new Date(`${todayStr()}T00:00:00+05:30`);
  const doneToday = await HousekeepingTask.countDocuments({ status: 'Completed', completedAt: { $gte: startOfDay }, ...own });
  const out = { counts: { open: open.length, unassigned: by('Unassigned'), assigned: by('Assigned'), inProgress: by('In Progress'), inspectionPending: by('Inspection Pending'), recleanRequired: by('Re-clean Required'),
    overdue: open.filter((t) => t.dueAt && new Date(t.dueAt) < now && t.status !== 'Inspection Pending').length, urgent: open.filter((t) => t.priority !== 'Normal').length, completedToday: doneToday } };
  if (all) {
    const staff = new Map();
    for (const t of open) if (t.assignedTo) { const k = String(t.assignedTo._id); const e = staff.get(k) || { user: t.assignedTo, open: 0 }; e.open += 1; staff.set(k, e); }
    out.workload = [...staff.values()].sort((a, b) => b.open - a.open);
    const dirty = await Room.find({ active: true, status: { $in: CYCLE } }).select('roomNumber status').lean();
    const covered = new Set(open.filter((t) => t.type !== 'Stay-over').map((t) => String(t.room._id)));
    out.roomsWithoutTask = dirty.filter((r) => !covered.has(String(r._id)));
    out.roomStatus = { 'Vacant & Dirty': dirty.filter((r) => r.status === 'Vacant & Dirty').length, 'Cleaning in Progress': dirty.filter((r) => r.status === 'Cleaning in Progress').length, 'Inspection Pending': dirty.filter((r) => r.status === 'Inspection Pending').length };
  }
  return out;
}

async function staff(req, { all } = {}) {
  const { Role } = require('../../models');
  const roles = await Role.find({ permissions: 'housekeeping.work' }).select('_id name').lean();
  const f = { active: true, role: { $in: roles.map((r) => r._id) } }; if (!all) f.department = 'Housekeeping';
  const users = await User.find(f).populate('role', 'name').sort({ name: 1 }).lean();
  const load = await HousekeepingTask.aggregate([{ $match: { status: { $in: OPEN }, assignedTo: { $in: users.map((u) => u._id) } } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]);
  const m = new Map(load.map((l) => [String(l._id), l.n]));
  return users.map((u) => ({ _id: u._id, name: u.name, role: u.role?.name, department: u.department, openTasks: m.get(String(u._id)) || 0 }));
}

/* ---------------------------------------------------------------- assignment */
async function assertAssignable(userId) {
  const u = await User.findById(userId).populate('role');
  if (!u || !u.active) throw bad('That staff member is not available');
  if (!u.role.permissions.includes('housekeeping.work')) throw bad(`${u.name} cannot work on housekeeping tasks (role has no housekeeping work permission)`);
  return u;
}
async function notifyAssignee(task, room, req) {
  await notify({ type: 'hk_task', title: `Room ${room.roomNumber} assigned to you`, message: `${task.taskNumber} · ${task.type} clean${task.priority !== 'Normal' ? ` · ${task.priority} priority` : ''}`, link: `/housekeeping/tasks/${task._id}`, severity: task.priority === 'Normal' ? 'info' : 'warning', user: task.assignedTo });
}
async function assign(req, id, { userId, note }) {
  const user = await assertAssignable(userId);
  const t = await HousekeepingTask.findById(id).populate('room'); if (!t) throw notFound('Task not found');
  if (!['Unassigned', 'Assigned', 'In Progress', 'Re-clean Required'].includes(t.status)) throw conflict(`A task that is ${t.status.toLowerCase()} cannot be reassigned`);
  const prev = t.assignedTo; if (prev && String(prev) === String(user._id)) throw bad(`${user.name} is already assigned to this task`);
  const nextStatus = t.status === 'Unassigned' ? 'Assigned' : t.status === 'In Progress' ? 'Assigned' : t.status;   // new assignee starts (or restarts) the work
  const upd = await HousekeepingTask.findOneAndUpdate({ _id: id, status: t.status, assignedTo: prev || null },
    { $set: { assignedTo: user._id, assignedBy: req.user._id, assignedAt: new Date(), status: nextStatus }, $push: { assignmentHistory: { at: new Date(), by: req.user._id, byName: req.user.name, from: prev || undefined, to: user._id, toName: user.name, note } } }, { new: true });
  if (!upd) throw conflict('This task was changed by someone else. Refresh and try again.');
  await audit(req, { action: prev ? 'update' : 'create', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: t._id, entityLabel: `${t.taskNumber} ${prev ? 'reassigned' : 'assigned'} · Room ${t.room.roomNumber}`, oldValue: { assignedTo: prev, status: t.status }, newValue: { assignedTo: user.name, status: nextStatus }, note });
  await notifyAssignee(upd, t.room, req);
  return load(req, id);
}

async function update(req, id, body) {
  const t = await HousekeepingTask.findById(id).populate('room'); if (!t) throw notFound('Task not found');
  if (!OPEN.includes(t.status)) throw conflict('A finished task cannot be edited');
  const before = { priority: t.priority, notes: t.notes, dueAt: t.dueAt };
  if (body.priority) t.priority = body.priority; if (body.notes !== undefined) t.notes = body.notes; if (body.dueAt) t.dueAt = new Date(body.dueAt);
  await t.save();
  await audit(req, { action: 'update', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: t._id, entityLabel: `${t.taskNumber} · Room ${t.room.roomNumber}`, oldValue: before, newValue: { priority: t.priority, notes: t.notes, dueAt: t.dueAt } });
  if (body.priority && body.priority !== before.priority && t.assignedTo && body.priority !== 'Normal') await notify({ type: 'hk_task', title: `Room ${t.room.roomNumber} is now ${body.priority} priority`, message: t.taskNumber, link: `/housekeeping/tasks/${t._id}`, severity: 'warning', user: t.assignedTo });
  return load(req, id);
}

async function cancel(req, id, reason) {
  if (!reason || reason.trim().length < 3) throw bad('A reason is required');
  const t = await HousekeepingTask.findById(id).populate('room'); if (!t) throw notFound('Task not found');
  const prev = t.status;
  const upd = await HousekeepingTask.findOneAndUpdate({ _id: id, status: { $in: OPEN } }, { $set: { status: 'Cancelled', cancelledAt: new Date(), cancelReason: reason.trim() } }, { new: true });
  if (!upd) throw conflict('This task is already finished or cancelled');
  // the room goes back to "needs cleaning" if this task had put it into the cycle
  if (t.type !== 'Stay-over' && ['Cleaning in Progress', 'Inspection Pending'].includes(t.room.status) && !(await openTaskForRoom(t.room._id))) await setRoomStatus(t.room, 'Vacant & Dirty', req, { reason: `Task ${t.taskNumber} cancelled`, action: 'housekeeping' });
  await audit(req, { action: 'status', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: t._id, entityLabel: `${t.taskNumber} cancelled`, oldValue: { status: prev }, newValue: { status: 'Cancelled' }, note: reason });
  if (t.assignedTo) await notify({ type: 'hk_task', title: `Task cancelled: Room ${t.room.roomNumber}`, message: reason, link: '/housekeeping/my-tasks', severity: 'info', user: t.assignedTo });
  return load(req, id);
}

/* ---------------------------------------------------------------- working a task (assignee only) */
async function mine(req, id, statuses) {
  const t = await HousekeepingTask.findById(id).populate('room');
  if (!t || !isAssignee(req, t)) throw notFound('Task not found');
  if (statuses && !statuses.includes(t.status)) throw conflict(`This task is ${t.status.toLowerCase()}${statuses.length === 1 ? '' : ''}; that action is not available now`);
  return t;
}

async function start(req, id) {
  const t = await mine(req, id, ['Assigned', 'Re-clean Required']);
  const room = t.room;
  if (!START_OK[t.type].includes(room.status)) throw conflict(`Room ${room.roomNumber} is ${room.status}; cleaning cannot start until that is resolved`);
  const upd = await HousekeepingTask.findOneAndUpdate({ _id: id, status: { $in: ['Assigned', 'Re-clean Required'] }, assignedTo: req.user._id }, { $set: { status: 'In Progress' } }, { new: true });
  if (!upd) throw conflict('This task was changed by someone else. Refresh and try again.');
  if (!upd.startedAt) { upd.startedAt = new Date(); await upd.save(); }
  try {
    if (t.type !== 'Stay-over' && room.status !== 'Cleaning in Progress') await setRoomStatus(room, 'Cleaning in Progress', req, { reason: `Cleaning started (${t.taskNumber})`, action: 'housekeeping' });
    if (t.type !== 'Stay-over') await mirrorToRoom(upd);
  } catch (e) { await HousekeepingTask.updateOne({ _id: id }, { $set: { status: t.status } }); throw e; }
  await audit(req, { action: 'status', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: t._id, entityLabel: `${t.taskNumber} started · Room ${room.roomNumber}`, oldValue: { status: t.status, room: room.status }, newValue: { status: 'In Progress', room: t.type === 'Stay-over' ? room.status : 'Cleaning in Progress' } });
  return load(req, id);
}

async function toggleChecklist(req, id, itemId, done) {
  const t = await mine(req, id, ['In Progress']);
  const item = t.checklist.id(itemId); if (!item) throw notFound('Checklist item not found');
  item.done = done; item.doneBy = done ? req.user._id : undefined; item.doneByName = done ? req.user.name : undefined; item.doneAt = done ? new Date() : undefined;
  await t.save(); await mirrorToRoom(t);
  return load(req, id);
}
async function addChecklistItem(req, id, label) {
  const t = await mine(req, id, ['In Progress']);
  if (t.checklist.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw bad('That item is already on the checklist');
  t.checklist.push({ label, custom: true }); await t.save(); await mirrorToRoom(t);
  return load(req, id);
}
async function removeChecklistItem(req, id, itemId) {
  const t = await mine(req, id, ['In Progress']);
  const item = t.checklist.id(itemId); if (!item) throw notFound('Checklist item not found');
  if (!item.custom) throw bad('Standard checklist items cannot be removed');
  item.deleteOne(); await t.save(); await mirrorToRoom(t);
  return load(req, id);
}

async function addPhoto(req, id, { kind, caption }) {
  if (!['before', 'after'].includes(kind)) throw bad('Photo kind must be before or after');
  const t = await mine(req, id, ['In Progress']);
  if (t.photos.length >= 12) throw bad('A task can hold up to 12 photos');
  const mime = storage.validateImage(req.body, req.headers['content-type']);
  const key = await storage.store(req.body, mime);
  const att = await Attachment.create({ entityType: 'HousekeepingTask', entityId: t._id, kind, caption, mimeType: mime, size: req.body.length, storageKey: key, uploadedBy: req.user._id, originalName: String(req.query.name || '').slice(0, 80) });
  t.photos.push({ attachment: att._id, kind, caption, at: new Date(), by: req.user._id }); await t.save();
  await audit(req, { action: 'create', module: 'Housekeeping', entity: 'Attachment', entityId: att._id, entityLabel: `${t.taskNumber} ${kind} photo`, newValue: { kind, size: att.size } });
  return load(req, id);
}
async function removePhoto(req, id, photoId) {
  const t = await mine(req, id, ['In Progress']);
  const p = t.photos.id(photoId); if (!p) throw notFound('Photo not found');
  const att = await Attachment.findById(p.attachment); p.deleteOne(); await t.save();
  if (att) { await storage.remove(att.storageKey); await Attachment.deleteOne({ _id: att._id }); }
  return load(req, id);
}

async function submit(req, id) {
  const t = await mine(req, id, ['In Progress']);
  const settings = await housekeepingSettings(); const room = t.room;
  const pending = t.checklist.filter((i) => !i.done);
  if (settings.requireChecklistComplete && pending.length) throw bad(`Complete the checklist first (${pending.length} of ${t.checklist.length} items pending)`);
  if (settings.requirePhotos && t.type !== 'Stay-over' && !(t.photos.some((p) => p.kind === 'before') && t.photos.some((p) => p.kind === 'after'))) throw bad('Add a before and an after photo before submitting');
  const stay = t.type === 'Stay-over';
  const needsInspection = !stay || settings.stayoverNeedsInspection;
  if (!stay && room.status !== 'Cleaning in Progress') throw conflict(`Room ${room.roomNumber} is ${room.status}; the task cannot be submitted for inspection`);
  const next = needsInspection ? 'Inspection Pending' : 'Completed';
  const upd = await HousekeepingTask.findOneAndUpdate({ _id: id, status: 'In Progress', assignedTo: req.user._id }, { $set: { status: next, submittedAt: new Date(), cleanedBy: req.user._id, ...(needsInspection ? {} : { completedAt: new Date() }) } }, { new: true });
  if (!upd) throw conflict('This task was changed by someone else. Refresh and try again.');
  if (!stay) { try { await setRoomStatus(room, 'Inspection Pending', req, { reason: `Cleaning finished (${t.taskNumber}); awaiting supervisor inspection`, action: 'housekeeping' }); } catch (e) { await HousekeepingTask.updateOne({ _id: id }, { $set: { status: 'In Progress' } }); throw e; } await mirrorToRoom(upd); }
  await audit(req, { action: 'status', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: t._id, entityLabel: `${t.taskNumber} cleaning complete · Room ${room.roomNumber}`, oldValue: { status: 'In Progress' }, newValue: { status: next, room: stay ? room.status : 'Inspection Pending', checklist: `${t.checklist.filter((i) => i.done).length}/${t.checklist.length}` } });
  if (needsInspection) await notify({ type: 'hk_inspection', title: `Room ${room.roomNumber} ready for inspection`, message: `${t.taskNumber} cleaned by ${req.user.name}`, link: `/housekeeping/tasks/${t._id}`, severity: 'info', permission: 'housekeeping.inspect' });
  return load(req, id);
}

/* ---------------------------------------------------------------- supervisor inspection */
async function inspect(req, id, { result, reason, notes, failedItemIds = [] }) {
  if (!['Approved', 'Rejected'].includes(result)) throw bad('Result must be Approved or Rejected');
  if (result === 'Rejected' && (!reason || reason.trim().length < 3)) throw bad('Enter the reason the room failed inspection');
  const settings = await housekeepingSettings();
  const t = await HousekeepingTask.findById(id).populate('room'); if (!t) throw notFound('Task not found');
  if (t.status !== 'Inspection Pending') throw conflict(`This task is ${t.status.toLowerCase()}, not waiting for inspection`);
  if (settings.inspectorMustDifferFromCleaner && t.cleanedBy && String(t.cleanedBy) === String(req.user._id)) throw forbidden('A different person must inspect the room you cleaned');
  const room = t.room; const roomBefore = room.status;
  const next = result === 'Approved' ? 'Completed' : 'Re-clean Required';
  const failedLabels = t.checklist.filter((i) => failedItemIds.includes(String(i._id))).map((i) => i.label);
  const patch = result === 'Approved'
    ? { status: next, completedAt: new Date(), inspection: { result, at: new Date(), by: req.user._id, byName: req.user.name, notes } }
    : { status: next, inspection: { result, at: new Date(), by: req.user._id, byName: req.user.name, notes }, lastRejection: { reason: reason.trim(), at: new Date(), by: req.user._id, byName: req.user.name, failedItems: failedLabels }, $inc: { rejectionCount: 1 } };
  const { $inc, ...set } = patch;
  const upd = await HousekeepingTask.findOneAndUpdate({ _id: id, status: 'Inspection Pending' }, { $set: set, ...($inc ? { $inc } : {}) }, { new: true });
  if (!upd) throw conflict('This task was already inspected by someone else.');
  if (result === 'Rejected' && failedItemIds.length) { upd.checklist.forEach((i) => { if (failedItemIds.includes(String(i._id))) { i.done = false; i.doneBy = undefined; i.doneByName = undefined; i.doneAt = undefined; } }); await upd.save(); }
  let roomAfter = roomBefore, note;
  if (t.type !== 'Stay-over') {
    if (room.status === 'Inspection Pending') {
      roomAfter = result === 'Approved' ? 'Vacant & Clean' : 'Cleaning in Progress';
      await setRoomStatus(room, roomAfter, req, { reason: result === 'Approved' ? `Inspection passed (${t.taskNumber})` : `Inspection failed (${t.taskNumber}): ${reason.trim()}`, action: 'housekeeping' });
    } else { note = `Room is ${room.status}; its status was not changed by this inspection`; await HousekeepingTask.updateOne({ _id: id }, { $set: { roomStatusNote: note } }); }
    await mirrorToRoom(upd, { complete: result === 'Approved', by: req.user });
  }
  const insp = await RoomInspection.create({ task: t._id, room: room._id, result, reason: result === 'Rejected' ? reason.trim() : undefined, notes, failedItems: failedLabels, checklist: upd.checklist.map((i) => ({ label: i.label, done: i.done, doneByName: i.doneByName })),
    cleanedBy: t.cleanedBy, cleanedByName: (t.cleanedBy && (await User.findById(t.cleanedBy).select('name').lean())?.name) || undefined, inspector: req.user._id, inspectorName: req.user.name, attempt: (t.rejectionCount || 0) + 1, roomStatusBefore: roomBefore, roomStatusAfter: roomAfter });
  await audit(req, { action: result === 'Approved' ? 'approve' : 'reject', module: 'Housekeeping', entity: 'HousekeepingTask', entityId: t._id, entityLabel: `${t.taskNumber} inspection ${result.toLowerCase()} · Room ${room.roomNumber}`, oldValue: { status: 'Inspection Pending', room: roomBefore }, newValue: { status: next, room: roomAfter, inspector: req.user.name, failedItems: failedLabels }, note: reason || notes });
  if (t.cleanedBy) await notify({ type: 'hk_inspection', title: result === 'Approved' ? `Room ${room.roomNumber} passed inspection` : `Room ${room.roomNumber} needs re-cleaning`, message: result === 'Approved' ? t.taskNumber : `${reason.trim()}${failedLabels.length ? ` (${failedLabels.join(', ')})` : ''}`, link: `/housekeeping/tasks/${t._id}`, severity: result === 'Approved' ? 'info' : 'urgent', user: t.cleanedBy });
  if (result === 'Approved' && roomAfter === 'Vacant & Clean') events.publish('room.ready', { roomId: room._id, roomNumber: room.roomNumber, taskId: t._id });
  return { task: await load(req, id), inspection: insp };
}

async function inspections(req, q) {
  const f = {}; if (q.room) f.room = q.room; if (q.task) f.task = q.task; if (q.inspector) f.inspector = q.inspector; if (q.cleanedBy) f.cleanedBy = q.cleanedBy; if (q.result) f.result = q.result;
  if (!canViewAll(req) && !req.permissions.has('housekeeping.inspect')) f.cleanedBy = req.user._id;
  if (q.from || q.to) { f.inspectedAt = {}; if (q.from) f.inspectedAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.inspectedAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`); }
  const rows = await RoomInspection.find(f).populate('room', 'roomNumber floor').populate('task', 'taskNumber type').sort({ inspectedAt: -1 }).limit(Math.min(200, Number(q.limit) || 100)).lean();
  return rows;
}

/* ---------------------------------------------------------------- guards used by the Rooms module */
/**
 * A room in the cleaning cycle may only become Vacant & Clean / Available / Reserved through supervisor inspection. If a task exists the
 * generic room-status endpoint is refused; without a task (rooms that were already dirty before Phase 5) only a holder of
 * housekeeping.inspect may record the override, and it is audited by the caller.
 */
async function assertManualStatusChange(room, fromStatus, toStatus, req) {
  if (!CYCLE.includes(fromStatus)) return null;
  if (!READY_TARGETS.includes(toStatus) && !CYCLE.includes(toStatus)) return null;
  if (toStatus === fromStatus) return null;
  const open = await openTaskForRoom(room._id);
  if (open) throw conflict(`Room ${room.roomNumber} is managed by housekeeping task ${open.taskNumber} (${open.status}). It becomes Vacant & Clean only after a supervisor inspects and approves it in Housekeeping.`);
  if (READY_TARGETS.includes(toStatus) && !req.permissions.has('housekeeping.inspect')) throw forbidden('A supervisor must inspect a cleaned room before it can be marked clean or available');
  return READY_TARGETS.includes(toStatus) ? 'Supervisor override: no open housekeeping task' : null;
}
async function assertChecklistNotManaged(room) {
  const open = await openTaskForRoom(room._id);
  if (open) throw conflict(`This room's checklist is managed by housekeeping task ${open.taskNumber}. Use the task in Housekeeping.`);
}

module.exports = { init, onCheckout, createManual, generateStayover, syncDirtyRooms, load, list, board, staff, assign, update, cancel, start, toggleChecklist, addChecklistItem, removeChecklistItem, addPhoto, removePhoto, submit, inspect, inspections,
  assertManualStatusChange, assertChecklistNotManaged, openTaskForRoom, canViewAll, isAssignee, CYCLE, mirrorToRoom };
