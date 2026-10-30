const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { ApiError, forbidden } = require('../utils/ApiError');
const { MODULE_DEPARTMENT, MODULE_EXTRA_DEPARTMENTS } = require('../config/permissions');

const signToken = (user) => jwt.sign({ sub: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });

async function authenticate(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new ApiError(401, 'Authentication required');
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { throw new ApiError(401, 'Session expired. Please sign in again.'); }
    const user = await User.findById(payload.sub).populate('role');
    if (!user || !user.active) throw new ApiError(401, 'Account not found or disabled');
    req.user = user;
    req.permissions = new Set(user.role?.permissions || []);
    next();
  } catch (e) { next(e); }
}

const can = (req, code) => req.permissions.has(code);

/**
 * requirePermission('rooms.edit') - backend authorization (never rely on hidden buttons).
 * Also enforces department restriction: a non-cross-department user may only use modules owned by
 * their own department (or the module's extra departments). Management department is exempt.
 */
function requirePermission(...codes) {
  return (req, _res, next) => {
    const ok = codes.some((c) => req.permissions.has(c));
    if (!ok) return next(forbidden(`Missing permission: ${codes.join(' or ')}`));
    const moduleKey = codes[0].split('.')[0];
    const owner = MODULE_DEPARTMENT[moduleKey];
    if (owner && !req.user.role.crossDepartment && req.user.department !== 'Management') {
      const allowed = [owner, ...(MODULE_EXTRA_DEPARTMENTS[moduleKey] || [])];
      if (!allowed.includes(req.user.department)) {
        return next(forbidden(`${req.user.department} users cannot access ${moduleKey}`));
      }
    }
    next();
  };
}

module.exports = { signToken, authenticate, requirePermission, can };
