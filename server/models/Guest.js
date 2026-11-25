const { Schema, model } = require('mongoose');
const schema = new Schema({
  guestId: { type: String, unique: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true, default: '' },
  phone: { type: String, required: true, trim: true, index: true },
  email: { type: String, lowercase: true, trim: true },
  address: String,
  corporate: { name: String, designation: String, contactNote: String },
  travelAgent: { name: String, contactNote: String },
  preferences: [String],
  documents: [{ type: { type: String }, number: String, fileName: String, notes: String, addedAt: { type: Date, default: Date.now } }], // metadata only; types TBC Q15
  vip: { type: Boolean, default: false },
  blacklist: { type: Boolean, default: false },
  blacklistReason: String,
  marketingConsent: { type: Boolean, default: false },
  communicationPreferences: { whatsapp: { type: Boolean, default: false }, sms: { type: Boolean, default: false }, email: { type: Boolean, default: false } }, // data only, no sending (TBC Q17)
  outstandingBalance: { type: Number, default: 0 },
  notes: String,
}, { timestamps: true });
schema.virtual('fullName').get(function () { return `${this.firstName} ${this.lastName || ''}`.trim(); });
schema.set('toJSON', { virtuals: true });
schema.set('toObject', { virtuals: true });
module.exports = model('Guest', schema);
