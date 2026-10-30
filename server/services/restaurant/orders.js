/**
 * Module 6.3 - order taking, the order lifecycle and kitchen tickets.
 *
 *   Draft --send--> Confirmed --kitchen--> Preparing --> Ready --> Served --(fully settled)--> Completed
 *     \________________ cancel (reason) ________________/                                    (Cancelled orders are kept, never deleted)
 *
 *  - Order status after "send" is DERIVED from its kitchen tickets (syncOrderStatus); the API never accepts an arbitrary status.
 *  - Completed is reached only automatically, when the order is Served and every bill is settled (reconcile).
 *  - A kitchen ticket (KOT) is raised per "round" of items; (order, round) is unique so retries cannot duplicate a ticket.
 *  - Phase 7 (Kitchen Display) builds on listTickets()/advanceTicket(); nothing here implements the display itself.
 */
const mongoose = require('mongoose');
const { RestaurantOrder, KitchenTicket, RestaurantBill, RestaurantTable, RestaurantReservation, RestaurantClosing, MenuItem, Reservation, Folio, Room, Counter } = require('../../models');
const { restaurantSettings } = require('../settings');
const { audit } = require('../audit');
const { notify } = require('../notify');
const events = require('../events');
const tables = require('./tables');
const { toMinor, fromMinor } = require('./money');
const { todayStr } = require('../../utils/dates');
const { bad, conflict, forbidden, notFound } = require('../../utils/ApiError');

const ACTIVE = RestaurantOrder.ACTIVE;
const by = (req) => ({ by: req.user._id, byName: req.user.name });
const billing = () => require('./billing'); // lazy: billing.js requires this file
const hist = (req, status, note) => ({ status, at: new Date(), ...(req ? by(req) : {}), note });
const normPhone = (p) => (p ? String(p).replace(/[^\d+]/g, '') : p);

async function assertDayOpen(businessDate) {
  if (await RestaurantClosing.exists({ businessDate })) throw conflict(`The restaurant day ${businessDate} is already closed. New orders cannot be opened for it.`);
}
const recalcSubtotal = (order) => { order.subtotal = fromMinor(order.items.filter((i) => i.status !== 'Cancelled').reduce((s, i) => s + toMinor(i.unitPrice) * i.quantity, 0)); };

/** Validates + snapshots menu lines. Availability is enforced HERE (server side), never trusted from the client. */
async function buildItems(lines, settings, req) {
  if (!lines?.length) throw bad('Add at least one item');
  const ids = [...new Set(lines.map((l) => l.menuItem))];
  const menu = await MenuItem.find({ _id: { $in: ids } }).populate('category', 'name');
  const byId = new Map(menu.map((m) => [String(m._id), m]));
  const problems = [];
  const out = lines.map((l) => {
    const m = byId.get(String(l.menuItem));
    if (!m || !m.active) { problems.push(`${m?.name || 'An item'} is no longer on the menu`); return null; }
    if (!m.available) { problems.push(`${m.name} is currently unavailable${m.unavailableReason ? ' (' + m.unavailableReason + ')' : ''}`); return null; }
    if (l.quantity > settings.maxQuantityPerLine) { problems.push(`${m.name}: quantity cannot exceed ${settings.maxQuantityPerLine}`); return null; }
    return { menuItem: m._id, name: m.name, description: m.description, category: m.category?.name, unitPrice: m.price, taxable: m.taxable, quantity: l.quantity, notes: l.notes?.trim() || undefined, station: m.station || null, addedBy: req.user._id, addedAt: new Date() };
  });
  if (problems.length) throw conflict(problems.join('; '), problems.map((p) => ({ message: p })));
  return out;
}

