const { z } = require('zod');
const { RatePlan } = require('../models');
const { RATE_PLAN_TYPES } = require('../config/permissions');
const { quote } = require('../services/pricing');
const { audit } = require('../services/audit');
const { wrap, parse } = require('../utils/wrap');
const { notFound } = require('../utils/ApiError');

const adj = z.object({ type: z.enum(['flat', 'percent']), value: z.number() });
const rule = z.object({
  label: z.string().optional(), roomCategory: z.string().length(24).nullish(), daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dateFrom: z.string().nullish(), dateTo: z.string().nullish(), minNights: z.number().int().nullish(), maxNights: z.number().int().nullish(),
  minGuests: z.number().int().nullish(), maxGuests: z.number().int().nullish(), clientName: z.string().nullish(), bookingSource: z.string().nullish(),
  rate: z.number().min(0).nullish(), adjustment: adj.optional(),
});
const schema = z.object({ name: z.string().min(2), type: z.enum(RATE_PLAN_TYPES), description: z.string().optional(), mealPlan: z.string().optional(), defaultAdjustment: adj.optional(), rules: z.array(rule).optional(), active: z.boolean().optional() });
const clean = (b) => ({ ...b, rules: b.rules?.map((r) => ({ ...r, roomCategory: r.roomCategory || undefined, dateFrom: r.dateFrom || undefined, dateTo: r.dateTo || undefined })) });

exports.list = wrap(async (_req, res) => res.json({ success: true, data: await RatePlan.find().populate('rules.roomCategory', 'name').sort({ name: 1 }) }));
exports.create = wrap(async (req, res) => {
  const p = await RatePlan.create(clean(parse(schema, req.body)));
  await audit(req, { action: 'create', module: 'Pricing', entity: 'RatePlan', entityId: p._id, entityLabel: p.name, newValue: p });
  res.status(201).json({ success: true, data: p });
});
exports.update = wrap(async (req, res) => {
  const p = await RatePlan.findById(req.params.id); if (!p) throw notFound('Rate plan not found');
  const before = p.toObject(); Object.assign(p, clean(parse(schema.partial(), req.body))); await p.save();
  await audit(req, { action: 'update', module: 'Pricing', entity: 'RatePlan', entityId: p._id, entityLabel: p.name, oldValue: before, newValue: p });
  res.json({ success: true, data: p });
});
// POST /rate-plans/quote - price preview used by the reservation wizard (Rate + Confirmation steps)
exports.quote = wrap(async (req, res) => {
  const b = parse(z.object({ categoryId: z.string().length(24), ratePlanId: z.string().length(24).nullish(), checkIn: z.string(), checkOut: z.string(), adults: z.number().int().min(1).default(1), children: z.number().int().min(0).default(0), extraBed: z.boolean().optional(), clientName: z.string().optional(), source: z.string().optional() }), req.body);
  res.json({ success: true, data: await quote({ ...b, ratePlanId: b.ratePlanId || undefined }) });
});
