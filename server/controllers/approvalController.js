const { z } = require('zod');
const { ApprovalRequest } = require('../models');
const approvals = require('../services/approvals');
const { wrap, parse } = require('../utils/wrap');
const { notFound } = require('../utils/ApiError');
require('../services/reservations'); // registers approval handlers
require('../services/inventory/approvalHandlers'); // stock adjustments
require('../services/restaurant/billing'); // restaurant discount / complimentary / bill void

const pop = [{ path: 'requestedBy approver', select: 'name' }];
exports.list = wrap(async (req, res) => {
  const f = {}; if (req.query.status) f.status = req.query.status; if (req.query.type) f.type = req.query.type;
  const data = await ApprovalRequest.find(f).sort({ status: 1, requestedAt: -1 }).limit(200).populate(pop);
  const roleKey = req.user.role.key;
  res.json({ success: true, data: data.map((d) => ({ ...d.toObject(), canDecide: d.status === 'Pending' && req.permissions.has('approvals.approve') && (!d.approverRoles?.length || d.approverRoles.includes(roleKey)) })) });
});
exports.get = wrap(async (req, res) => { const a = await ApprovalRequest.findById(req.params.id).populate(pop); if (!a) throw notFound('Request not found'); res.json({ success: true, data: a }); });
exports.approve = wrap(async (req, res) => {
  const { comments } = parse(z.object({ comments: z.string().optional() }), req.body || {});
  res.json({ success: true, data: await approvals.decide(req, req.params.id, true, { comments }), message: 'Request approved' });
});
exports.reject = wrap(async (req, res) => {
  const { reason, comments } = parse(z.object({ reason: z.string().min(3, 'Enter a rejection reason'), comments: z.string().optional() }), req.body || {});
  res.json({ success: true, data: await approvals.decide(req, req.params.id, false, { reason, comments }), message: 'Request rejected' });
});