/* ---------------------------------------------------------------- room service: guest / stay / folio must be real and consistent */
async function resolveStay({ stayReservation, roomNumber }) {
  if (!stayReservation) throw bad('Select the guest staying in the room');
  const r = await Reservation.findById(stayReservation).populate('guest', 'firstName lastName');
  if (!r) throw bad('Stay not found');
  if (r.status !== 'Checked In') throw bad(`Room service is only for guests who are checked in (this stay is ${r.status.toLowerCase()})`);
  const room = r.room ? await Room.findById(r.room) : null;
  if (!room) throw bad('This stay has no room assigned');
  if (roomNumber && String(roomNumber).trim() !== room.roomNumber) throw bad(`Room ${roomNumber} does not belong to this guest's stay (they are in room ${room.roomNumber})`);
  const folio = r.folio ? await Folio.findById(r.folio) : null;
  if (!folio || String(folio.reservation) !== String(r._id) || String(folio.guest) !== String(r.guest._id)) throw conflict('The guest bill (folio) for this stay is missing or does not match the stay - charges cannot be posted');
  if (folio.status !== 'Open') throw conflict(`The guest bill ${folio.folioNumber} is ${folio.status.toLowerCase()} - charges cannot be posted`);
  return { reservation: r._id, folio: folio._id, room: room._id, roomNumber: room.roomNumber, guest: r.guest._id, guestName: `${r.guest.firstName} ${r.guest.lastName || ''}`.trim() };
}
async function inHouse(q) {
  const f = { status: 'Checked In', room: { $ne: null } };
  const rows = await Reservation.find(f).populate('guest', 'firstName lastName').populate('room', 'roomNumber').select('reservationNumber guest room checkOut folio').sort({ checkOut: 1 }).limit(100);
  const rx = q ? new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  return rows.filter((r) => r.folio && r.room && r.guest && (!rx || rx.test(r.room.roomNumber) || rx.test(`${r.guest.firstName} ${r.guest.lastName}`) || rx.test(r.reservationNumber)))
    .map((r) => ({ reservationId: r._id, reservationNumber: r.reservationNumber, guestName: `${r.guest.firstName} ${r.guest.lastName || ''}`.trim(), roomNumber: r.room.roomNumber, checkOut: r.checkOut }));
}

/* ---------------------------------------------------------------- create */
async function createOrder(req, b) {
  const key = `${req.user._id}:${b.idempotencyKey}`;
  const replay = async () => {
    const ex = await RestaurantOrder.findOne({ idempotencyKey: key }); if (!ex) return null;
    if (b.send && ex.status === 'Draft' && ex.items.some((i) => i.status === 'Active' && i.round == null)) { try { await sendToKitchen(req, ex._id); } catch { /* reported by the next load */ } }
    return { order: await getOrder(ex._id), replayed: true };
  };
  const again = await replay(); if (again) return again;

  const businessDate = todayStr(); await assertDayOpen(businessDate);
  const settings = await restaurantSettings();
  const items = await buildItems(b.items, settings, req);
  const _id = new mongoose.Types.ObjectId();
  const doc = { _id, idempotencyKey: key, type: b.type, status: 'Draft', businessDate, items, notes: b.notes?.trim() || undefined, createdBy: req.user._id, createdByName: req.user.name, statusHistory: [hist(req, 'Draft')] };
  let table = null, reservation = null;

  if (b.type === 'Dine-in') {
    if (!b.table) throw bad('Select a table for a dine-in order');
    if (b.reservation) {
      reservation = await RestaurantReservation.findById(b.reservation);
      if (!reservation || !['Booked', 'Seated'].includes(reservation.status)) throw bad('That reservation cannot be seated (it is not booked)');
      if (String(reservation.table) !== String(b.table)) throw bad('The reservation is for a different table');
      if (reservation.status === 'Seated' && reservation.order && await RestaurantOrder.exists({ _id: reservation.order, status: { $in: ACTIVE } })) throw conflict('This reservation already has an open order');
    }
    table = await tables.assertTableUsable(b.table, { allowReservation: reservation?._id });
    Object.assign(doc, { table: table._id, tableNumber: table.number, covers: b.covers, reservation: reservation?._id });
  } else if (b.type === 'Takeaway') {
    doc.customer = { name: b.customer?.name?.trim(), phone: normPhone(b.customer?.phone) };
  } else if (b.type === 'Delivery') {
    const d = b.delivery || {}; const miss = settings.deliveryRequiredFields.filter((f) => !String(d[f] || '').trim());
    if (miss.length) throw bad(`Delivery details missing: ${miss.join(', ')}`, miss.map((f) => ({ field: `delivery.${f}`, message: 'Required for delivery orders' })));
    doc.delivery = { contactName: d.contactName?.trim(), phone: normPhone(d.phone), address: d.address?.trim(), landmark: d.landmark?.trim(), instructions: d.instructions?.trim() };
    doc.customer = { name: d.contactName?.trim(), phone: normPhone(d.phone) };
  } else if (b.type === 'Room Service') {
    doc.stay = await resolveStay({ stayReservation: b.stayReservation, roomNumber: b.roomNumber });   // the billing account comes from the database, never from the client's name/room text
  } else throw bad('Unknown order type');
  recalcSubtotal(Object.assign(doc, { items }));

  try {
    if (table) await tables.claimTable(table._id, _id);
  } catch (e) { const r2 = await replay(); if (r2) return r2; throw e; }
  let order;
  try {
    doc.orderNumber = await Counter.next('ORD', 4);
    order = await RestaurantOrder.create(doc);
  } catch (e) {
    if (table) await tables.releaseTable(table._id, _id);
    if (e.code === 11000) { const r2 = await replay(); if (r2) return r2; }
    throw e;
  }
  if (reservation) await RestaurantReservation.updateOne({ _id: reservation._id, status: { $in: ['Booked', 'Seated'] } }, { $set: { status: 'Seated', order: order._id }, $push: { history: { at: new Date(), ...by(req), action: 'Seated', note: `Order ${order.orderNumber}` } } });
  await audit(req, { action: 'create', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: `${order.orderNumber} ${order.type}${order.tableNumber ? ' ' + order.tableNumber : ''}`, newValue: order });
  events.publish('restaurant.order.created', { orderId: order._id, type: order.type });
  if (b.send) await sendToKitchen(req, order._id);
  return { order: await getOrder(order._id), replayed: false };
}

