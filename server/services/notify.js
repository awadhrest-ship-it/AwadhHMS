const { Notification } = require('../models');
/** notify({ type, title, message, link, severity, permission | user }) - in-app only (no WhatsApp/SMS/push). */
async function notify({ type, title, message, link, severity = 'info', permission, user }) {
  try { return await Notification.create({ type, title, message, link, severity, recipientPermission: permission, recipientUser: user }); }
  catch (e) { console.error('notify failed', e.message); }
}
module.exports = { notify };
