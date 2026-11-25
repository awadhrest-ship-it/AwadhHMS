/**
 * Phase 8 initialisation (safe to run any number of times: create-if-missing, never deletes or overwrites).
 * Runs the migrations (bar permissions -> default roles, complimentary-drinks approval rule) and adds clearly-labelled DEMO data:
 *   - demo Bar Manager and Bartender logins
 *   - demo liquor items stored in ml with an explicit per-item bottle capacity (750 ml and 1000 ml - capacity is per item, never assumed) and a demo mixer
 *   - demo bar-menu items with DEMO prices
 * It does NOT configure a happy hour, a variance tolerance, alert recipients, shift definitions, mixer quantities or a billing destination:
 * all of those are TBC in the PDF and must be set by the hotel (Bar > Settings).
 * Usage:  npm run seed:phase8   (server/)     or called at the end of `npm run seed`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const M = require('../models');
const { ALL } = require('../config/permissions');
const { runMigrations } = require('../migrations');
const items = require('../services/inventory/items');

const USERS = [
  ['Rohit Awasthi (Bar Manager)', 'barmanager@awadhpalace.test', 'bar_manager', 'Bar'],
  ['Deepak Soni (Bartender)', 'bartender@awadhpalace.test', 'bartender', 'Bar'],
  ['Mohit Jain (Bartender)', 'bartender2@awadhpalace.test', 'bartender', 'Bar'],
];
// [sku, name, category, baseUnit, purchaseUnit, usageUnit, conversions, opening [dept, qty, unit, unitPrice]]
const ITEMS = [
  ['DEMO-BAR-WSK-ML', 'Whisky 750 ml - bar stock (demo)', 'Liquor', 'ml', 'bottle', 'ml', [{ unit: 'bottle', factor: 750 }], [['Bar', 12, 'bottle', 1450]]],
  ['DEMO-BAR-VOD-ML', 'Vodka 1 litre - bar stock (demo)', 'Liquor', 'ml', 'bottle', 'ml', [{ unit: 'bottle', factor: 1000 }], [['Bar', 6, 'bottle', 1300]]],
  ['DEMO-BAR-SODA', 'Soda 200 ml (demo)', 'Soft drinks', 'pcs', 'carton', 'pcs', [{ unit: 'carton', factor: 24 }], [['Bar', 48, 'pcs', 12]]],
];
const MENU = [   // DEMO prices only. No mixers are configured: mixer quantities per drink are the hotel's to define.
  ['Whisky (demo)', 'Whisky', 'DEMO-BAR-WSK-ML', [['30 ml', 30, 180], ['60 ml', 60, 340], ['Full bottle', undefined, 3200]]],
  ['Vodka (demo)', 'Vodka', 'DEMO-BAR-VOD-ML', [['30 ml', 30, 150], ['60 ml', 60, 280], ['Full bottle', undefined, 3600]]],
];
const sysReq = (user) => ({ user, permissions: new Set(ALL), headers: {}, ip: 'seed', query: {} });

async function seedPhase8({ log = console.log } = {}) {
  const migration = await runMigrations({ log }); const hash = await bcrypt.hash('Awadh@123', 10); const out = { users: 0, items: 0, menu: 0 };
  const roles = Object.fromEntries((await M.Role.find()).map((r) => [r.key, r]));
  for (const [name, email, roleKey, department] of USERS) { if (await M.User.exists({ email }) || !roles[roleKey]) continue; await M.User.create({ name, email, password: hash, role: roles[roleKey]._id, department }); out.users += 1; }
  const owner = await M.User.findOne({ role: roles.hotel_owner._id }).populate('role'); if (!owner) { log('No Hotel Owner found - Phase 8 demo data skipped'); return { migration, ...out }; }
  const req = sysReq(owner); const cats = Object.fromEntries((await M.InventoryCategory.find()).map((c) => [c.name, c]));
  for (const [sku, name, cat, baseUnit, purchaseUnit, usageUnit, conversions, opening] of ITEMS) {
    if (await M.InventoryItem.exists({ sku })) continue;
    await items.createItem(req, { sku, name, category: cats[cat]._id, baseUnit, purchaseUnit, usageUnit, conversions, trackExpiry: false, isDemo: true, minLevels: [], openingStock: opening.map(([department, quantity, unit, unitPrice]) => ({ department, quantity, unit, unitPrice })) }); out.items += 1;
  }
  for (const [name, category, sku, servs] of MENU) {
    if (await M.BarMenuItem.exists({ name })) continue; const it = await M.InventoryItem.findOne({ sku }); if (!it) continue;
    await M.BarMenuItem.create({ name, category, kind: 'spirit', trackStock: true, stockItem: it._id, isDemo: true, createdBy: owner._id, servings: servs.map(([measure, ml, price]) => ({ measure, ml, price })) }); out.menu += 1;
  }
  log(`Phase 8 init: ${JSON.stringify({ migration, ...out })}`); return { migration, ...out };
}
module.exports = seedPhase8;
if (require.main === module) { (async () => { await connectDB(); await seedPhase8(); await mongoose.disconnect(); })().catch((e) => { console.error(e); process.exit(1); }); }
