/**
 * Department scoping for stock. Permissions say WHAT a user may do; this says WHICH department's stock they may touch.
 * Cross-department roles and the departments in settings.inventory.allAccessDepartments (default Management, Stores,
 * Purchase) work on every stock department; all other users only on their own department.
 */
const { forbidden, bad } = require('../../utils/ApiError');
const { inventorySettings } = require('../settings');

async function scope(req, settings) {
  const s = settings || await inventorySettings();
  const u = req.user;
  const all = !!u.role?.crossDepartment || s.allAccessDepartments.includes(u.department);
  return { all, departments: all ? s.stockDepartments : s.stockDepartments.filter((d) => d === u.department), stockDepartments: s.stockDepartments, own: u.department };
}
/** Throws 403 unless the user may act on `department` (and 400 if it is not a stock department at all). */
async function assertDepartment(req, department, sc) {
  const s = sc || await scope(req);
  if (!department || !s.stockDepartments.includes(department)) throw bad(`"${department || ''}" is not a stock department`);
  if (!s.all && department !== s.own) throw forbidden(`You can only work with ${s.own} stock`);
  return s;
}
module.exports = { scope, assertDepartment };