/* ---------------------------------------------------------------- guards for editing */
async function loadMutable(id) {
  const order = await RestaurantOrder.findById(id); if (!order) throw notFound('Order not found');
  if (!ACTIVE.includes(order.status)) throw bad(`A ${order.status.toLowerCase()} order cannot be changed`);
  if (await RestaurantBill.exists({ order: order._id, status: 'Final' })) throw conflict('This order has a finalised bill. Void the bill (needs approval) before changing the order.');
  return order;
}
const saveOrder = async (order, req) => {
  order.updatedBy = req.user._id; order.updatedByName = req.user.name;
  try { await order.save(); } catch (e) { if (e.name === 'VersionError') throw conflict('This order was just changed by someone else - reload and try again'); throw e; }
};
const touched = (order, why) => billing().supersedeDraftBills(order._id, why);

async function updateDetails(req, id, b) {
  const order = await loadMutable(id); const before = order.toObject();
  if (b.notes !== undefined) order.notes = b.notes?.trim() || undefined;
  if (b.covers !== undefined && order.type === 'Dine-in') order.covers = b.covers;
  if (b.customer && order.type === 'Takeaway') order.customer = { name: b.customer.name?.trim(), phone: normPhone(b.customer.phone) };
  if (b.delivery && order.type === 'Delivery') {
    const settings = await restaurantSettings(); const d = { ...(order.delivery?.toObject?.() || {}), ...b.delivery };
    const miss = settings.deliveryRequiredFields.filter((f) => !String(d[f] || '').trim()); if (miss.length) throw bad(`Delivery details missing: ${miss.join(', ')}`);
    order.delivery = { contactName: d.contactName?.trim(), phone: normPhone(d.phone), address: d.address?.trim(), landmark: d.landmark?.trim(), instructions: d.instructions?.trim() };
    order.customer = { name: d.contactName?.trim(), phone: normPhone(d.phone) };
  }
  await saveOrder(order, req);
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: order.orderNumber, oldValue: { notes: before.notes, covers: before.covers, customer: before.customer, delivery: before.delivery }, newValue: { notes: order.notes, covers: order.covers, customer: order.customer, delivery: order.delivery } });
  return getOrder(order._id);
}
async function addItems(req, id, lines) {
  const order = await loadMutable(id); const settings = await restaurantSettings();
  const items = await buildItems(lines, settings, req);
  items.forEach((i) => order.items.push(i)); recalcSubtotal(order); await saveOrder(order, req);
  await touched(order, 'Items were added to the order');
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: order.orderNumber, newValue: { added: items.map((i) => `${i.quantity} x ${i.name}`) } });
  return getOrder(order._id);
}
const findItem = (order, itemId) => { const it = order.items.id(itemId); if (!it) throw notFound('Order item not found'); return it; };
async function updateItem(req, id, itemId, b) {
  const order = await loadMutable(id); const it = findItem(order, itemId); const was = { quantity: it.quantity, notes: it.notes };
  if (it.status !== 'Active') throw bad('This item is cancelled');
  if (it.round != null) throw conflict('This item has already been sent to the kitchen. Add a new line to order more, or cancel it (manager) to remove it.');
  const settings = await restaurantSettings();
  if (b.quantity !== undefined) { if (b.quantity > settings.maxQuantityPerLine) throw bad(`Quantity cannot exceed ${settings.maxQuantityPerLine}`); it.quantity = b.quantity; }
  if (b.notes !== undefined) it.notes = b.notes?.trim() || undefined;
  recalcSubtotal(order); await saveOrder(order, req); await touched(order, 'An item was changed');
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: `${order.orderNumber} ${it.name}`, oldValue: was, newValue: { quantity: it.quantity, notes: it.notes } });
  return getOrder(order._id);
}
/** Unsent item: removed outright. Sent item: needs restaurant.void + a reason and is kept as Cancelled (the kitchen ticket is updated). */
async function removeItem(req, id, itemId, reason) {
  const order = await loadMutable(id); const it = findItem(order, itemId);
  if (it.status !== 'Active') throw bad('This item is already cancelled');
  const active = order.items.filter((i) => i.status === 'Active');
  if (it.round == null) {
    if (active.length === 1 && order.status === 'Draft') throw bad('An order needs at least one item - cancel the order instead');
    order.items = order.items.filter((x) => String(x._id) !== String(it._id)); // never reached the kitchen: no trace needed beyond the audit log (whole-array $set: portable, $pull on subdocs is not supported by FerretDB)
    recalcSubtotal(order); await saveOrder(order, req); await touched(order, 'An item was removed');
    await audit(req, { action: 'delete', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: `${order.orderNumber} ${it.name}`, oldValue: { name: it.name, quantity: it.quantity } });
    return getOrder(order._id);
  }
  if (!req.permissions.has('restaurant.void')) throw forbidden('Only a manager can cancel an item that was already sent to the kitchen');
  if (!reason || reason.trim().length < 3) throw bad('Enter a reason for cancelling this item');
  if (active.length === 1) throw bad('This is the last item - cancel the whole order instead');
  it.status = 'Cancelled'; it.cancelReason = reason.trim(); it.cancelledAt = new Date(); it.cancelledBy = req.user._id;
  recalcSubtotal(order); await saveOrder(order, req);
  const tickets = await KitchenTicket.find({ order: order._id, status: { $ne: 'Cancelled' } });
  for (const t of tickets) {
    const ti = t.items.find((x) => String(x.orderItem) === String(it._id)); if (!ti) continue;
    ti.cancelled = true; if (t.items.every((x) => x.cancelled)) { t.status = 'Cancelled'; t.cancelledAt = new Date(); } await t.save();
  }
  await touched(order, 'An item was cancelled'); await syncOrderStatus(order._id, req);
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: `${order.orderNumber} ${it.name}`, oldValue: { status: 'Active', quantity: it.quantity }, newValue: { status: 'Cancelled' }, note: reason });
  await notify({ type: 'restaurant_order', title: `Item cancelled on ${order.orderNumber}`, message: `${it.quantity} x ${it.name} - ${reason}`, link: '/restaurant/orders', severity: 'warning', permission: 'restaurant.kitchen' });
  return getOrder(order._id);
}

