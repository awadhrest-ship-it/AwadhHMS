/**
 * Modules 7.1 - the kitchen display's ticket engine. It extends the Phase 6 KitchenTicket (one ticket per order round; (order, round) unique) with
 * item-level preparation status, station slices, assignment history and optimistic concurrency. It never creates tickets (Phase 6 does, idempotently).
 *
 *   Queued --start--> Preparing --ready--> Ready --serve (front of house)--> Served          (Cancelled from any pre-Served state)
 *
 * Marking items Ready does NOT serve them, and a ticket is Ready only when every non-cancelled item is Ready.
 */
const { KitchenTicket, MenuItem, User, KitchenDelayAlert, Role } = require('../../models');
const { kitchenSettings } = require('../settings');
const { audit } = require('../audit');
const { notify } = require('../notify');
const events = require('../events');
const C = require('./core');
const { bad, conflict, forbidden, notFound } = require('../../utils/ApiError');

const orders = () => require('../restaurant/orders');
const delays = () => require('./delays');
const who = (req) => ({ by: req.user._id, byName: req.user.name });

/** Optimistic read-modify-write on one ticket: fn(plainTicket) -> { set, push?, ...extras }. Retries when another station updated it first. */
async function mutate(ticketId, fn, tries = 6) {
  for (let n = 0; n < tries; n += 1) {
    const t = await KitchenTicket.findById(ticketId); if (!t) throw notFound('Ticket not found');
    const before = t.toObject(); const res = fn(before);
    if (res.noop) return { before, ticket: t, noop: true, ...res };
    const upd = await KitchenTicket.findOneAndUpdate({ _id: ticketId, ...C.revFilter(t) }, { $set: res.set, ...(res.push ? { $push: res.push } : {}), $inc: { rev: 1 } }, { new: true });
    if (upd) return { before, ticket: upd, ...res };
  }
  throw conflict('This ticket was just updated by someone else - reload and try again');
}

/* ---------------------------------------------------------------- status transitions (item / station / whole ticket) */
const SOURCES = { Preparing: ['Queued'], Ready: ['Preparing'], Served: ['Ready'] };
const VERB = { Preparing: 'started', Ready: 'marked ready', Served: 'served' };
/**
 * Move kitchen items. Target = explicit `itemIds`, or every item of `station`, or (neither) the whole ticket. Only items in the right source status move;
 * with explicit ids all of them must be eligible. `whole: true` (the Phase 6 ticket-level action) may also take Queued items straight to Ready.
 */
