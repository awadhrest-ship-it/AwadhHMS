/**
 * Pure helpers for the kitchen (no database access) - everything the display, delay tracking and performance reports agree on.
 *
 *  - A ticket = the items of ONE kitchen round of an order (Phase 6 contract, unchanged). Every item has its own status and a station.
 *  - A "slice" = the part of a ticket that belongs to one station. The kitchen display shows slices, so each station only sees (and acts on) its own items.
 *  - Ticket status is DERIVED from its non-cancelled items (never set independently): Queued -> Preparing -> Ready -> Served.
 */
const { KitchenTicket } = require('../../models');

const STATIONS = KitchenTicket.STATIONS;           // Main kitchen, Indian, Chinese, Tandoor
const UNASSIGNED = 'Unassigned';
const STATUS_ORDER = ['Queued', 'Preparing', 'Ready', 'Served'];
const ACTIVE = ['Queued', 'Preparing'];            // "still being worked on" - these can be delayed
const stationOf = (i) => (i && i.station && STATIONS.includes(i.station) ? i.station : UNASSIGNED);

/** Effective status of one ticket item, tolerant of tickets created before Phase 7 (no item status) and of Phase 6 code paths that only touch the ticket. */
function itemStatus(t, i) {
  if (i.cancelled || t.status === 'Cancelled') return 'Cancelled';
  if (t.status === 'Served') return 'Served';
  return i.status || t.status;
}
/** Items with an explicit status on every one (old tickets: copied from the ticket). Used whenever a ticket is rewritten. */
const normaliseItems = (t) => (t.items || []).map((i) => ({ ...i, status: i.cancelled ? 'Cancelled' : (i.status || (t.status === 'Cancelled' ? 'Cancelled' : t.status)) }));
/** Ticket status from the effective item statuses (cancelled items are ignored; nothing left -> Cancelled). */
function deriveStatus(statuses) {
  const live = statuses.filter((s) => s !== 'Cancelled');
  if (!live.length) return 'Cancelled';
  if (live.every((s) => s === 'Served')) return 'Served';
  if (live.every((s) => s === 'Ready' || s === 'Served')) return 'Ready';
  if (live.some((s) => s !== 'Queued')) return 'Preparing';
  return 'Queued';
}
const minutes = (a, b) => (a && b ? Math.max(0, (new Date(b) - new Date(a)) / 60000) : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Delay threshold (minutes) for a station's share of a ticket: station value -> order-type value (if enabled) -> default. */
function thresholdFor(settings, station, orderType) {
  const d = settings.delay || {};
  const st = d.stationMinutes?.[station]; if (Number(st) > 0) return Number(st);
  if (d.orderTypeThresholdsEnabled) { const ot = d.orderTypeMinutes?.[orderType]; if (Number(ot) > 0) return Number(ot); }
  return Number(d.defaultMinutes) > 0 ? Number(d.defaultMinutes) : 20;
}

/** Split a ticket into per-station slices with timing + delay figures. `now` is injectable for tests. */
function slicesOf(ticket, settings, now = new Date()) {
  const t = ticket.toObject ? ticket.toObject() : ticket;
  const by = new Map();
  for (const it of t.items || []) { const s = stationOf(it); if (!by.has(s)) by.set(s, []); by.get(s).push({ ...it, effStatus: itemStatus(t, it) }); }
  const out = [];
  for (const [station, items] of by) {
    const status = deriveStatus(items.map((i) => i.effStatus));
    const live = items.filter((i) => i.effStatus !== 'Cancelled');
    const started = live.map((i) => i.startedAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || (status !== 'Queued' ? t.startedAt : null) || null;
    const readyAll = ['Ready', 'Served'].includes(status);
    const readyAt = readyAll ? (live.map((i) => i.readyAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || t.readyAt || null) : null;
    const endAt = status === 'Cancelled' ? t.cancelledAt : readyAt;
    const thresholdMinutes = thresholdFor(settings, station, t.orderType);
    const isActive = ACTIVE.includes(status);
    const elapsed = minutes(t.queuedAt, isActive ? now : endAt || now);
    const delayed = !!settings.delay?.enabled && isActive && elapsed != null && elapsed > thresholdMinutes;
    out.push({
      key: `${t._id}:${station}`, ticketId: t._id, station, status, items,
      queuedAt: t.queuedAt, startedAt: started, readyAt, thresholdMinutes,
      elapsedMinutes: round1(elapsed), queueMinutes: round1(minutes(t.queuedAt, started || (isActive ? now : null))), prepMinutes: round1(started && readyAt ? minutes(started, readyAt) : (started && isActive ? minutes(started, now) : null)),
      delayed, delayMinutes: delayed ? round1(elapsed - thresholdMinutes) : 0,
      lateWhenFinished: !isActive && status !== 'Cancelled' && elapsed != null && elapsed > thresholdMinutes,   // finished, but later than the threshold in force today
    });
  }
  return out.sort((a, b) => (a.station === UNASSIGNED) - (b.station === UNASSIGNED) || a.station.localeCompare(b.station));
}

/** Which stations the user may see/act on. Users without a station assignment are not restricted; kitchen.allStations always sees everything. */
function scopeFor(req) {
  const perms = req.permissions;
  const mine = (req.user?.kitchenStations || []).filter((s) => STATIONS.includes(s));
  const all = perms.has('kitchen.allStations') || !mine.length;
  return { all, stations: all ? [...STATIONS] : mine, unassigned: all || perms.has('kitchen.stations') };
}
const inScope = (scope, station) => (station === UNASSIGNED ? scope.unassigned : scope.stations.includes(station));

const revFilter = (t) => (t.rev ? { rev: t.rev } : { $or: [{ rev: 0 }, { rev: { $exists: false } }] });
const rup = (n) => Math.round(Number(n || 0) * 100) / 100;

module.exports = { normaliseItems, STATIONS, UNASSIGNED, STATUS_ORDER, ACTIVE, stationOf, itemStatus, deriveStatus, thresholdFor, slicesOf, scopeFor, inScope, revFilter, minutes, round1, rup };
