const { Schema, model } = require('mongoose');
const { RATE_PLAN_TYPES } = require('../config/permissions');
const adjustment = { type: { type: String, enum: ['flat', 'percent'], default: 'flat' }, value: { type: Number, default: 0 } };
/**
 * Configurable rate plan (requirements 2.3, factors/priority TBC Q09/Q10).
 * Nightly price = first matching rule (in listed order) -> rule.rate (fixed) or category base price,
 * then rule.adjustment. If no rule matches: category base price + defaultAdjustment.
 * "First match wins" is a DEMO default - the real priority order is TBC.
 */
module.exports = model('RatePlan', new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  type: { type: String, enum: RATE_PLAN_TYPES, required: true },
  description: String,
  mealPlan: { type: String, default: 'None' },
  defaultAdjustment: adjustment,
  rules: [{
    label: String,
    roomCategory: { type: Schema.Types.ObjectId, ref: 'RoomCategory' }, // empty = all categories
    daysOfWeek: [Number],            // 0=Sun..6=Sat ; empty = every day (weekday/weekend)
    dateFrom: Date, dateTo: Date,    // season / festival window
    minNights: Number, maxNights: Number,
    minGuests: Number, maxGuests: Number,  // number of guests (adults+children)
    clientName: String,              // corporate client / travel agent (free text, TBC)
    bookingSource: String,           // booking platform (TBC Q11)
    rate: Number,                    // fixed nightly rate (optional)
    adjustment,
  }],
  active: { type: Boolean, default: true },
}, { timestamps: true }));