async function transition(req, ticketId, { itemIds, station, to, whole = false }) {
  if (!SOURCES[to]) throw bad('Items can only be moved to Preparing, Ready or Served');
  const scope = C.scopeFor(req); const now = new Date();
  const out = await mutate(ticketId, (t) => {
    const cur = t.items.map((i) => ({ ...i, eff: C.itemStatus(t, i) }));
    let targets = cur;
    if (itemIds?.length) { const want = new Set(itemIds.map(String)); targets = cur.filter((i) => want.has(String(i._id))); if (targets.length !== want.size) throw bad('Some of those items are not on this ticket'); }
    else if (station) { if (station !== C.UNASSIGNED && !C.STATIONS.includes(station)) throw bad('Unknown station'); targets = cur.filter((i) => C.stationOf(i) === station); if (!targets.length) throw bad(`This ticket has no items for ${station}`); }
    targets = targets.filter((i) => i.eff !== 'Cancelled');
    if (!targets.length) throw bad('Nothing on this ticket can be moved - it is cancelled');
    if (to !== 'Served') for (const i of targets) if (!C.inScope(scope, C.stationOf(i))) throw forbidden(`You do not work the ${C.stationOf(i)} station`);   // serving is front-of-house work, not station work
    const src = to === 'Ready' && whole ? ['Queued', 'Preparing'] : SOURCES[to];
    const eligible = targets.filter((i) => src.includes(i.eff));
    if (!eligible.length) { const have = [...new Set(targets.map((i) => i.eff))].join(', ').toLowerCase(); throw bad(`A ${t.status.toLowerCase()} ticket cannot be moved to ${to.toLowerCase()} (its items are ${have})`); }
    if (itemIds?.length && eligible.length !== targets.length) throw bad(`Some selected items cannot be ${VERB[to]} - they are ${[...new Set(targets.filter((i) => !src.includes(i.eff)).map((i) => i.eff))].join(', ').toLowerCase()}`);
    const ids = new Set(eligible.map((i) => String(i._id)));
    const items = C.normaliseItems(t).map((i) => {
      if (!ids.has(String(i._id))) return i;
      const n = { ...i, status: to };
      if (to === 'Preparing') Object.assign(n, { startedAt: now, startedBy: req.user._id, startedByName: req.user.name });
      if (to === 'Ready') Object.assign(n, { readyAt: now, readyBy: req.user._id, readyByName: req.user.name, ...(i.startedAt ? {} : { startedAt: now, startedBy: req.user._id, startedByName: req.user.name }) });
      if (to === 'Served') n.servedAt = now;
      return n;
    });
    const status = C.deriveStatus(items.map((i) => i.status));
    const set = { items, status, statusBy: req.user._id };
    if (status !== 'Queued' && !t.startedAt) set.startedAt = now;
    if (['Ready', 'Served'].includes(status) && !t.readyAt) set.readyAt = now;
    if (status === 'Served') set.servedAt = now;
    const stations = [...new Set(eligible.map((i) => C.stationOf(i)))];
    return { set, push: { history: { at: now, ...who(req), action: to, station: stations.join(', '), from: t.status, to: status, items: eligible.map((i) => `${i.quantity} x ${i.name}`) } }, eligible, stations, status };
  });
  const { before, ticket, eligible, stations } = out;
  await audit(req, { action: 'status', module: 'Kitchen', entity: 'KitchenTicket', entityId: ticket._id, entityLabel: `${ticket.ticketNumber} (${ticket.orderNumber})`,
    oldValue: { status: before.status }, newValue: { status: ticket.status, [`items ${VERB[to]}`]: eligible.map((i) => `${i.quantity} x ${i.name}`), stations }, note: stations.join(', ') });
  const settings = await kitchenSettings();
  await delays().reconcileTicket(ticket, settings);
  const order = await orders().syncOrderStatus(ticket.order, req);
  if (ticket.status === 'Ready' && before.status !== 'Ready') await notify({ type: 'restaurant_ticket', title: `${ticket.orderNumber} is ready`, message: `${ticket.orderType}${ticket.tableNumber ? ' - table ' + ticket.tableNumber : ''}${ticket.roomNumber ? ' - room ' + ticket.roomNumber : ''}`, link: '/restaurant/orders', severity: 'info', permission: 'restaurant.orders' });
  events.publish('kitchen.ticket.updated', { ticketId: ticket._id, status: ticket.status, stations });
  return { ticket, order };
}

/** Item cancelled on the order (Phase 6 removeItem): mirror it on the ticket and re-derive the ticket status. */
async function cancelOrderItem(req, ticketId, orderItemId) {
  const now = new Date();
  const out = await mutate(ticketId, (t) => {
    const idx = t.items.findIndex((x) => String(x.orderItem) === String(orderItemId)); if (idx < 0 || t.items[idx].cancelled) return { noop: true };
    const items = C.normaliseItems(t).map((i, k) => (k === idx ? { ...i, cancelled: true, status: 'Cancelled' } : i));
    const status = C.deriveStatus(items.map((i) => i.status));
    const set = { items, status }; if (status === 'Cancelled') set.cancelledAt = now;
    return { set, push: { history: { at: now, ...who(req), action: 'Item cancelled', station: C.stationOf(t.items[idx]), from: t.status, to: status, items: [`${t.items[idx].quantity} x ${t.items[idx].name}`] } } };
  });
  if (!out.noop) await delays().reconcileTicket(out.ticket, await kitchenSettings());
  return out.ticket;
}

