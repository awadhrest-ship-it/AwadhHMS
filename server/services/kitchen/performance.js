/**
 * Module 7.5 - chef performance. Transparent, derived ONLY from recorded activity; the PDF leaves the measuring method TBC, so no official score is invented.
 *
 * Attribution (no guessing): a person is a participant of a station's share of a ticket if a manager assigned it to them, they claimed it, or they started /
 * marked-ready any of its items. Tickets from before Phase 7 have no such record and are reported as "unattributed" - never given to anyone.
 * The person who taps Ready is therefore NOT assumed to be the only one responsible; shared work is counted for every participant and flagged.
 * On-time = the station's share was Ready within its delay threshold (as configured now). An optional composite indicator exists but is OFF by default.
 */
const { KitchenTicket, KitchenDelayAlert, KitchenPrepList, KitchenWastage } = require('../../models');
const { kitchenSettings } = require('../settings');
const { startOfIstDay, todayStr, addDays, toDate, fmt } = require('../../utils/dates');
const C = require('./core');
const { bad } = require('../../utils/ApiError');

const avg = (a) => (a.length ? C.round1(a.reduce((s, x) => s + x, 0) / a.length) : null);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
async function dashboard(q = {}, now = new Date()) {
  const to = q.to || todayStr(now); const from = q.from || fmt(addDays(toDate(to), -6));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw bad('Enter a valid date range');
  if ((toDate(to) - toDate(from)) / 864e5 > 92) throw bad('Choose a range of at most 92 days');
  const settings = await kitchenSettings();
  const lo = startOfIstDay(from), hi = new Date(startOfIstDay(to).getTime() + 864e5);
  const tickets = await KitchenTicket.find({ queuedAt: { $gte: lo, $lt: hi } }).limit(5000);
  const alerts = new Set((await KitchenDelayAlert.find({ raisedAt: { $gte: lo, $lt: hi } }).select('key').lean()).map((a) => a.key));
  const users = new Map(); const stations = new Map(); const un = { slices: 0, completed: 0 };
  const U = (id, name) => { const k = String(id); if (!users.has(k)) users.set(k, { user: id, name, slices: 0, items: 0, completed: 0, solo: 0, shared: 0, onTime: 0, late: 0, delayedHandled: 0, cancelledAssigned: 0, totalMin: [], prepMin: [], byStation: {} }); return users.get(k); };
  for (const t of tickets) for (const s of C.slicesOf(t, settings, now)) {
    const live = s.items.filter((i) => i.effStatus !== 'Cancelled');
    const st = stations.get(s.station) || { station: s.station, slices: 0, completed: 0, active: 0, cancelled: 0, delayed: 0, onTime: 0, totalMin: [], prepMin: [] }; stations.set(s.station, st);
    if (q.station && q.station !== s.station) continue;
    st.slices += 1;
    const part = new Map();
    for (const a of t.assignees || []) if (!a.removedAt && (!a.station || a.station === s.station)) part.set(String(a.user), a.name);
    for (const i of s.items) { if (i.startedBy) part.set(String(i.startedBy), i.startedByName); if (i.readyBy) part.set(String(i.readyBy), i.readyByName); }
    const done = ['Ready', 'Served'].includes(s.status); const elapsed = C.minutes(t.queuedAt, s.readyAt);
    if (done) { st.completed += 1; if (elapsed != null) st.totalMin.push(elapsed); if (s.prepMinutes != null) st.prepMin.push(s.prepMinutes); if (elapsed != null && elapsed <= s.thresholdMinutes) st.onTime += 1; }
    else if (s.status === 'Cancelled') st.cancelled += 1; else st.active += 1;
    if (alerts.has(s.key)) st.delayed += 1;
    if (!part.size) { un.slices += 1; if (done) un.completed += 1; continue; }
    for (const [id, name] of part) {
      const u = U(id, name); u.slices += 1; u.items += live.length; part.size > 1 ? (u.shared += 1) : (u.solo += 1);
      const bs = u.byStation[s.station] || { slices: 0, completed: 0 }; bs.slices += 1; u.byStation[s.station] = bs;
      if (done) { u.completed += 1; bs.completed += 1; if (elapsed != null) { u.totalMin.push(elapsed); elapsed <= s.thresholdMinutes ? (u.onTime += 1) : (u.late += 1); } if (s.prepMinutes != null) u.prepMin.push(s.prepMinutes); if (alerts.has(s.key)) u.delayedHandled += 1; }
      if (s.status === 'Cancelled' && (t.assignees || []).some((a) => !a.removedAt && String(a.user) === id)) u.cancelledAssigned += 1;
    }
  }
  const lists = await KitchenPrepList.find({ businessDate: { $gte: from, $lte: to } }).lean();
  for (const l of lists) for (const k of l.tasks) if (k.assignedTo) { const u = U(k.assignedTo, k.assignedToName); u.tasksAssigned = (u.tasksAssigned || 0) + 1; if (k.status === 'Completed') u.tasksCompleted = (u.tasksCompleted || 0) + 1; }
  const waste = await KitchenWastage.find({ businessDate: { $gte: from, $lte: to }, status: 'Posted' }).select('recordedBy recordedByName cost costComplete').lean();
  for (const w of waste) { const u = U(w.recordedBy, w.recordedByName); u.wastageRecords = (u.wastageRecords || 0) + 1; u.wastageCost = C.rup((u.wastageCost || 0) + (w.cost || 0)); if (!w.costComplete) u.wastageCostIncomplete = true; }
  const comp = settings.performance.composite;
  const rows = [...users.values()].map((u) => {
    const o = { user: u.user, name: u.name, ticketsHandled: u.slices, itemsHandled: u.items, ordersCompleted: u.completed, soloTickets: u.solo, sharedTickets: u.shared, avgTotalMinutes: avg(u.totalMin), avgPrepMinutes: avg(u.prepMin),
      onTimeRate: pct(u.onTime, u.onTime + u.late), onTimeCount: u.onTime, lateCount: u.late, delayedOrdersHandled: u.delayedHandled, cancelledAssigned: u.cancelledAssigned,
      tasksAssigned: u.tasksAssigned || 0, tasksCompleted: u.tasksCompleted || 0, taskCompletionRate: pct(u.tasksCompleted || 0, u.tasksAssigned || 0), wastageRecords: u.wastageRecords || 0, wastageCost: u.wastageCost ?? null, wastageCostIncomplete: !!u.wastageCostIncomplete, byStation: u.byStation };
    if (comp.enabled) { const parts = [[o.onTimeRate, comp.onTimeWeight], [o.taskCompletionRate, comp.taskWeight]].filter(([v]) => v != null); const w = parts.reduce((s, [, x]) => s + x, 0); o.compositeIndicator = w ? Math.round(parts.reduce((s, [v, x]) => s + v * x, 0) / w * 10) / 10 : null; }
    return o;
  }).sort((a, b) => b.ticketsHandled - a.ticketsHandled || a.name.localeCompare(b.name));
  return { range: { from, to }, station: q.station || null, users: rows,
    stations: [...stations.values()].map((s) => ({ station: s.station, slices: s.slices, completed: s.completed, active: s.active, cancelled: s.cancelled, delayed: s.delayed, avgTotalMinutes: avg(s.totalMin), avgPrepMinutes: avg(s.prepMin), onTimeRate: pct(s.onTime, s.completed) })),
    unattributed: { ...un, note: 'Tickets with no recorded assignee or action (for example from before Phase 7) are not credited to anyone.' },
    composite: { enabled: !!comp.enabled, weights: comp.enabled ? { onTime: comp.onTimeWeight, tasks: comp.taskWeight } : null, note: 'Internal, configurable indicator built from the two rates shown - not an official hotel KPI.' },
    methodology: ['Handled = the person was assigned/claimed the station\'s share of a ticket, or started / marked-ready one of its items. Shared work counts for every participant and is flagged.',
      'Average total time = queued to ready; average prep time = first item started to ready. Averages are blank (not zero) when there is no data.',
      `On time = ready within the station's delay threshold (currently ${settings.delay.defaultMinutes} min default - PROVISIONAL, configurable).`,
      'Wastage is shown for context only: it is not proof of poor performance on its own, and speed alone is not proof of good performance.'] };
}
module.exports = { dashboard };
