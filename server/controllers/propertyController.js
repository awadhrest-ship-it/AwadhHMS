const { z } = require('zod');
const { Property } = require('../models');
const { audit } = require('../services/audit');
const { wrap, parse } = require('../utils/wrap');
const { notFound } = require('../utils/ApiError');

exports.getProperty = wrap(async (_req, res) => {
  const p = await Property.findOne(); if (!p) throw notFound('Property not configured');
  res.json({ success: true, data: p });
});
// Settings hold TBC items as configuration (tax rate, payment methods, ID types, repeat-guest rule, approval thresholds...)
exports.updateProperty = wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().min(2).optional(), location: z.string().optional(), facilities: z.array(z.string()).optional(),
    settings: z.object({
      taxRatePercent: z.number().min(0).max(100).optional(), paymentMethods: z.array(z.string()).optional(),
      bookingSources: z.array(z.string()).optional(), identityDocumentTypes: z.array(z.string()).optional(),
      repeatGuestMatch: z.array(z.enum(['phone', 'email', 'name', 'document'])).optional(),
      complaintCategories: z.array(z.string()).optional(), checkInTime: z.string().optional(), checkOutTime: z.string().optional(),
      approvalRules: z.record(z.object({ required: z.boolean(), approverRoles: z.array(z.string()), thresholds: z.array(z.object({ minAmount: z.number(), approverRoles: z.array(z.string()) })).optional() })).optional(),
    }).optional(),
  }), req.body);
  const p = await Property.findOne(); const before = p.toObject();
  if (b.name) p.name = b.name; if (b.location) p.location = b.location; if (b.facilities) p.facilities = b.facilities;
  if (b.settings) { Object.entries(b.settings).forEach(([k, v]) => p.set(`settings.${k}`, v)); p.markModified('settings'); }
  await p.save();
  await audit(req, { action: 'update', module: 'Property', entity: 'Property', entityId: p._id, entityLabel: p.name, oldValue: before, newValue: p });
  res.json({ success: true, data: p });
});