/* ---------------------------------------------------------------- assignment & station routing */
async function assign(req, ticketId, { userId, station }) {
  const u = await User.findById(userId).populate('role'); if (!u || !u.active) throw bad('Choose an active staff member');
  if (!u.role?.permissions?.includes('kitchen.update')) throw bad(`${u.name} does not have kitchen access (kitchen.update)`);
  if (station && station !== C.UNASSIGNED && !C.STATIONS.includes(station)) throw bad('Unknown station');
  const now = new Date();
  const out = await mutate(ticketId, (t) => {
    if (['Cancelled', 'Served'].includes(t.status)) throw bad(`A ${t.status.toLowerCase()} ticket cannot be assigned`);
    const live = (t.assignees || []).find((a) => !a.removedAt && String(a.user) === String(u._id) && (a.station || null) === (station || null));
    if (live) return { noop: true };
    const assignees = [...(t.assignees || []), { user: u._id, name: u.name, station: station || undefined, at: now, ...who(req), kind: 'assigned' }];
    return { set: { assignees }, push: { history: { at: now, ...who(req), action: 'Assigned', station: station || 'whole ticket', note: u.name } } };
  });
  if (!out.noop) await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenTicket', entityId: out.ticket._id, entityLabel: `${out.ticket.ticketNumber} assigned to ${u.name}`, newValue: { assignedTo: u.name, station: station || 'whole ticket' } });
  return out.ticket;
}
async function unassign(req, ticketId, { userId, station }) {
  const now = new Date();
  const out = await mutate(ticketId, (t) => {
    let hit = false;
    const assignees = (t.assignees || []).map((a) => { if (!a.removedAt && String(a.user) === String(userId) && (!station || (a.station || null) === station)) { hit = true; return { ...a, removedAt: now }; } return a; });
    if (!hit) throw bad('That person is not assigned to this ticket');
    return { set: { assignees }, push: { history: { at: now, ...who(req), action: 'Unassigned', station: station || 'whole ticket', note: String(userId) } } };
  });
  await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenTicket', entityId: out.ticket._id, entityLabel: `${out.ticket.ticketNumber} assignment removed`, newValue: { removed: String(userId) } });
  return out.ticket;
}
/** A chef takes a ticket (or one station's share) for themselves - recorded as `claimed`, distinct from a manager's assignment. */
async function claim(req, ticketId, { station }) {
  const scope = C.scopeFor(req);
  if (station && !C.inScope(scope, station)) throw forbidden(`You do not work the ${station} station`);
  const now = new Date();
  const out = await mutate(ticketId, (t) => {
    if (['Cancelled', 'Served'].includes(t.status)) throw bad(`A ${t.status.toLowerCase()} ticket cannot be claimed`);
    if ((t.assignees || []).some((a) => !a.removedAt && String(a.user) === String(req.user._id) && (a.station || null) === (station || null))) return { noop: true };
    return { set: { assignees: [...(t.assignees || []), { user: req.user._id, name: req.user.name, station: station || undefined, at: now, ...who(req), kind: 'claimed' }] }, push: { history: { at: now, ...who(req), action: 'Claimed', station: station || 'whole ticket' } } };
  });
  return out.ticket;
}
/** Route one ticket item to a (different) station - the way to rescue items of a menu item that had no station when it was ordered. */
async function reassignStation(req, ticketId, itemId, station) {
  if (!C.STATIONS.includes(station)) throw bad(`Choose one of: ${C.STATIONS.join(', ')}`);
  const now = new Date();
  const out = await mutate(ticketId, (t) => {
    const idx = t.items.findIndex((x) => String(x._id) === String(itemId)); if (idx < 0) throw notFound('Ticket item not found');
    const it = t.items[idx]; const eff = C.itemStatus(t, it);
    if (!['Queued', 'Preparing'].includes(eff)) throw bad(`A ${eff.toLowerCase()} item cannot be re-routed`);
    if (C.stationOf(it) === station) return { noop: true };
    const items = C.normaliseItems(t).map((i, k) => (k === idx ? { ...i, station } : i));
    return { set: { items }, push: { history: { at: now, ...who(req), action: 'Station changed', station, from: C.stationOf(it), to: station, items: [`${it.quantity} x ${it.name}`] } }, was: C.stationOf(it) };
  });
  if (!out.noop) {
    await audit(req, { action: 'update', module: 'Kitchen', entity: 'KitchenTicket', entityId: out.ticket._id, entityLabel: `${out.ticket.ticketNumber} item re-routed`, oldValue: { station: out.was }, newValue: { station } });
    await delays().reconcileTicket(out.ticket, await kitchenSettings());
    events.publish('kitchen.ticket.updated', { ticketId: out.ticket._id, status: out.ticket.status, stations: [station] });
  }
  return out.ticket;
}

