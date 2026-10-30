const { z } = require('zod');
const { Complaint, Counter, Property, Guest } = require('../models');
const { audit } = require('../services/audit');
const { notify } = require('../services/notify');
const { wrap, parse, escapeRegex } = require('../utils/wrap');
const { notFound, bad } = require('../utils/ApiError');

const pop = [{ path: 'guest', select: 'guestId firstName lastName phone' }, { path: 'room', select: 'roomNumber' }, { path: 'createdBy resolvedBy assignedTo', select: 'name' }];

exports.list = wrap(async (req, res) => {
  const { status, priority, room, guest, q } = req.query; const f = {};
  if (status) f.status = { $in: String(status).split(',') };
  if (priority) f.priority = priority; if (room) f.room = room; if (guest) f.guest = guest;
  if (q) f.$or = [{ complaintNumber: new RegExp(escapeRegex(q), 'i') }, { description: new RegExp(escapeRegex(q), 'i') }];
  res.json({ success: true, data: await Complaint.find(f).sort({ createdAt: -1 }).limit(300).populate(pop) });
});
exports.get = wrap(async (req, res) => {
  const c = await Complaint.findById(req.params.id).populate(pop); if (!c) throw notFound('Complaint not found');
  res.json({ success: true, data: c });
});
exports.create = wrap(async (req, res) => {
  const b = parse(z.object({ guest: z.string().length(24), room: z.string().length(24).nullish(), reservation: z.string().length(24).nullish(), category: z.string().optional(), description: z.string().min(5, 'Describe the complaint'), priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional() }), req.body);
  if (!(await Guest.exists({ _id: b.guest }))) throw bad('Guest not found');
  const c = await Complaint.create({ ...b, room: b.room || undefined, reservation: b.reservation || undefined, complaintNumber: await Counter.next('CMP', 4), createdBy: req.user._id });
  await audit(req, { action: 'create', module: 'Complaints', entity: 'Complaint', entityId: c._id, entityLabel: c.complaintNumber, newValue: c });
  await notify({ type: 'complaint', title: `New ${c.priority.toLowerCase()} complaint`, message: `${c.complaintNumber}: ${c.description.slice(0, 80)}`, link: `/complaints/${c._id}`, severity: ['High', 'Urgent'].includes(c.priority) ? 'urgent' : 'warning', permission: 'complaints.edit' });
  res.status(201).json({ success: true, data: await Complaint.findById(c._id).populate(pop), message: 'Complaint registered' });
});
exports.update = wrap(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['Open', 'In Progress', 'Resolved', 'Closed']).optional(), priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(), category: z.string().optional(), description: z.string().optional(), resolution: z.string().optional(), assignedTo: z.string().length(24).nullish() }), req.body);
  const c = await Complaint.findById(req.params.id); if (!c) throw notFound('Complaint not found');
  if (['Resolved', 'Closed'].includes(b.status) && !(b.resolution || c.resolution)) throw bad('Enter the resolution before resolving or closing');
  const before = c.toObject(); Object.assign(c, { ...b, assignedTo: b.assignedTo || undefined });
  if (b.status === 'Resolved' && !c.resolvedAt) { c.resolvedAt = new Date(); c.resolvedBy = req.user._id; }
  await c.save();
  await audit(req, { action: b.status && b.status !== before.status ? 'status' : 'update', module: 'Complaints', entity: 'Complaint', entityId: c._id, entityLabel: c.complaintNumber, oldValue: before, newValue: c });
  res.json({ success: true, data: await Complaint.findById(c._id).populate(pop), message: 'Complaint updated' });
});
exports.categories = wrap(async (_req, res) => res.json({ success: true, data: (await Property.findOne()).settings.complaintCategories }));