/* ---------------------------------------------------------------- kitchen tickets */
async function sendToKitchen(req, id) {
  let order = await RestaurantOrder.findById(id); if (!order) throw notFound('Order not found');
  if (!ACTIVE.includes(order.status)) throw bad(`A ${order.status.toLowerCase()} order cannot be sent to the kitchen`);
  // heal: items already on a ticket but not yet marked (a previous attempt stopped half-way) are NOT sent again
  const sentIds = new Set((await KitchenTicket.find({ order: order._id }).select('items.orderItem')).flatMap((t) => t.items.map((i) => String(i.orderItem))));
  const stale = order.items.filter((i) => i.status === 'Active' && i.round == null && sentIds.has(String(i._id)));
  if (stale.length) { const last = await KitchenTicket.findOne({ order: order._id }).sort({ round: -1 }); stale.forEach((i) => { i.round = last.round; }); await order.save(); }
  const unsent = order.items.filter((i) => i.status === 'Active' && i.round == null);
  const latest = async () => KitchenTicket.findOne({ order: id }).sort({ round: -1 });
  if (!unsent.length) { const t = await latest(); if (t) return { order: await getOrder(id), ticket: t, replayed: true }; throw bad('Add at least one item before sending to the kitchen'); }
  if (await RestaurantBill.exists({ order: id, status: 'Final' })) throw conflict('This order has a finalised bill');
  const round = order.rounds + 1;
  const claimed = await RestaurantOrder.findOneAndUpdate({ _id: id, rounds: order.rounds }, { $inc: { rounds: 1 } }, { new: true });
  if (!claimed) { const t = await latest(); return { order: await getOrder(id), ticket: t, replayed: true }; }   // a concurrent request is already sending these items
  const room = order.stay?.roomNumber;
  let ticket;
  try {
    ticket = await KitchenTicket.create({
      ticketNumber: await Counter.next('KOT', 4), order: order._id, orderNumber: order.orderNumber, round, orderRound: `${order._id}:${round}`, orderType: order.type,
      tableNumber: order.tableNumber, roomNumber: room, customerName: order.stay?.guestName || order.customer?.name, notes: order.notes,
      items: unsent.map((i) => ({ orderItem: i._id, name: i.name, quantity: i.quantity, notes: i.notes, station: i.station })),
    });
  } catch (e) { if (e.code === 11000) { const t = await KitchenTicket.findOne({ orderRound: `${order._id}:${round}` }); return { order: await getOrder(id), ticket: t, replayed: true }; } throw e; }
  order = await RestaurantOrder.findById(id);
  order.items.forEach((i) => { if (i.status === 'Active' && i.round == null && unsent.some((u) => String(u._id) === String(i._id))) i.round = round; });
  if (order.status === 'Draft') { order.status = 'Confirmed'; order.statusHistory.push(hist(req, 'Confirmed', 'Sent to kitchen')); }
  await saveOrder(order, req);
  await syncOrderStatus(order._id, req);
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'KitchenTicket', entityId: ticket._id, entityLabel: `${ticket.ticketNumber} for ${order.orderNumber}`, newValue: { round, items: unsent.map((i) => `${i.quantity} x ${i.name}`) }, note: 'Sent to kitchen' });
  events.publish('restaurant.ticket.created', { ticketId: ticket._id, orderId: order._id, round });
  await notify({ type: 'restaurant_ticket', title: `New kitchen order ${ticket.ticketNumber}`, message: `${order.type}${order.tableNumber ? ' - table ' + order.tableNumber : ''}${room ? ' - room ' + room : ''}: ${unsent.length} item(s)`, link: '/restaurant/orders', severity: 'info', permission: 'restaurant.kitchen' });
  return { order: await getOrder(id), ticket, replayed: false };
}

