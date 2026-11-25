/**
 * Module 7.4 (C) - daily preparation list: one per business date; tasks hold PLANNED vs ACTUAL / REMAINING quantity, a station and an assignee.
 * It does NOT touch inventory (see README "consumption lifecycle"): ingredients leave stock when the dish is SOLD, and discards go through wastage,
 * so preparing food can never double-deduct. Past sales are shown as reference only - nothing here forecasts demand.
 */
const { KitchenPrepList, MenuItem, RestaurantOrder, User } = require('../../models');
const { kitchenSettings } = require('../settings');
const { audit } = require('../audit');
const { todayStr, addDays, toDate, fmt } = require('../../utils/dates');
const C = require('./core');
const { bad, conflict, forbidden, notFound } = require('../../utils/ApiError');

const num = (v) => (v == null || v === '' ? null : Number(v));
const upBy = (req) => ({ updatedBy: req.user._id, updatedByName: req.user.name });
async function assignee(userId) { if (!userId) return {}; const u = await User.findById(userId).populate('role'); if (!u || !u.active) throw bad('Choose an active staff member'); if (!u.role?.permissions?.some((p) => ['kitchen.prep.work', 'kitchen.prep.manage', 'kitchen.update'].includes(p))) throw bad(`${u.name} does not have kitchen access`); return { assignedTo: u._id, assignedToName: u.name }; }
async function mk(b) {
  let title = b.title?.trim(); let menuItem; if (b.menuItem) { const m = await MenuItem.findById(b.menuItem); if (!m) throw bad('Menu item not found'); menuItem = m._id; title = title || m.name; if (!b.station && C.STATIONS.includes(m.station)) b = { ...b, station: m.station }; }
  if (!title) throw bad('Enter a task name or choose a menu item'); if (b.station && !C.STATIONS.includes(b.station)) throw bad('Unknown station');
  return { menuItem, title, station: b.station || undefined, plannedQty: Number(b.plannedQty), unit: b.unit?.trim() || 'portion', instructions: b.instructions?.trim() || undefined, ...(await assignee(b.assignedTo)) };
}
const progress = (l) => { const t = l.tasks || []; const done = t.filter((x) => x.status === 'Completed').length; return { total: t.length, completed: done, inProgress: t.filter((x) => x.status === 'In Progress').length, pending: t.filter((x) => x.status === 'Pending').length, percent: t.length ? Math.round((done / t.length) * 100) : 0, planned: t.reduce((s, x) => s + x.plannedQty, 0), actual: t.reduce((s, x) => s + (x.actualQty || 0), 0) }; };
const out = (l) => { const o = l.toObject ? l.toObject() : l; return { ...o, progress: progress(o) }; };

