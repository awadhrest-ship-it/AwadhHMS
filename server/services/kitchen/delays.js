/**
 * Module 7.2 - delayed-order tracking & alerts.
 *
 * A station's share of a ticket (a "slice") is DELAYED while it is Queued/Preparing and more than its threshold has passed since the ticket was queued.
 * Thresholds, recipients and escalation are configuration (Property.settings.kitchen) - the PDF leaves all three to be confirmed, so the defaults are provisional.
 *
 * No spam: KitchenDelayAlert.key = `${ticket}:${station}` is UNIQUE, so the first sweep that sees a slice over its threshold raises the alert and every later
 * sweep finds the row and does nothing. The alert is resolved when the slice becomes Ready / Cancelled (or is re-routed). Escalation (off by default) adds at most
 * ONE extra alert per row, claimed with an atomic conditional update.
 */
const { KitchenTicket, KitchenDelayAlert, User, Role } = require('../../models');
const { kitchenSettings } = require('../settings');
const { notify } = require('../notify');
const events = require('../events');
const C = require('./core');

const validId = (v) => /^[a-f\d]{24}$/i.test(String(v));
async function recipientUsers(cfg = {}) {
  const roles = (cfg.roles || []).length ? await Role.find({ key: { $in: cfg.roles } }).select('_id') : [];
  const ids = (cfg.users || []).filter(validId);
  if (!roles.length && !ids.length) return [];
  const or = []; if (roles.length) or.push({ role: { $in: roles.map((r) => r._id) } }); if (ids.length) or.push({ _id: { $in: ids } });
  return User.find({ active: true, $or: or }).select('_id name').lean();
}
const describe = (t, s) => `${t.orderNumber} · ${t.orderType}${t.tableNumber ? ' · table ' + t.tableNumber : ''}${t.roomNumber ? ' · room ' + t.roomNumber : ''} · ${s.station} · ${s.status.toLowerCase()} · in kitchen ${Math.round(s.elapsedMinutes)} min (limit ${s.thresholdMinutes}) · delayed ${Math.round(s.delayMinutes)} min`;

async function raise(t, s, settings, now) {
  const key = s.key; let alert;
  try {
    alert = await KitchenDelayAlert.create({ key, ticket: t._id, ticketNumber: t.ticketNumber, orderNumber: t.orderNumber, orderType: t.orderType, station: s.station, thresholdMinutes: s.thresholdMinutes,
      queuedAt: t.queuedAt, crossedAt: new Date(new Date(t.queuedAt).getTime() + s.thresholdMinutes * 60000), raisedAt: now, statusAtRaise: s.status });
  } catch (e) { if (e.code === 11000 || /E11000|duplicate key/i.test(e.message || '')) return null; throw e; }   // already raised: exactly one alert per ticket+station
  const users = await recipientUsers(settings.recipients);
  for (const u of users) await notify({ type: 'kitchen_delay', title: `Delayed kitchen order ${t.ticketNumber}`, message: describe(t, s), link: '/kitchen/display', severity: 'warning', user: u._id });
  await KitchenDelayAlert.updateOne({ _id: alert._id }, { $set: { notified: users.map((u) => u._id), notifiedCount: users.length, noRecipients: users.length === 0 } });
  events.publish('kitchen.delay.raised', { ticketId: t._id, station: s.station });
  return alert;
}
async function resolve(alert, resolution, slice, now) {
  const total = C.minutes(alert.queuedAt, slice?.readyAt || now);
  const r = await KitchenDelayAlert.findOneAndUpdate({ _id: alert._id, resolvedAt: null }, { $set: { resolvedAt: now, resolution, totalMinutes: C.round1(total) } }, { new: true });
  if (r) events.publish('kitchen.delay.resolved', { ticketId: alert.ticket, station: alert.station, resolution });
  return r;
}
const resolutionFor = (slice, ticketStatus) => (!slice ? 'Reassigned' : slice.status === 'Cancelled' ? 'Cancelled' : slice.status === 'Served' ? 'Served' : ['Ready'].includes(slice.status) ? 'Ready' : ticketStatus === 'Cancelled' ? 'Cancelled' : null);