const NEXT = { Queued: ['Preparing'], Preparing: ['Ready'], Ready: ['Served'] };
const STAMP = { Preparing: 'startedAt', Ready: 'readyAt', Served: 'servedAt' };
async function advanceTicket(req, ticketId, to) {
  const t = await KitchenTicket.findById(ticketId); if (!t) throw notFound('Ticket not found');
  const need = to === 'Served' ? 'restaurant.orders' : 'restaurant.kitchen';
  if (!req.permissions.has(need)) throw forbidden(`Missing permission: ${need}`);
  if (!(NEXT[t.status] || []).includes(to)) throw bad(`A ${t.status.toLowerCase()} ticket cannot be moved to ${to.toLowerCase()}`);
  const upd = await KitchenTicket.findOneAndUpdate({ _id: ticketId, status: t.status }, { $set: { status: to, [STAMP[to]]: new Date(), statusBy: req.user._id } }, { new: true });
  if (!upd) throw conflict('This ticket was just updated by someone else - reload');
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'KitchenTicket', entityId: t._id, entityLabel: `${t.ticketNumber} (${t.orderNumber})`, oldValue: { status: t.status }, newValue: { status: to } });
  const order = await syncOrderStatus(upd.order, req);
  if (to === 'Ready') await notify({ type: 'restaurant_ticket', title: `${t.orderNumber} is ready`, message: `${t.orderType}${t.tableNumber ? ' - table ' + t.tableNumber : ''}${t.roomNumber ? ' - room ' + t.roomNumber : ''}`, link: '/restaurant/orders', severity: 'info', permission: 'restaurant.orders' });
  return { ticket: upd, order };
}
async function serveOrder(req, id) {
  const order = await RestaurantOrder.findById(id); if (!order) throw notFound('Order not found');
  if (!['Confirmed', 'Preparing', 'Ready', 'Served'].includes(order.status)) throw bad(`A ${order.status.toLowerCase()} order cannot be served`);
  const tickets = await KitchenTicket.find({ order: id, status: { $ne: 'Cancelled' } });
  if (!tickets.length) throw bad('Nothing has been sent to the kitchen yet');
  const notReady = tickets.filter((t) => ['Queued', 'Preparing'].includes(t.status));
  if (notReady.length) throw conflict(`${notReady.map((t) => t.ticketNumber).join(', ')} not ready yet - the kitchen must mark it ready first`);
  for (const t of tickets.filter((x) => x.status === 'Ready')) await KitchenTicket.updateOne({ _id: t._id, status: 'Ready' }, { $set: { status: 'Served', servedAt: new Date(), statusBy: req.user._id } });
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'RestaurantOrder', entityId: order._id, entityLabel: order.orderNumber, newValue: { status: 'Served' } });
  await syncOrderStatus(id, req);
  return getOrder(id);
}
/** Derives the order status from its tickets. A new round after Served legitimately moves the order back to Confirmed. */
async function syncOrderStatus(orderId, req) {
  const order = await RestaurantOrder.findById(orderId);
  if (!order || !['Confirmed', 'Preparing', 'Ready', 'Served'].includes(order.status)) return order;
  const tickets = await KitchenTicket.find({ order: orderId, status: { $ne: 'Cancelled' } });
  if (!tickets.length) return order;
  const all = (arr) => tickets.every((t) => arr.includes(t.status));
  const next = all(['Served']) ? 'Served' : all(['Ready', 'Served']) ? 'Ready' : tickets.some((t) => t.status !== 'Queued') ? 'Preparing' : 'Confirmed';
  if (next !== order.status) {
    await RestaurantOrder.updateOne({ _id: orderId, status: order.status }, { $set: { status: next, ...(next === 'Served' ? { servedAt: new Date() } : {}) }, $push: { statusHistory: hist(req, next) } });
  }
  if (next === 'Served') await reconcile(orderId, req);
  return RestaurantOrder.findById(orderId);
}

