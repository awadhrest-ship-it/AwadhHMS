const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { User } = require('../models');
const { signToken } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { ApiError } = require('../utils/ApiError');
const { wrap, parse } = require('../utils/wrap');

const shape = (u) => ({ id: u._id, name: u.name, email: u.email, department: u.department, role: { id: u.role._id, key: u.role.key, name: u.role.name, crossDepartment: u.role.crossDepartment }, permissions: u.role.permissions });

exports.login = wrap(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password').populate('role');
  if (!user || !user.active || !(await bcrypt.compare(password, user.password))) throw new ApiError(401, 'Invalid email or password');
  user.lastLoginAt = new Date(); await user.save();
  req.user = user;
  await audit(req, { action: 'login', module: 'Auth', entity: 'User', entityId: user._id, entityLabel: user.email });
  res.json({ success: true, token: signToken(user), user: shape(user) });
});
exports.me = wrap(async (req, res) => res.json({ success: true, user: shape(req.user) }));
exports.logout = wrap(async (req, res) => {
  await audit(req, { action: 'logout', module: 'Auth', entity: 'User', entityId: req.user._id, entityLabel: req.user.email });
  res.json({ success: true }); // JWT is stateless; the client discards the token.
});
exports.shape = shape;
