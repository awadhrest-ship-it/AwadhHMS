const { Schema, model } = require('mongoose');
const { DEFAULT_APPROVAL_RULES } = require('../config/permissions');
module.exports = model('Property', new Schema({
  name: { type: String, required: true },
  location: String,
  totalRoomsApprox: String,
  facilities: [String],
  departments: [String],
  // All of the settings below are configuration, NOT confirmed business rules. See TBC notes.
  settings: {
    currency: { type: String, default: 'INR' },
    checkInTime: { type: String, default: '12:00' },   // demo default - TBC Q13
    checkOutTime: { type: String, default: '11:00' },  // demo default - TBC Q13
    taxRatePercent: { type: Number, default: 0 },      // TBC Q14: taxes not confirmed, 0 until configured
    paymentMethods: { type: [String], default: ['Cash', 'Card', 'UPI', 'Bank Transfer'] }, // TBC Q14 - demo list
    bookingSources: { type: [String], default: ['Walk-in', 'Phone', 'Corporate', 'Travel Agent'] }, // TBC Q11
    identityDocumentTypes: { type: [String], default: ['Aadhaar', 'Passport', 'Driving Licence', 'Voter ID'] }, // TBC Q15
    // TBC Q16: how a repeat guest is identified. Any of: phone, email, name, document.
    repeatGuestMatch: { type: [String], default: ['phone'] },
    complaintCategories: { type: [String], default: ['Room', 'Housekeeping', 'Food & Beverage', 'Staff', 'Billing', 'Noise', 'Maintenance', 'Other'] }, // TBC Q18
    approvalRules: { type: Schema.Types.Mixed, default: DEFAULT_APPROVAL_RULES }, // thresholds TBC Q41
    // Module configuration blobs. These MUST be declared: Mongoose strict mode silently drops undeclared paths, which meant
    // inventory/housekeeping settings were never persisted before Phase 6 (regression test: phase6 "module settings persist").
    inventory: Schema.Types.Mixed, housekeeping: Schema.Types.Mixed, restaurant: Schema.Types.Mixed,
  },
}, { timestamps: true, minimize: false }));