/* ---------------------------------------------------------------- billing <-> order reconciliation */
async function reconcile(orderId, req) {
  const order = await RestaurantOrder.findById(orderId); if (!order) return null;
  const bills = await RestaurantBill.find({ order: orderId, status: { $ne: 'Void' } });
  const finals = bills.filter((b) => b.status === 'Final');
  let billingStatus = 'Unbilled';
  if (finals.length) {
    const settled = finals.every((b) => RestaurantBill.SETTLED.includes(b.settlement));
    if (settled && finals.every((b) => b.settlement === 'Posted to Room')) billingStatus = 'Posted to Room';
    else if (settled && finals.every((b) => b.settlement === 'No charge')) billingStatus = 'No charge';
    else if (settled) billingStatus = 'Paid';
    else if (finals.some((b) => b.paidMinor > 0 || b.settlement === 'Paid' || b.settlement === 'Posted to Room')) billingStatus = 'Part-paid';
    else billingStatus = 'Billed';
  }
  if (billingStatus !== order.billingStatus) await RestaurantOrder.updateOne({ _id: orderId }, { $set: { billingStatus } });
  // Completed = served + every active item is billed on a finalised bill + every bill is settled.
  const covered = new Map(); bills.forEach((b) => b.lines.forEach((l) => covered.set(String(l.orderItem), (covered.get(String(l.orderItem)) || 0) + l.quantity)));
  const fullyBilled = order.items.filter((i) => i.status === 'Active').every((i) => covered.get(String(i._id)) === i.quantity);
  if (order.status === 'Served' && bills.length && bills.every((b) => b.status === 'Final' && RestaurantBill.SETTLED.includes(b.settlement)) && fullyBilled) {
    const done = await RestaurantOrder.findOneAndUpdate({ _id: orderId, status: 'Served' }, { $set: { status: 'Completed', completedAt: new Date() }, $push: { statusHistory: hist(req, 'Completed', 'Served and fully settled') } }, { new: true });
    if (done) { await tables.onOrderFinished(done, { completed: true }); events.publish('restaurant.order.completed', { orderId, billingStatus }); }
  }
  return RestaurantOrder.findById(orderId);
}

