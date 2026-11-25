/**
 * Staff performance (Module 5.5). Every figure is computed from task / inspection records over the chosen period; nothing is estimated.
 *  tasksCompleted  : tasks the person cleaned (cleanedBy) that finished the period approved
 *  avgCleanMinutes : mean of (submittedAt - startedAt) over tasks the person submitted in the period
 *  firstPassRate   : approvals on attempt 1 / inspections of attempt 1, as a percentage
 *  rejectionRate   : rejected inspections / all inspections of their work
 *  onTimePct       : tasks submitted before dueAt / tasks submitted
 */
const { HousekeepingTask, RoomInspection, User } = require('../../models');
const { todayStr, addDays, toDate } = require('../../utils/dates');
const { bad } = require('../../utils/ApiError');

const r1 = (n) => Math.round(n * 10) / 10;
async function performance(req, q) {
  const to = q.to || todayStr(); const from = q.from || addDays(toDate(to), -29).toISOString().slice(0, 10);
  if (from > to) throw bad('From date must not be after To date');
  const start = new Date(`${from}T00:00:00+05:30`), end = new Date(`${to}T23:59:59.999+05:30`);
  const [subs, insp] = await Promise.all([
    HousekeepingTask.find({ submittedAt: { $gte: start, $lte: end }, cleanedBy: { $ne: null } }).select('cleanedBy startedAt submittedAt dueAt type status').lean(),
    RoomInspection.find({ inspectedAt: { $gte: start, $lte: end }, cleanedBy: { $ne: null } }).select('cleanedBy result attempt').lean(),
  ]);
  const ids = new Set([...subs.map((s) => String(s.cleanedBy)), ...insp.map((i) => String(i.cleanedBy))]);
  const users = await User.find({ _id: { $in: [...ids] } }).select('name department').lean(); const name = new Map(users.map((u) => [String(u._id), u]));
  const rows = [...ids].map((id) => {
    const mine = subs.filter((s) => String(s.cleanedBy) === id), ins = insp.filter((i) => String(i.cleanedBy) === id);
    const timed = mine.filter((s) => s.startedAt && s.submittedAt); const mins = timed.map((s) => (new Date(s.submittedAt) - new Date(s.startedAt)) / 60000);
    const first = ins.filter((i) => i.attempt === 1), approved = ins.filter((i) => i.result === 'Approved');
    return { user: { _id: id, name: name.get(id)?.name || 'Unknown', department: name.get(id)?.department }, tasksSubmitted: mine.length, tasksCompleted: approved.length,
      avgCleanMinutes: mins.length ? r1(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
      inspections: ins.length, rejected: ins.length - approved.length, rejectionRate: ins.length ? r1(((ins.length - approved.length) / ins.length) * 100) : null,
      firstPassRate: first.length ? r1((first.filter((i) => i.result === 'Approved').length / first.length) * 100) : null,
      onTimePct: mine.length ? r1((mine.filter((s) => s.dueAt && new Date(s.submittedAt) <= new Date(s.dueAt)).length / mine.length) * 100) : null };
  }).sort((a, b) => b.tasksCompleted - a.tasksCompleted || a.user.name.localeCompare(b.user.name));
  if (!req.permissions.has('housekeeping.performance')) return { from, to, rows: rows.filter((r) => r.user._id === String(req.user._id)), definitions: DEFINITIONS };
  return { from, to, rows, definitions: DEFINITIONS };
}
const DEFINITIONS = {
  tasksSubmitted: 'Tasks the person sent for inspection in the period', tasksCompleted: 'Inspections of their work that passed',
  avgCleanMinutes: 'Average time between Start and Submit', rejectionRate: 'Failed inspections ÷ all inspections of their work',
  firstPassRate: 'Passed on the first inspection ÷ first inspections', onTimePct: 'Submitted before the task due time ÷ submitted',
};
module.exports = { performance, DEFINITIONS };
