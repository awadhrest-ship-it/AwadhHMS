const { ApprovalRequest, Reservation, Role, User, Property, Counter } = require('../models');
const { notify } = require('./notify');
const { audit } = require('./audit');
const { DEFAULT_APPROVAL_RULES } = require('../config/permissions');
const { bad, forbidden, notFound } = require('../utils/ApiError');

const handlers = {}; // type -> { apply(request, req), onReject?(request, req) }
const registerHandler = (type, h) => { handlers[type] = h; };

/** Resolve rule for a type. Thresholds are TBC (Q41): if thresholds exist they are used, else the default approverRoles. */
async function ruleFor(type, amount = 0) {
  const prop = await Property.findOne();
  const rules = prop?.settings?.approvalRules || DEFAULT_APPROVAL_RULES;
  const rule = rules[type] || DEFAULT_APPROVAL_RULES[type] || { required: true, approverRoles: ['general_manager', 'hotel_owner'], thresholds: [] };
  let approverRoles = rule.approverRoles;
  const tiers = (rule.thresholds || []).filter((t) => amount >= (t.minAmount || 0)).sort((a, b) => b.minAmount - a.minAmount);
  if (tiers[0]?.approverRoles?.length) approverRoles = tiers[0].approverRoles;
  return { required: rule.required !== false, approverRoles };
}

async function createRequest(req, { type, referenceModel, referenceId, referenceLabel, payload, amount = 0, comments }) {
  const dup = await ApprovalRequest.findOne({ type, referenceId, status: 'Pending' });
  if (dup) throw bad(`A ${type.toLowerCase()} request is already pending for this record (${dup.requestNumber})`);
  const { approverRoles } = await ruleFor(type, amount);
  const ar = await ApprovalRequest.create({
    requestNumber: await Counter.next('APR', 4), type, referenceModel, referenceId, referenceLabel, payload, amount,
    requestedBy: req.user._id, approverRoles, comments,
  });
  await audit(req, { action: 'create', module: 'Approvals', entity: 'ApprovalRequest', entityId: ar._id, entityLabel: `${ar.requestNumber} ${type}`, newValue: ar });
  await notify({ type: 'approval_request', title: `${type} awaiting approval`, message: `${referenceLabel || ''} - requested by ${req.user.name}`, link: '/approvals', severity: 'warning', permission: 'approvals.approve' });
  return ar;
}

async function canDecide(user, ar) {
  const roleKey = user.role?.key;
  return user.role.permissions.includes('approvals.approve') && (!ar.approverRoles?.length || ar.approverRoles.includes(roleKey));
}

async function decide(req, id, approve, { reason, comments } = {}) {
  const ar = await ApprovalRequest.findById(id);
  if (!ar) throw notFound('Approval request not found');
  if (ar.status !== 'Pending') throw bad(`Request already ${ar.status.toLowerCase()}`);
  if (!(await canDecide(req.user, ar))) throw forbidden('You are not an approver for this request type');
  if (!approve && !reason) throw bad('A rejection reason is required');
  const before = ar.toObject();
  const h = handlers[ar.type];
  if (approve && h?.apply) await h.apply(ar, req);
  if (!approve && h?.onReject) await h.onReject(ar, req);
  ar.status = approve ? 'Approved' : 'Rejected';
  ar.approver = req.user._id; ar.approvedAt = new Date();
  if (!approve) ar.rejectionReason = reason;
  if (comments) ar.comments = comments;
  await ar.save();
  await audit(req, { action: approve ? 'approve' : 'reject', module: 'Approvals', entity: 'ApprovalRequest', entityId: ar._id, entityLabel: `${ar.requestNumber} ${ar.type}`, oldValue: before, newValue: ar, note: reason });
  await notify({ type: 'approval_decision', title: `${ar.type} ${ar.status.toLowerCase()}`, message: `${ar.referenceLabel || ''}${reason ? ' - ' + reason : ''}`, link: '/approvals', severity: approve ? 'info' : 'warning', user: ar.requestedBy });
  return ar;
}

module.exports = { registerHandler, createRequest, decide, ruleFor, canDecide };
