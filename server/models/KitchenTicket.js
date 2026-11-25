const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
const STATUSES = ['Queued', 'Preparing', 'Ready', 'Served', 'Cancelled'];
const STATIONS = ['Main kitchen', 'Indian', 'Chinese', 'Tandoor'];   // PDF Phase 7: the four stations. Items without a station are shown as "Unassigned" (never hidden).
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
  // Phase 7 extension (backward compatible): each item carries its own preparation status. `status` is always DERIVED from the non-cancelled items
  // (see services/kitchen/lifecycle.js); old tickets without item statuses are read as "same as the ticket" and back-filled by the migration.
  items: [{ orderItem: Schema.Types.ObjectId, name: String, quantity: Number, notes: String, station: { type: String, default: null }, cancelled: { type: Boolean, default: false },
    status: { type: String, enum: STATUSES }, startedAt: Date, readyAt: Date, servedAt: Date, startedBy: ref('User'), startedByName: String, readyBy: ref('User'), readyByName: String }],
  notes: String,
  status: { type: String, enum: STATUSES, default: 'Queued', index: true },
  queuedAt: { type: Date, default: Date.now }, startedAt: Date, readyAt: Date, servedAt: Date, cancelledAt: Date,
  statusBy: ref('User'),
  rev: { type: Number, default: 0 },                                       // optimistic-concurrency counter (two stations may update one ticket at the same moment)
  assignees: [{ _id: false, user: ref('User'), name: String, station: String, at: Date, by: ref('User'), byName: String, kind: { type: String, enum: ['assigned', 'claimed'], default: 'assigned' }, removedAt: Date }],
  history: [{ _id: false, at: Date, by: ref('User'), byName: String, action: String, station: String, from: String, to: String, items: [String], note: String }],
}, { timestamps: true });
schema.index({ status: 1, queuedAt: 1 });
const M = model('KitchenTicket', schema); M.STATUSES = STATUSES; M.STATIONS = STATIONS;
module.exports = M;