/* ---------------------------------------------------------------- the display board */
const cardOf = (t, s, settings, now, alerted, newSecs) => ({
  key: s.key, ticketId: t._id, ticketNumber: t.ticketNumber, orderNumber: t.orderNumber, round: t.round, orderType: t.orderType,
  tableNumber: t.tableNumber, roomNumber: t.roomNumber, customerName: t.customerName, orderNotes: t.notes,
  station: s.station, status: s.status, ticketStatus: t.status, queuedAt: t.queuedAt, startedAt: s.startedAt, readyAt: s.readyAt,
  elapsedMinutes: s.elapsedMinutes, queueMinutes: s.queueMinutes, prepMinutes: s.prepMinutes, thresholdMinutes: s.thresholdMinutes,
  delayed: s.delayed, delayMinutes: s.delayMinutes, alerted: alerted.has(s.key), lateWhenFinished: s.lateWhenFinished,
  isNew: s.status === 'Queued' && (now - new Date(t.queuedAt)) / 1000 <= newSecs,
  items: s.items.map((i) => ({ _id: i._id, name: i.name, quantity: i.quantity, notes: i.notes, status: i.effStatus, cancelled: i.effStatus === 'Cancelled', startedByName: i.startedByName, readyByName: i.readyByName })),
  assignees: (t.assignees || []).filter((a) => !a.removedAt && (!a.station || a.station === s.station)).map((a) => ({ user: a.user, name: a.name, kind: a.kind, station: a.station })),
  hasMultipleStations: false,
});
/** GET /kitchen/board - station slices for the display. Filters: station, orderType, status (csv), delayed=true, new=true, recent=false. */
async function board(req, q = {}, now = new Date()) {
  const settings = await kitchenSettings(); const scope = C.scopeFor(req);
  if (q.station && q.station !== 'all' && !C.inScope(scope, q.station)) throw forbidden(q.station === C.UNASSIGNED ? 'Only managers can see unassigned items' : `You do not work the ${q.station} station`);
  const recentMs = (Number(q.recentMinutes) > 0 ? Number(q.recentMinutes) : 30) * 60000;
  const [active, recent] = await Promise.all([
    KitchenTicket.find({ status: { $in: ['Queued', 'Preparing', 'Ready'] } }).sort({ queuedAt: 1 }).limit(300),
    q.recent === 'false' ? [] : KitchenTicket.find({ status: { $in: ['Cancelled', 'Served'] }, updatedAt: { $gte: new Date(now - recentMs) } }).sort({ updatedAt: -1 }).limit(60),
  ]);
  const tickets = [...active, ...recent];
  const alerts = tickets.length ? await KitchenDelayAlert.find({ ticket: { $in: tickets.map((t) => t._id) } }).select('key resolvedAt').lean() : [];
  const alerted = new Set(alerts.map((a) => a.key));
  let cards = [];
  for (const t of tickets) {
    const sl = C.slicesOf(t, settings, now); const multi = sl.length > 1;
    for (const s of sl) { if (!C.inScope(scope, s.station)) continue; const c = cardOf(t, s, settings, now, alerted, settings.board.newHighlightSeconds); c.hasMultipleStations = multi; cards.push(c); }
  }
  if (q.station && q.station !== 'all') cards = cards.filter((c) => c.station === q.station);
  if (q.orderType) cards = cards.filter((c) => String(q.orderType).split(',').includes(c.orderType));
  if (q.status) cards = cards.filter((c) => String(q.status).split(',').includes(c.status));
  if (q.delayed === 'true') cards = cards.filter((c) => c.delayed);
  if (q.new === 'true') cards = cards.filter((c) => c.isNew);
  const live = cards.filter((c) => ['Queued', 'Preparing', 'Ready'].includes(c.status));
  const stations = [...scope.stations, ...(scope.unassigned ? [C.UNASSIGNED] : [])];
  const counts = Object.fromEntries(stations.map((s) => [s, { Queued: 0, Preparing: 0, Ready: 0, delayed: 0 }]));
  for (const c of live) { const k = counts[c.station]; if (!k) continue; k[c.status] += 1; if (c.delayed) k.delayed += 1; }
  const [unavailable, unassignedMenu] = await Promise.all([
    MenuItem.find({ active: true, available: false }).select('name unavailableReason availabilityChangedAt station').sort({ name: 1 }).lean(),
    MenuItem.countDocuments({ active: true, $or: [{ station: null }, { station: { $exists: false } }, { station: { $nin: C.STATIONS } }] }),
  ]);
  return { now, stations, scope: { all: scope.all, stations: scope.stations, unassigned: scope.unassigned }, cards, counts,
    totals: { queued: live.filter((c) => c.status === 'Queued').length, preparing: live.filter((c) => c.status === 'Preparing').length, ready: live.filter((c) => c.status === 'Ready').length, delayed: live.filter((c) => c.delayed).length, fresh: live.filter((c) => c.isNew).length },
    unavailable, unassignedMenuItems: unassignedMenu, settings: { pollSeconds: settings.board.pollSeconds, newHighlightSeconds: settings.board.newHighlightSeconds, delayEnabled: settings.delay.enabled, defaultMinutes: settings.delay.defaultMinutes } };
}

