/**
 * Safe, repeatable initialisation for Phases 4-5. Idempotent: running it any number of times changes nothing after the first run,
 * never deletes data, never removes a permission, and never resets a user's role assignment.
 *   - permission catalogue is upserted
 *   - missing default roles are created (existing roles are left alone except for ADDING the new Phase 4/5 permissions once)
 *   - Hotel Owner always holds every permission
 *   - default units and inventory categories are upserted by code / name
 *   - the 'Stock adjustment' approval rule is switched to "required" once (PDF section 8 requires approval)
 * Run manually with `npm run migrate` (server/), or let the server run it on start-up.
 */
const { Permission, Role, Property, Migration, Unit, InventoryCategory } = require('../models');
const { PERMISSIONS, DEFAULT_ROLES, ALL } = require('../config/permissions');
const { DEFAULT_UNITS } = require('../services/inventory/units');

const NEW_CODES = ALL.filter((c) => c.startsWith('inventory.') || c.startsWith('housekeeping.'));
const PHASE6_CODES = ALL.filter((c) => c.startsWith('restaurant.'));
const CATEGORIES = [
  ['Food ingredients', 'food_ingredients', 'Kitchen', true], ['Soft drinks', 'soft_drinks', 'Restaurant', true], ['Liquor', 'liquor', 'Bar', false],
  ['Linen', 'linen', 'Housekeeping', false], ['Toiletries', 'toiletries', 'Housekeeping', false], ['Cleaning supplies', 'cleaning_supplies', 'Housekeeping', false],
  ['Kitchen supplies', 'kitchen_supplies', 'Kitchen', false], ['Maintenance parts', 'maintenance_parts', 'Maintenance', false],
];

async function once(key, note, fn) {
  if (await Migration.exists({ key })) return false;
  await fn();
  await Migration.updateOne({ key }, { $setOnInsert: { key, note, appliedAt: new Date() } }, { upsert: true });
  return true;
}

async function runMigrations({ log = () => {} } = {}) {
  const report = { permissions: 0, roles: 0, units: 0, categories: 0, rolePermissionGrants: 0 };
  for (const [code, label, module] of PERMISSIONS) {
    const r = await Permission.updateOne({ code }, { $set: { label, module } }, { upsert: true }); if (r.upsertedCount) report.permissions += 1;
  }
  for (const [code, name, dimension, toBase] of DEFAULT_UNITS) {
    const r = await Unit.updateOne({ code }, { $setOnInsert: { code, name, dimension, toBase, isSystem: true, active: true } }, { upsert: true }); if (r.upsertedCount) report.units += 1;
  }
  let order = 10;
  for (const [name, key, defaultDepartment, trackExpiryDefault] of CATEGORIES) {
    const r = await InventoryCategory.updateOne({ name }, { $setOnInsert: { name, key, defaultDepartment, trackExpiryDefault, sortOrder: order, isSystem: true } }, { upsert: true }); if (r.upsertedCount) report.categories += 1; order += 10;
    await InventoryCategory.updateOne({ name, key: { $in: [null, undefined, ''] } }, { $set: { key } });
  }
  for (const def of DEFAULT_ROLES) {
    const existing = await Role.findOne({ key: def.key });
    if (!existing) { await Role.create({ ...def, isSystem: true }); report.roles += 1; continue; }
    await once(`phase45-role:${def.key}`, 'Grant new Phase 4/5 permissions to the default role (additive only)', async () => {
      const add = def.permissions.filter((p) => NEW_CODES.includes(p) && !existing.permissions.includes(p));
      if (add.length) { existing.permissions = [...existing.permissions, ...add]; await existing.save(); report.rolePermissionGrants += add.length; }
    });
  }
  // Phase 6: additive, one-time grant of the restaurant permissions to the DEFAULT roles that carry them (custom roles and edits are never touched)
  for (const def of DEFAULT_ROLES) {
    const existing = await Role.findOne({ key: def.key }); if (!existing) continue;
    await once(`phase6-role:${def.key}`, 'Grant new Phase 6 restaurant permissions to the default role (additive only)', async () => {
      const add = def.permissions.filter((p) => PHASE6_CODES.includes(p) && !existing.permissions.includes(p));
      if (add.length) { existing.permissions = [...existing.permissions, ...add]; await existing.save(); report.rolePermissionGrants += add.length; }
    });
  }
  const owner = await Role.findOne({ key: 'hotel_owner' });
  if (owner && ALL.some((c) => !owner.permissions.includes(c))) { owner.permissions = [...new Set([...owner.permissions, ...ALL])]; await owner.save(); }
  await once('phase45-approval-stock-adjustment', "Stock adjustments require approval (PDF section 8)", async () => {
    const p = await Property.findOne(); if (!p) return;
    const rules = p.settings?.approvalRules; if (rules && rules['Stock adjustment'] && rules['Stock adjustment'].required === false) {
      p.set('settings.approvalRules', { ...rules, 'Stock adjustment': { ...rules['Stock adjustment'], required: true } }); p.markModified('settings'); await p.save();
    }
  });
  await once('phase6-approval-complimentary-food', 'Complimentary food requires approval (PDF section 8)', async () => {
    const p = await Property.findOne(); if (!p) return;
    const rules = p.settings?.approvalRules; if (rules && rules['Complimentary food'] && rules['Complimentary food'].required === false) {
      p.set('settings.approvalRules', { ...rules, 'Complimentary food': { ...rules['Complimentary food'], required: true } }); p.markModified('settings'); await p.save();
    }
  });
  // make sure unique indexes of the new collections exist before the first write
  const M = require('../models');
  for (const name of ['Unit', 'InventoryCategory', 'InventoryItem', 'StockBalance', 'StockMovement', 'StockLedger', 'StockAlert', 'PriceHistory', 'Stocktake', 'Migration',
    'HousekeepingTask', 'RoomInspection', 'SupplyUse', 'HousekeepingReport', 'Attachment',
    'RestaurantTable', 'RestaurantReservation', 'MenuCategory', 'MenuItem', 'RestaurantOrder', 'KitchenTicket', 'RestaurantBill', 'RestaurantPayment', 'RestaurantClosing']) { if (M[name]) await M[name].init(); }
  log(report);
  return report;
}
module.exports = { runMigrations, NEW_CODES };