/* ---------------------------------------------------------------- cancel & transfer */
async function cancelOrder(req, id, reason) {
  if (!reason || reason.trim().length < 3) throw bad('Enter a reason for cancelling the order');
  const order = await RestaurantOrder.findById(id); if (!order) throw notFound('Order not found');
  if (!['Draft', 'Confirmed', 'Preparing', 'Ready'].includes(order.status)) throw bad(order.status === 'Served' ? 'A served order cannot be cancelled - use the bill (void / adjustment) instead' : `A ${order.status.toLowerCase()} order cannot be cancelled`);
  if (order.status !== 'Draft' && !req.permissions.has('restaurant.void')) throw forbidden('Only a manager can cancel an order that was already sent to the kitchen');
  if (await RestaurantBill.exists({ order: id, status: 'Final' })) throw conflict('This order has a finalised bill - void the bill (needs approval) first');
  await touched(order, 'The order was cancelled');
  const upd = await RestaurantOrder.findOneAndUpdate({ _id: id, status: { $in: ['Draft', 'Confirmed', 'Preparing', 'Ready'] } }, { $set: { status: 'Cancelled', cancelledAt: new Date(), cancelReason: reason.trim(), cancelledBy: req.user._id }, $push: { statusHistory: hist(req, 'Cancelled', reason.trim()) } }, { new: true });
  if (!upd) throw conflict('The order was just updated by someone else - reload');
  await KitchenTicket.updateMany({ order: id, status: { $in: ['Queued', 'Preparing', 'Ready'] } }, { $set: { status: 'Cancelled', cancelledAt: new Date() } });
  await tables.onOrderFinished(upd, { completed: false });
  await audit(req, { action: 'status', module: 'Restaurant', entity: 'RestaurantOrder', entityId: id, entityLabel: order.orderNumber, oldValue: { status: order.status }, newValue: { status: 'Cancelled', items: order.items.filter((i) => i.status === 'Active').map((i) => `${i.quantity} x ${i.name}`) }, note: reason });
  if (order.status !== 'Draft') await notify({ type: 'restaurant_order', title: `${order.orderNumber} cancelled`, message: reason, link: '/restaurant/orders', severity: 'warning', permission: 'restaurant.kitchen' });
  return getOrder(id);
}
async function transferOrder(req, id, toTableId) {
  const order = await RestaurantOrder.findById(id); if (!order) throw notFound('Order not found');
  if (order.type !== 'Dine-in') throw bad('Only dine-in orders have a table to transfer');
  if (!ACTIVE.includes(order.status)) throw bad(`A ${order.status.toLowerCase()} order cannot be transferred`);
  if (String(order.table) === String(toTableId)) throw bad('The order is already on that table');
  const to = await tables.assertTableUsable(toTableId, { allowReservation: order.reservation });
  const from = await RestaurantTable.findById(order.table);
  await tables.claimTable(to._id, order._id);                                     // atomic: fails if another order holds the target
  const upd = await RestaurantOrder.findOneAndUpdate({ _id: id, table: order.table, status: { $in: ACTIVE } },
    { $set: { table: to._id, tableNumber: to.number }, $push: { tableHistory: { from: order.tableNumber, to: to.number, at: new Date(), ...by(req) } } }, { new: true });
  if (!upd) { await tables.releaseTable(to._id, order._id); throw conflict('The order was just changed - reload and retry'); }
  await tables.releaseTable(order.table, order._id);
  await KitchenTicket.updateMany({ order: id, status: { $ne: 'Cancelled' } }, { $set: { tableNumber: to.number } });   // the kitchen sees the new table
  if (order.reservation) await RestaurantReservation.updateOne({ _id: order.reservation }, { $set: { table: to._id, tableNumber: to.number } });
  await audit(req, { action: 'update', module: 'Restaurant', entity: 'RestaurantOrder', entityId: id, entityLabel: order.orderNumber, oldValue: { table: from?.number }, newValue: { table: to.number }, note: 'Table transfer' });
  return getOrder(id);
}

