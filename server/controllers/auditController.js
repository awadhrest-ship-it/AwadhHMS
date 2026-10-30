const { AuditLog, Notification } = require('../models');
const { wrap, escapeRegex } = require('../utils/wrap');
const { notFound } = require('../utils/ApiError');

exports.list = wrap(async (req, res) => {
  const { module, action, user, entityId, q, from, to } = req.query; const f = {};
  if (module) f.module = module; if (action) f.action = action; if (user) f.user = user; if (entityId) f.entityId = entityId;
  if (from || to) { f.timestamp = {}; if (from) f.timestamp.$gte = new Date(from); if (to) f.timestamp.$lte = new Date(`${to}T23:59:59.999+05:30`); }
  if (q) { const rx = new RegExp(escapeRegex(q), 'i'); f.$or = [{ entityLabel: rx }, { userName: rx }, { note: rx }]; }
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(200, Number(req.query.limit) || 50);
  const [data, total] = await Promise.all([AuditLog.find(f).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit), AuditLog.countDocuments(f)]);
  res.json({ success: true, data, total, page, pages: Math.ceil(total / limit) });
});
exports.modules = wrap(async (_req, res) => res.json({ success: true, data: await AuditLog.distinct('module') }));

/* ---- notifications: visible to the recipient user or anyone holding the recipient permission ---- */
const scope = (req) => ({ $or: [{ recipientUser: req.user._id }, { recipientPermission: { $in: [...req.permissions] } }] });
exports.myNotifications = wrap(async (req, res) => {
  const items = await Notification.find(scope(req)).sort({ createdAt: -1 }).limit(40);
  const uid = String(req.user._id);
  const data = items.map((n) => ({ ...n.toObject(), read: n.readBy.map(String).includes(uid) }));
  res.json({ success: true, data, unread: data.filter((n) => !n.read).length });
});
exports.markRead = wrap(async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, ...scope(req) }, { $addToSet: { readBy: req.user._id } }); if (!n) throw notFound('Notification not found');
  res.json({ success: true });
});
exports.markAllRead = wrap(async (req, res) => { await Notification.updateMany(scope(req), { $addToSet: { readBy: req.user._id } }); res.json({ success: true }); });
