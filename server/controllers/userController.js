const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { User, Role } = require('../models');
const { DEPARTMENTS, ALL } = require('../config/permissions');
const { audit } = require('../services/audit');
const { wrap, parse } = require('../utils/wrap');
const { bad, notFound } = require('../utils/ApiError');

const userBase = z.object({
  name: z.string().min(2), email: z.string().email(), phone: z.string().optional(),
  role: z.string().length(24), department: z.enum(DEPARTMENTS), active: z.boolean().optional(),
});
exports.listUsers = wrap(async (_req, res) => res.json({ success: true, data: await User.find().populate('role', 'name key').sort({ name: 1 }) }));
exports.getUser = wrap(async (req, res) => {
  const u = await User.findById(req.params.id).populate('role', 'name key'); if (!u) throw notFound('User not found');
  res.json({ success: true, data: u });
});
exports.createUser = wrap(async (req, res) => {
  const b = parse(userBase.extend({ password: z.string().min(8, 'Password must be at least 8 characters') }), req.body);
  if (!(await Role.exists({ _id: b.role }))) throw bad('Role not found');
  const user = await User.create({ ...b, password: await bcrypt.hash(b.password, 10) });
  await audit(req, { action: 'create', module: 'Users', entity: 'User', entityId: user._id, entityLabel: user.email, newValue: user });
  res.status(201).json({ success: true, data: user });
});
exports.updateUser = wrap(async (req, res) => {
  const b = parse(userBase.partial().extend({ password: z.string().min(8).optional() }), req.body);
  const user = await User.findById(req.params.id); if (!user) throw notFound('User not found');
  const before = user.toObject();
  if (b.password) b.password = await bcrypt.hash(b.password, 10);
  if (String(user._id) === String(req.user._id) && b.active === false) throw bad('You cannot deactivate your own account');
  Object.assign(user, b); await user.save();
  await audit(req, { action: 'update', module: 'Users', entity: 'User', entityId: user._id, entityLabel: user.email, oldValue: before, newValue: user });
  res.json({ success: true, data: user });
});
exports.deleteUser = wrap(async (req, res) => { // soft-delete = deactivate (history stays traceable)
  const user = await User.findById(req.params.id); if (!user) throw notFound('User not found');
  if (String(user._id) === String(req.user._id)) throw bad('You cannot deactivate your own account');
  const before = user.toObject(); user.active = false; await user.save();
  await audit(req, { action: 'delete', module: 'Users', entity: 'User', entityId: user._id, entityLabel: user.email, oldValue: before, newValue: { active: false } });
  res.json({ success: true, data: user });
});

/* ---------- Roles ---------- */
const roleBase = z.object({
  name: z.string().min(2), description: z.string().optional(), department: z.enum(DEPARTMENTS).optional(),
  permissions: z.array(z.string().refine((p) => ALL.includes(p), 'Unknown permission')), crossDepartment: z.boolean().optional(),
});
exports.listRoles = wrap(async (_req, res) => res.json({ success: true, data: await Role.find().sort({ isSystem: -1, name: 1 }) }));
exports.createRole = wrap(async (req, res) => {
  const b = parse(roleBase, req.body);
  const key = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const mine = new Set(req.user.role.permissions);
  if (b.permissions.some((p) => !mine.has(p))) throw bad('You cannot grant permissions you do not hold yourself');
  const role = await Role.create({ ...b, key });
  await audit(req, { action: 'create', module: 'Roles', entity: 'Role', entityId: role._id, entityLabel: role.name, newValue: role });
  res.status(201).json({ success: true, data: role });
});
exports.updateRole = wrap(async (req, res) => {
  const b = parse(roleBase.partial(), req.body);
  const role = await Role.findById(req.params.id); if (!role) throw notFound('Role not found');
  if (role.key === 'hotel_owner') throw bad('The Hotel Owner role cannot be modified');
  if (b.permissions) { const mine = new Set(req.user.role.permissions); if (b.permissions.some((p) => !mine.has(p))) throw bad('You cannot grant permissions you do not hold yourself'); }
  const before = role.toObject(); Object.assign(role, b); await role.save();
  await audit(req, { action: 'update', module: 'Roles', entity: 'Role', entityId: role._id, entityLabel: role.name, oldValue: before, newValue: role });
  res.json({ success: true, data: role });
});
exports.listPermissions = wrap(async (_req, res) => res.json({ success: true, data: await require('../models').Permission.find().sort({ module: 1, code: 1 }) }));