/* ---------------------------------------------------------------- reads */
const billBrief = (b) => ({ _id: b._id, billNumber: b.billNumber, label: b.label, status: b.status, settlement: b.settlement, total: b.totals?.total, balance: fromMinor(b.balanceMinor || 0) });
async function getOrder(id) {
  const o = await RestaurantOrder.findById(id); if (!o) throw notFound('Order not found');
  const [tickets, bills] = await Promise.all([KitchenTicket.find({ order: id }).sort({ round: 1 }), RestaurantBill.find({ order: id }).sort({ splitIndex: 1, createdAt: 1 })]);
  const obj = o.toObject();
  return { ...obj, tickets, bills: bills.map(billBrief), unsentItems: o.items.filter((i) => i.status === 'Active' && i.round == null).length };
}
async function listOrders(q = {}) {
  const f = {};
  if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.active === 'true') f.status = { $in: ACTIVE };
  if (q.type) f.type = { $in: String(q.type).split(',') };
  if (q.date) f.businessDate = q.date;
  if (q.from || q.to) { f.businessDate = {}; if (q.from) f.businessDate.$gte = q.from; if (q.to) f.businessDate.$lte = q.to; }
  if (q.table) f.table = q.table;
  if (q.billingStatus) f.billingStatus = q.billingStatus;
  if (q.q) { const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ orderNumber: rx }, { tableNumber: rx }, { 'customer.name': rx }, { 'customer.phone': rx }, { 'stay.roomNumber': rx }, { 'stay.guestName': rx }]; }
  const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Number(q.limit) || 40);
  const [rows, total] = await Promise.all([RestaurantOrder.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), RestaurantOrder.countDocuments(f)]);
  const ids = rows.map((r) => r._id);
  const [bills, tickets] = await Promise.all([RestaurantBill.find({ order: { $in: ids }, status: { $ne: 'Void' } }).lean(), KitchenTicket.find({ order: { $in: ids } }).select('order status ticketNumber').lean()]);
  const data = rows.map((r) => ({ ...r, itemCount: r.items.filter((i) => i.status === 'Active').reduce((s, i) => s + i.quantity, 0), bills: bills.filter((b) => String(b.order) === String(r._id)).map(billBrief),
    tickets: tickets.filter((t) => String(t.order) === String(r._id)).map((t) => ({ _id: t._id, ticketNumber: t.ticketNumber, status: t.status })), items: undefined }));
  return { data, total, page, pages: Math.ceil(total / limit) };
}
async function listTickets(q = {}) {
  const f = {};
  f.status = q.status ? { $in: String(q.status).split(',') } : { $in: ['Queued', 'Preparing', 'Ready'] };
  if (q.order) f.order = q.order;
  return KitchenTicket.find(f).sort({ queuedAt: 1 }).limit(200);
}

module.exports = { createOrder, getOrder, listOrders, listTickets, updateDetails, addItems, updateItem, removeItem, sendToKitchen, advanceTicket, serveOrder, syncOrderStatus, reconcile, cancelOrder, transferOrder, inHouse, assertDayOpen, resolveStay };
