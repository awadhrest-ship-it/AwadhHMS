const { Schema, model } = require('mongoose');
const ref = (m) => ({ type: Schema.Types.ObjectId, ref: m });
/**
 * One row per (ticket, station): the moment a station's share of a ticket first crossed its delay threshold. `key` is unique, so however many times
 * the sweeper / board runs, a ticket can only raise ONE alert per station (no notification spam). It is resolved when the work is Ready or Cancelled.
 */
const schema = new Schema({
  key: { type: String, required: true, unique: true },                               // `${ticket}:${station}`
  ticket: { ...ref('KitchenTicket'), index: true }, ticketNumber: String, orderNumber: String, orderType: String, station: String,
  thresholdMinutes: Number, queuedAt: Date, crossedAt: Date, raisedAt: { type: Date, default: Date.now }, statusAtRaise: String,
  notified: [ref('User')], notifiedCount: { type: Number, default: 0 }, noRecipients: { type: Boolean, default: false },
  escalatedAt: Date, escalatedCount: { type: Number, default: 0 },
  resolvedAt: Date, resolution: { type: String, enum: ['Ready', 'Cancelled', 'Served', 'Reassigned'] }, totalMinutes: Number,
}, { timestamps: true });
schema.index({ resolvedAt: 1, raisedAt: -1 });
module.exports = model('KitchenDelayAlert', schema);
