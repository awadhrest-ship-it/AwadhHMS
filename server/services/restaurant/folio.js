/**
 * Posting restaurant bills to the EXISTING guest folio (Phase 3). A room-service charge is a charge on the guest's account, not a payment.
 * Idempotent by construction: the charge carries `sourceRef = rb:<billId>:...` and the folio update is a single conditional write that
 * only happens if no charge with that reference exists yet, so retries / double clicks / concurrent requests can never post twice.
 */
const { Folio, RestaurantBill, RestaurantOrder, Reservation } = require('../../models');
const { audit } = require('../audit');
const { notify } = require('../notify');
const { fromMinor } = require('./money');
const { bad, conflict, notFound } = require('../../utils/ApiError');

const STALE_MS = 2 * 60 * 1000;
const refOf = (bill, part) => `rb:${bill._id}:${part}`;
function buildCharges(bill, order, req, sign = 1) {
  const t = bill.totals; const base = { quantity: 1, source: 'restaurant-pos', sourceModel: 'RestaurantBill', sourceId: bill._id, postedBy: req?.user?._id, date: new Date() };
  const tag = sign < 0 ? 'Reversal of room service' : 'Room service';
  const out = [{ ...base, type: 'Room Service', description: `${tag} ${order.orderNumber} (${bill.billNumber})`, unitPrice: sign * t.net, amount: sign * t.net, sourceRef: refOf(bill, sign < 0 ? 'rev:charge' : 'charge') }];
  (t.taxes || []).filter((x) => x.amount > 0).forEach((x) => out.push({ ...base, type: 'Tax', description: `${x.name} ${x.ratePercent}% on ${order.orderNumber} (${bill.billNumber})`, unitPrice: sign * x.amount, amount: sign * x.amount, sourceRef: refOf(bill, `${sign < 0 ? 'rev:' : ''}tax:${x.code}`) }));
  return out;
}
async function refreshFolio(folioId) {
  const f = await Folio.findById(folioId); await f.recalc(); await f.save();
  const r = await Reservation.findById(f.reservation); if (r) await require('../reservations').refreshPaymentStatus(r);
  return f;
}

async function postBill(req, billId) {
  let bill = await RestaurantBill.findById(billId); if (!bill) throw notFound('Bill not found');
  if (bill.status !== 'Final') throw bad('Only a finalised bill can be posted');
  if (bill.orderType !== 'Room Service') throw bad('Only room-service bills are posted to a room folio');
  if (bill.posting.state === 'Posted') return bill;                                       // already done - idempotent
  if (bill.totalMinor <= 0) { await RestaurantBill.updateOne({ _id: billId }, { $set: { settlement: 'No charge' } }); return RestaurantBill.findById(billId); }
  const stale = bill.posting.state === 'Posting' && Date.now() - new Date(bill.updatedAt).getTime() > STALE_MS;
  const claimed = await RestaurantBill.findOneAndUpdate({ _id: billId, ...(stale ? { 'posting.state': 'Posting' } : { 'posting.state': { $in: ['None', 'Failed'] } }) },
    { $set: { 'posting.state': 'Posting', 'posting.error': null }, $inc: { 'posting.attempts': 1 } }, { new: true });
  if (!claimed) { bill = await RestaurantBill.findById(billId); if (bill.posting.state === 'Posted') return bill; throw conflict('This bill is already being posted - try again in a moment'); }
  const order = await RestaurantOrder.findById(bill.order);
  try {
    const folio = order.stay?.folio ? await Folio.findById(order.stay.folio) : null;
    if (!folio || String(folio.reservation) !== String(order.stay.reservation) || String(folio.guest) !== String(order.stay.guest)) throw conflict('The guest folio no longer matches this order\'s stay');
    const res = await Reservation.findById(order.stay.reservation);
    if (!res || res.status !== 'Checked In') throw conflict('The guest is no longer checked in - charge cannot be posted automatically');
    const charges = buildCharges(bill, order, req);
    const r = await Folio.updateOne({ _id: folio._id, status: 'Open', 'charges.sourceRef': { $ne: charges[0].sourceRef } }, { $push: { charges: { $each: charges } } });
    if (!r.matchedCount && !(await Folio.exists({ _id: folio._id, 'charges.sourceRef': charges[0].sourceRef }))) throw conflict(`Guest bill ${folio.folioNumber} is ${folio.status.toLowerCase()} - charge cannot be posted`);
    await refreshFolio(folio._id);
    await RestaurantBill.updateOne({ _id: billId }, { $set: { 'posting.state': 'Posted', 'posting.folio': folio._id, 'posting.postedAt': new Date(), 'posting.postedBy': req?.user?._id, 'posting.amount': bill.totals.total, 'posting.error': null, settlement: 'Posted to Room', paidMinor: 0, balanceMinor: 0 } });
    await audit(req, { action: 'create', module: 'Restaurant Billing', entity: 'Folio', entityId: folio._id, entityLabel: `${folio.folioNumber} <- ${bill.billNumber}`, newValue: { amount: bill.totals.total, order: order.orderNumber, room: order.stay.roomNumber } });
    await require('./orders').reconcile(order._id, req);
  } catch (e) {
    await RestaurantBill.updateOne({ _id: billId }, { $set: { 'posting.state': 'Failed', 'posting.error': e.message } });
    await notify({ type: 'restaurant_posting', title: `Room-service charge not posted (${bill.billNumber})`, message: `${order.orderNumber} room ${order.stay?.roomNumber}: ${e.message}`, link: '/restaurant/bills', severity: 'urgent', permission: 'restaurant.billing' });
  }
  return RestaurantBill.findById(billId);
}

/** Reverses a posted charge (used only after an approved 'Bill editing' void). Adds negative entries - history is never rewritten. */
async function reverseBill(req, billId) {
  const bill = await RestaurantBill.findById(billId); const order = await RestaurantOrder.findById(bill.order);
  const folio = await Folio.findById(bill.posting.folio || order.stay?.folio);
  if (!folio) throw conflict('Guest folio not found');
  const charges = buildCharges(bill, order, req, -1);
  const r = await Folio.updateOne({ _id: folio._id, status: 'Open', 'charges.sourceRef': { $ne: charges[0].sourceRef } }, { $push: { charges: { $each: charges } } });
  if (!r.matchedCount && !(await Folio.exists({ _id: folio._id, 'charges.sourceRef': charges[0].sourceRef }))) throw conflict(`Guest bill ${folio.folioNumber} is ${folio.status.toLowerCase()} - the charge must be reversed manually on the guest bill`);
  await refreshFolio(folio._id);
  await audit(req, { action: 'update', module: 'Restaurant Billing', entity: 'Folio', entityId: folio._id, entityLabel: `${folio.folioNumber} reversal of ${bill.billNumber}`, newValue: { amount: -bill.totals.total } });
}
module.exports = { postBill, reverseBill };
