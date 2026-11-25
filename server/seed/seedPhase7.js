/**
 * Phase 7 initialisation (safe to run any number of times on an existing database: create-if-missing, never deletes or overwrites).
 * It runs the migrations (new permissions -> default roles, ticket back-fill, consumption start date) and adds a DEMO Head Chef login.
 * It does NOT assign menu items to stations or create recipes: the hotel's station mapping and recipes are TBC and must not be invented.
 * Usage:  npm run seed:phase7   (server/)     or called at the end of `npm run seed`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const M = require('../models');
const { runMigrations } = require('../migrations');

const USERS = [['Chef Anil Dwivedi (Head Chef)', 'headchef@awadhpalace.test', 'head_chef', 'Kitchen']];
async function seedPhase7({ log = console.log } = {}) {
  const migration = await runMigrations({ log }); const hash = await bcrypt.hash('Awadh@123', 10); let users = 0;
  const roles = Object.fromEntries((await M.Role.find()).map((r) => [r.key, r]));
  for (const [name, email, roleKey, department] of USERS) { if (await M.User.exists({ email }) || !roles[roleKey]) continue; await M.User.create({ name, email, password: hash, role: roles[roleKey]._id, department }); users += 1; }
  log(`Phase 7 init: ${JSON.stringify({ migration, users })}`); return { migration, users };
}
module.exports = seedPhase7;
if (require.main === module) { (async () => { await connectDB(); await seedPhase7(); await mongoose.disconnect(); })().catch((e) => { console.error(e); process.exit(1); }); }
