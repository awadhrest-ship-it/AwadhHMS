const { Schema, model } = require('mongoose');
/** Bookkeeping for one-off, idempotent data migrations (see server/migrations). */
module.exports = model('Migration', new Schema({ key: { type: String, unique: true, required: true }, appliedAt: { type: Date, default: Date.now }, note: String }));