/** Resolve the open alerts of one ticket whose slice is no longer being worked on. Called after every status change. */
async function reconcileTicket(ticket, settings, now = new Date()) {
  const open = await KitchenDelayAlert.find({ ticket: ticket._id, resolvedAt: null }); if (!open.length) return 0;
  const slices = new Map(C.slicesOf(ticket, settings || await kitchenSettings(), now).map((s) => [s.station, s])); let n = 0;
  for (const a of open) { const s = slices.get(a.station); const res = s && C.ACTIVE.includes(s.status) ? null : resolutionFor(s, ticket.status); if (res && await resolve(a, res, s, now)) n += 1; }
  return n;
}
/** Phase 6 cancelled a whole order: close every alert of its tickets. */
async function reconcileOrder(orderId) {
  const tickets = await KitchenTicket.find({ order: orderId }); let n = 0; const settings = await kitchenSettings();
  for (const t of tickets) n += await reconcileTicket(t, settings); return n;
}

/**
 * Raise alerts for slices over their threshold, resolve finished ones, send the (optional, single) escalation. Idempotent and safe to run from several
 * places at once (the interval, the board, tests). `now` is injectable.
 */
async function sweep(now = new Date()) {
  const settings = await kitchenSettings(); const report = { raised: 0, resolved: 0, escalated: 0 };
  if (settings.delay.enabled) {
    const tickets = await KitchenTicket.find({ status: { $in: ['Queued', 'Preparing'] } }).limit(500);
    for (const t of tickets) for (const s of C.slicesOf(t, settings, now)) if (s.delayed && await raise(t, s, settings, now)) report.raised += 1;
  }
  const open = await KitchenDelayAlert.find({ resolvedAt: null }).limit(500);
  for (const a of open) {
    const t = await KitchenTicket.findById(a.ticket); const s = t && C.slicesOf(t, settings, now).find((x) => x.station === a.station);
    const res = !t ? 'Cancelled' : s && C.ACTIVE.includes(s.status) ? null : resolutionFor(s, t.status);
    if (res) { if (await resolve(a, res, s, now)) report.resolved += 1; continue; }
    const esc = settings.escalation;
    if (esc?.enabled && !a.escalatedAt && now >= new Date(new Date(a.raisedAt).getTime() + Number(esc.afterMinutes || 10) * 60000)) {
      const won = await KitchenDelayAlert.findOneAndUpdate({ _id: a._id, escalatedAt: null }, { $set: { escalatedAt: now }, $inc: { escalatedCount: 1 } }, { new: true });
      if (won) {
        const users = await recipientUsers(esc);
        for (const u of users) await notify({ type: 'kitchen_delay', title: `ESCALATION: ${t.ticketNumber} still not ready`, message: describe(t, s), link: '/kitchen/display', severity: 'urgent', user: u._id });
        report.escalated += 1;
      }
    }
  }
  return report;
}
let last = 0;
/** Cheap guard used by the display so alerts still appear if the interval timer is not running (e.g. serverless / tests). */
async function sweepThrottled(ms = 10000) { if (Date.now() - last < ms) return null; last = Date.now(); try { return await sweep(); } catch (e) { console.error('delay sweep failed', e.message); return null; } }
const resetThrottle = () => { last = 0; };
async function list({ open, days = 7 } = {}) {
  const f = { raisedAt: { $gte: new Date(Date.now() - days * 864e5) } }; if (open === 'true') f.resolvedAt = null;
  return KitchenDelayAlert.find(f).sort({ raisedAt: -1 }).limit(200).lean();
}
module.exports = { sweep, sweepThrottled, resetThrottle, reconcileTicket, reconcileOrder, list, recipientUsers };
