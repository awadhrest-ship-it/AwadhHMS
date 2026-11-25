const { Schema, model } = require('mongoose');
/** Metadata for an uploaded photo. The bytes live in the storage driver (services/storage.js), never in MongoDB. */
module.exports = model('Attachment', new Schema({
  entityType: { type: String, enum: ['HousekeepingTask', 'HousekeepingReport'], required: true, index: true },
  entityId: { type: Schema.Types.ObjectId, required: true, index: true },
  kind: { type: String, default: 'photo' },            // before | after | damage | missing | found | photo
  caption: String,
  originalName: String, mimeType: { type: String, required: true }, size: { type: Number, required: true },
  storageKey: { type: String, required: true, unique: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));