async function getTicket(req, id) {
  const t = await KitchenTicket.findById(id); if (!t) throw notFound('Ticket not found');
  const settings = await kitchenSettings(); const scope = C.scopeFor(req);
  const slices = C.slicesOf(t, settings).filter((s) => C.inScope(scope, s.station)).map((s) => ({ ...s, items: s.items.map((i) => ({ _id: i._id, name: i.name, quantity: i.quantity, notes: i.notes, status: i.effStatus, startedAt: i.startedAt, readyAt: i.readyAt, startedByName: i.startedByName, readyByName: i.readyByName })) }));
  if (!slices.length) throw forbidden('This ticket has no items for your stations');
  const o = t.toObject(); return { ...o, items: undefined, slices, alerts: await KitchenDelayAlert.find({ ticket: t._id }).lean() };
}

/** Staff who may be assigned (active users whose role holds kitchen.update). */
async function staff() {
  const roles = await Role.find({ permissions: 'kitchen.update' }).select('_id name'); const rid = new Map(roles.map((r) => [String(r._id), r.name]));
  const users = await User.find({ active: true, role: { $in: [...rid.keys()] } }).select('name role department kitchenStations').sort({ name: 1 }).lean();
  return users.map((u) => ({ _id: u._id, name: u.name, role: rid.get(String(u.role)), department: u.department, stations: u.kitchenStations || [] }));
}

module.exports = { mutate, transition, cancelOrderItem, assign, unassign, claim, reassignStation, board, getTicket, staff, cardOf };
