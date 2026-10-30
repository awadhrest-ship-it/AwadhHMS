const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const STATUSES = ['Queued', 'Preparing', 'Ready', 'Served', 'Cancelled'];
/**
 * Kitchen order ticket (KOT) - the integration contract with Phase 7 (Kitchen Display). One ticket per kitchen "round" of an order.
 * `orderRound` (order id + round) is unique, so a retried / double-clicked "send to kitchen" can never raise a duplicate ticket.
 * Phase 7 reads these through GET /api/restaurant/tickets and moves them with POST /api/restaurant/tickets/:id/status.
 */
const schema = new Schema({
  ticketNumber: { type: String, unique: true },
  order: { ...ref('RestaurantOrder'), required: true, index: true },
  orderNumber: String, round: { type: Number, required: true },
  orderRound: { type: String, required: true, unique: true },
  orderType: { type: String, required: true },
  tableNumber: String, roomNumber: String, customerName: String,
  items: [{ orderItem: Schema.Types.ObjectId, name: String, quantity: Number, notes: String, station: { type: String, default: null }, cancelled: { type: Boolean, default: false } }],
  notes: String,
  status: { type: String, enum: STATUSES, default: 'Queued', index: true },
  queuedAt: { type: Date, default: Date.now }, startedAt: Date, readyAt: Date, servedAt: Date, cancelledAt: Date,
  statusBy: ref('User'),
}, { timestamps: true });
const M = model('KitchenTicket', schema); M.STATUSES = STATUSES;
module.exports = M;
