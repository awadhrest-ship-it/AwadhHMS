/**
 * Phase 4/5 initialisation + clearly-labelled DEMO data. Safe to run any number of times on an existing database:
 *   - never deletes or overwrites anything; everything is "create if missing" (users by email, items by SKU, reports by clientKey)
 *   - demo items carry isDemo=true and demo reports start with "(Demo)"; demo users share the documented demo password
 * Usage:  npm run seed:phase45   (server/)     or called at the end of `npm run seed`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const M = require('../models');
const { ALL } = require('../config/permissions');
const { runMigrations } = require('../migrations');
const items = require('../services/inventory/items');
const hk = require('../services/housekeeping');

const DEMO_PASSWORD = 'Awadh@123';
const USERS = [
  ['Meena Kumari (Supervisor)', 'supervisor@awadhpalace.test', 'supervisor', 'Housekeeping'],
  ['Ramesh Yadav (Housekeeping)', 'hkstaff1@awadhpalace.test', 'housekeeping_staff', 'Housekeeping'],
  ['Sunita Devi (Housekeeping)', 'hkstaff2@awadhpalace.test', 'housekeeping_staff', 'Housekeeping'],
  ['Arun Verma (Store Manager)', 'store@awadhpalace.test', 'store_manager', 'Stores'],
  ['Pooja Seth (Purchase Manager)', 'purchase@awadhpalace.test', 'purchase_manager', 'Purchase'],
];
// [sku, name, category name, base unit, purchase unit, usage unit, conversions, min levels, opening stock [dept, qty, unit, unitPrice], trackExpiry]
const ITEMS = [
  ['DEMO-LIN-TWL', 'Bath towel (demo)', 'Linen', 'pcs', 'dozen', 'pcs', [], [['Housekeeping', 20]], [['Housekeeping', 40, 'pcs', 180], ['Stores', 5, 'dozen', 2100]]],
  ['DEMO-LIN-SHT', 'Bed sheet (demo)', 'Linen', 'pcs', 'pcs', 'pcs', [], [['Housekeeping', 20]], [['Housekeeping', 30, 'pcs', 420]]],
  ['DEMO-TOI-SOP', 'Bathing soap bar (demo)', 'Toiletries', 'pcs', 'box', 'pcs', [{ unit: 'box', factor: 100 }], [['Housekeeping', 50]], [['Housekeeping', 120, 'pcs', 6], ['Stores', 3, 'box', 560]]],
  ['DEMO-TOI-SHM', 'Shampoo sachet (demo)', 'Toiletries', 'pcs', 'box', 'pcs', [{ unit: 'box', factor: 200 }], [['Housekeeping', 60]], [['Housekeeping', 90, 'pcs', 2.5]]],
  ['DEMO-CLN-FLR', 'Floor cleaner (demo)', 'Cleaning supplies', 'l', 'l', 'l', [], [['Housekeeping', 5]], [['Housekeeping', 12, 'l', 95]]],
  ['DEMO-CLN-TLT', 'Toilet cleaner (demo)', 'Cleaning supplies', 'l', 'l', 'l', [], [['Housekeeping', 3]], [['Housekeeping', 2, 'l', 110]]],
  ['DEMO-FD-RICE', 'Basmati rice (demo)', 'Food ingredients', 'kg', 'bag', 'kg', [{ unit: 'bag', factor: 25 }], [['Kitchen', 20]], [['Kitchen', 50, 'kg', 92], ['Stores', 4, 'bag', 2300]], false],
  ['DEMO-FD-MLK', 'Packaged milk (demo)', 'Food ingredients', 'l', 'l', 'l', [], [['Kitchen', 10]], [['Kitchen', 18, 'l', 58]], true],
  ['DEMO-SD-COLA', 'Cola 300 ml bottle (demo)', 'Soft drinks', 'pcs', 'carton', 'pcs', [{ unit: 'carton', factor: 24 }], [['Restaurant', 48]], [['Restaurant', 72, 'pcs', 17], ['Stores', 5, 'carton', 400]], true],
  ['DEMO-BAR-WSK', 'Whisky 750 ml (demo)', 'Liquor', 'bottle', 'bottle', 'bottle', [], [['Bar', 6]], [['Bar', 14, 'bottle', 1450]]],
  ['DEMO-MNT-BLB', 'LED bulb 9W (demo)', 'Maintenance parts', 'pcs', 'box', 'pcs', [{ unit: 'box', factor: 10 }], [['Maintenance', 10]], [['Maintenance', 24, 'pcs', 85]]],
];
const sysReq = (user) => ({ user, permissions: new Set(ALL), headers: {}, ip: 'seed', query: {} });

async function seedPhase45({ log = console.log } = {}) {
  const migration = await runMigrations({ log });
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const roles = Object.fromEntries((await M.Role.find()).map((r) => [r.key, r]));
  const out = { users: 0, items: 0, reports: 0, tasks: 0 };
  for (const [name, email, roleKey, department] of USERS) {
    if (await M.User.exists({ email })) continue;
    if (!roles[roleKey]) continue;
    await M.User.create({ name, email, password: hash, role: roles[roleKey]._id, department }); out.users += 1;
  }
  const owner = await M.User.findOne({ role: roles.hotel_owner._id }).populate('role');
  if (!owner) { log('No Hotel Owner user found - demo items and tasks skipped'); return { migration, ...out }; }
  const req = sysReq(owner);
  const cats = Object.fromEntries((await M.InventoryCategory.find()).map((c) => [c.name, c]));
  for (const [sku, name, cat, baseUnit, purchaseUnit, usageUnit, conversions, mins, opening, trackExpiry] of ITEMS) {
    if (await M.InventoryItem.exists({ sku })) continue;
    const exp = new Date(Date.now() + 5.5 * 36e5 + 20 * 864e5).toISOString().slice(0, 10);
    await items.createItem(req, { sku, name, category: cats[cat]._id, baseUnit, purchaseUnit, usageUnit, conversions, trackExpiry: !!trackExpiry, isDemo: true,
      minLevels: mins.map(([department, minLevel]) => ({ department, minLevel })),
      openingStock: opening.map(([department, quantity, unit, unitPrice]) => ({ department, quantity, unit, unitPrice, ...(trackExpiry ? { expiryDate: exp, lotNo: 'DEMO-1' } : {}) })) });
    out.items += 1;
  }
  const sync = await hk.syncDirtyRooms(req); out.tasks = sync.created;
  const room = await M.Room.findOne({ active: true }).sort({ roomNumber: 1 });
  const supervisor = await M.User.findOne({ email: 'supervisor@awadhpalace.test' }).populate('role');
  const rreq = sysReq(supervisor || owner);
  for (const [clientKey, body] of [
    ['demo-lost-found-1', { kind: 'Lost & Found', title: '(Demo) Black umbrella', description: 'Found under the bed after check-out. Demo record.', room: room?._id, storageLocation: 'Housekeeping office, shelf 2', identifyingMarks: 'Wooden handle' }],
    ['demo-damage-1', { kind: 'Damage', title: '(Demo) Cracked bedside lamp shade', description: 'Reported during room check. Demo record.', room: room?._id, severity: 'Minor', estimatedValue: 450 }],
  ]) {
    if (await M.HousekeepingReport.exists({ clientKey: `${rreq.user._id}:${clientKey}` })) continue;
    if (!room) break;
    await hk.reports.create(rreq, { ...body, clientKey }); out.reports += 1;
  }
  log(`Phase 4/5 init: ${JSON.stringify({ migration, ...out })}`);
  return { migration, ...out };
}
module.exports = seedPhase45;
if (require.main === module) {
  (async () => { await connectDB(); await seedPhase45(); await mongoose.disconnect(); })().catch((e) => { console.error(e); process.exit(1); });
}