async function create(req, b) {
  const businessDate = b.businessDate || todayStr(); if (await KitchenPrepList.exists({ businessDate })) throw conflict(`A preparation list for ${businessDate} already exists - open it instead`);
  const tasks = []; for (const t of b.tasks || []) tasks.push({ ...(await mk(t)), createdBy: req.user._id });
  let l; try { l = await KitchenPrepList.create({ businessDate, title: b.title, notes: b.notes, tasks, createdBy: req.user._id, createdByName: req.user.name, ...upBy(req) }); } catch (e) { if (e.code === 11000) throw conflict(`A preparation list for ${businessDate} already exists`); throw e; }
  await audit(req, { action: 'create', module: 'Kitchen', entity: 'KitchenPrepList', entityId: l._id, entityLabel: `Preparation list ${businessDate}`, newValue: { tasks: tasks.map((t) => `${t.plannedQty} ${t.unit} ${t.title}`) } });
  return out(l);
}
async function get(id) { const l = await KitchenPrepList.findById(id); if (!l) throw notFound('Preparation list not found'); return out(l); }
async function byDate(date) { const l = await KitchenPrepList.findOne({ businessDate: date }); return l ? out(l) : null; }
async function list() { return (await KitchenPrepList.find().sort({ businessDate: -1 }).limit(60)).map((l) => ({ _id: l._id, businessDate: l.businessDate, title: l.title, progress: progress(l), createdByName: l.createdByName })); }
async function save(l, req) { try { l.updatedBy = req.user._id; l.updatedByName = req.user.name; await l.save(); } catch (e) { if (e.name === 'VersionError') throw conflict('This list was just changed by someone else - reload and try again'); throw e; } return out(l); }
async function update(req, id, b) { const l = await KitchenPrepList.findById(id); if (!l) throw notFound('Preparation list not found'); if (b.title !== undefined) l.title = b.title; if (b.notes !== undefined) l.notes = b.notes; const r = await save(l, req); await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenPrepList', entityId: id, entityLabel: `Preparation list ${l.businessDate}`, newValue: { title: b.title, notes: b.notes } }); return r; }
async function addTask(req, id, b) { const l = await KitchenPrepList.findById(id); if (!l) throw notFound('Preparation list not found'); l.tasks.push({ ...(await mk(b)), createdBy: req.user._id }); const r = await save(l, req); await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenPrepList', entityId: id, entityLabel: `Preparation list ${l.businessDate}: task added`, newValue: { task: `${b.plannedQty} ${b.unit || 'portion'} ${b.title || ''}` } }); return r; }
async function removeTask(req, id, taskId) { const l = await KitchenPrepList.findById(id); if (!l) throw notFound('Preparation list not found'); const t = l.tasks.id(taskId); if (!t) throw notFound('Task not found'); if (t.status !== 'Pending') throw conflict('Work has started on this task - it cannot be removed'); l.tasks = l.tasks.filter((x) => String(x._id) !== String(taskId)); const r = await save(l, req); await audit(req, { action: 'delete', module: 'Kitchen', entity: 'KitchenPrepList', entityId: id, entityLabel: `Preparation list ${l.businessDate}: task removed`, oldValue: { task: t.title, plannedQty: t.plannedQty } }); return r; }

/**
 * Update a task. Managers (kitchen.prep.manage) may change anything. Chefs (kitchen.prep.work) may only progress tasks assigned to them or still unassigned
 * (they claim it) - status, actual and remaining quantity - never planned quantity, station or someone else's task.
 */
async function updateTask(req, id, taskId, b) {
  const l = await KitchenPrepList.findById(id); if (!l) throw notFound('Preparation list not found'); const t = l.tasks.id(taskId); if (!t) throw notFound('Task not found');
  const manage = req.permissions.has('kitchen.prep.manage'); const before = { status: t.status, plannedQty: t.plannedQty, actualQty: t.actualQty, remainingQty: t.remainingQty, assignedTo: t.assignedToName };
  if (!manage) {
    if (!req.permissions.has('kitchen.prep.work')) throw forbidden();
    if (t.assignedTo && String(t.assignedTo) !== String(req.user._id)) throw forbidden('This task is assigned to someone else');
    if (['plannedQty', 'station', 'title', 'instructions', 'unit'].some((k) => b[k] !== undefined)) throw forbidden('Only a manager can change what is planned');
    if (b.assignedTo !== undefined && String(b.assignedTo) !== String(req.user._id)) throw forbidden('You can only assign a task to yourself');
  }
  if (b.title !== undefined) t.title = b.title.trim(); if (b.station !== undefined) { if (b.station && !C.STATIONS.includes(b.station)) throw bad('Unknown station'); t.station = b.station || undefined; }
  if (b.plannedQty !== undefined) t.plannedQty = Number(b.plannedQty); if (b.instructions !== undefined) t.instructions = b.instructions; if (b.unit !== undefined) t.unit = b.unit;
  if (b.assignedTo !== undefined) { const a = await assignee(b.assignedTo); t.assignedTo = a.assignedTo; t.assignedToName = a.assignedToName; }
  else if (!manage && !t.assignedTo) { t.assignedTo = req.user._id; t.assignedToName = req.user.name; }
  if (b.actualQty !== undefined) t.actualQty = num(b.actualQty); if (b.remainingQty !== undefined) t.remainingQty = num(b.remainingQty);
  if (b.status && b.status !== t.status) {
    const ok = { Pending: ['In Progress', 'Completed'], 'In Progress': ['Completed', 'Pending'], Completed: manage ? ['In Progress'] : [] }[t.status];
    if (!ok.includes(b.status)) throw bad(`A ${t.status.toLowerCase()} task cannot move to ${b.status.toLowerCase()}`);
    if (b.status === 'Completed' && t.actualQty == null) throw bad('Enter the actual quantity prepared before completing the task');
    t.status = b.status; if (b.status === 'In Progress' && !t.startedAt) t.startedAt = new Date();
    if (b.status === 'Completed') { t.completedAt = new Date(); t.completedBy = req.user._id; t.completedByName = req.user.name; } else { t.completedAt = undefined; t.completedBy = undefined; t.completedByName = undefined; }
  }
  if (t.actualQty != null && t.actualQty < 0 || t.remainingQty != null && t.remainingQty < 0) throw bad('Quantities cannot be negative');
  t.updatedBy = req.user._id; t.updatedByName = req.user.name; t.updatedAt = new Date();
  const r = await save(l, req);
  await audit(req, { action: before.status !== t.status ? 'status' : 'update', module: 'Kitchen', entity: 'KitchenPrepList', entityId: id, entityLabel: `Preparation list ${l.businessDate}: ${t.title}${t.status === 'Completed' && before.status !== 'Completed' ? ' completed' : ''}`, oldValue: before, newValue: { status: t.status, plannedQty: t.plannedQty, actualQty: t.actualQty, remainingQty: t.remainingQty, assignedTo: t.assignedToName } });
  return r;
}
/** Reference only: portions sold per menu item over the previous N days (and the same weekday last week). Not a forecast. */
async function reference(date = todayStr()) {
  const days = (await kitchenSettings()).prep.referenceDays || 7; const from = fmt(addDays(toDate(date), -days)); const to = fmt(addDays(toDate(date), -1)); const sameDay = fmt(addDays(toDate(date), -7));
  const orders = await RestaurantOrder.find({ businessDate: { $gte: from, $lte: to }, status: { $ne: 'Cancelled' } }).select('businessDate items').lean(); const m = new Map();
  for (const o of orders) for (const i of o.items) { if (i.status === 'Cancelled' || !i.menuItem) continue; const k = String(i.menuItem); const r = m.get(k) || { menuItem: i.menuItem, name: i.name, total: 0, sameWeekday: 0, byDay: {} }; r.total += i.quantity; r.byDay[o.businessDate] = (r.byDay[o.businessDate] || 0) + i.quantity; if (o.businessDate === sameDay) r.sameWeekday += i.quantity; m.set(k, r); }
  const mis = new Map((await MenuItem.find({ _id: { $in: [...m.keys()] } }).select('station').lean()).map((x) => [String(x._id), x.station]));
  return { from, to, days, sameWeekdayDate: sameDay, data: [...m.values()].map((r) => ({ ...r, station: mis.get(String(r.menuItem)) || null, averagePerDay: Math.round((r.total / days) * 10) / 10 })).sort((a, b) => b.total - a.total), note: 'Past sales for reference only. This is not a forecast or a guarantee of demand.' };
}
module.exports = { create, get, byDate, list, update, addTask, removeTask, updateTask, reference };
