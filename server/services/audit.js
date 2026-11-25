const { AuditLog } = require('../models');
const plain = (v) => (v && typeof v.toObject === 'function' ? v.toObject() : v);
const strip = (v) => { // drop heavy / sensitive fields
  const o = plain(v); if (!o || typeof o !== 'object') return o;
  const { password, history, __v, ...rest } = JSON.parse(JSON.stringify(o)); return rest;
};
/** audit(req, { action, module, entity, entityId, entityLabel, oldValue, newValue, note }) - never throws. */
async function audit(req, e) {
  try {
    const u = req?.user;
    await AuditLog.create({
      user: u?._id, userName: u?.name, userRole: u?.role?.name,
      action: e.action, module: e.module, entity: e.entity, entityId: e.entityId, entityLabel: e.entityLabel,
      oldValue: strip(e.oldValue), newValue: strip(e.newValue), note: e.note,
      ip: req?.ip, userAgent: req?.headers?.['user-agent']?.slice(0, 200),
    });
  } catch (err) { console.error('audit failed', err.message); }
}
module.exports = { audit };
