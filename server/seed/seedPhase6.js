/**
 * Phase 6 initialisation + clearly-labelled DEMO restaurant data. Safe to run any number of times on an existing database:
 * everything is "create if missing" (users by email, tables by number, categories by name, items by code, demo reservation by guest+table);
 * nothing is deleted or overwritten. Demo items carry isDemo=true. No tax is seeded (TBC with the hotel) - configure it under Restaurant > Settings.
 * Usage:  npm run seed:phase6   (server/)     or called at the end of `npm run seed`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const M = require('../models');
const { runMigrations } = require('../migrations');

const DEMO_PASSWORD = 'Awadh@123';
const USERS = [
  ['Deepak Soni (Captain)', 'captain@awadhpalace.test', 'captain', 'Restaurant'],
  ['Chef Rajan Mishra (Kitchen Manager)', 'kitchen@awadhpalace.test', 'kitchen_manager', 'Kitchen'],
  ['Chef Salim Qureshi', 'chef@awadhpalace.test', 'chef', 'Kitchen'],
  ['Ritu Agarwal (Cashier)', 'cashier@awadhpalace.test', 'cashier', 'Accounts'],
];
const TABLES = [['T1', 'Main hall', 2], ['T2', 'Main hall', 2], ['T3', 'Main hall', 4], ['T4', 'Main hall', 4], ['T5', 'Main hall', 6], ['T6', 'Garden', 4], ['T7', 'Garden', 4], ['T8', 'Garden', 8]];
// [category, [code, name, description, price, isVeg, taxable]]
const MENU = [
  ['Starters', [['ST01', 'Paneer Tikka', 'Cottage cheese marinated and grilled in the tandoor', 260, true], ['ST02', 'Chicken Tikka', 'Boneless chicken, tandoor grilled', 300, false], ['ST03', 'Veg Manchurian', 'Fried vegetable dumplings in soy-garlic gravy', 200, true]]],
  ['Main Course', [['MC01', 'Dal Makhani', 'Slow-cooked black lentils with butter and cream', 220, true], ['MC02', 'Paneer Butter Masala', 'Cottage cheese in a rich tomato gravy', 280, true], ['MC03', 'Butter Chicken', 'Chicken in a creamy tomato gravy', 340, false], ['MC04', 'Veg Hakka Noodles', 'Wok-tossed noodles with vegetables', 190, true], ['MC05', 'Chicken Biryani', 'Basmati rice layered with spiced chicken', 320, false]]],
  ['Breads & Rice', [['BR01', 'Butter Naan', '', 55, true], ['BR02', 'Tandoori Roti', '', 30, true], ['BR03', 'Jeera Rice', '', 140, true]]],
  ['Desserts', [['DS01', 'Gulab Jamun (2 pcs)', '', 90, true], ['DS02', 'Vanilla Ice Cream', '', 80, true]]],
  ['Beverages', [['BV01', 'Masala Chai', '', 40, true], ['BV02', 'Fresh Lime Soda', '', 70, true], ['BV03', 'Cold Coffee', '', 120, true], ['BV04', 'Packaged Water 1 L', '', 30, true, false]]],
];
const sysReq = (user) => ({ user, permissions: new Set(user.role.permissions), headers: {}, ip: 'seed', query: {} });

async function seedPhase6({ log = console.log } = {}) {
  const migration = await runMigrations({ log });
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const roles = Object.fromEntries((await M.Role.find()).map((r) => [r.key, r]));
  const out = { users: 0, tables: 0, categories: 0, items: 0, reservations: 0 };
  for (const [name, email, roleKey, department] of USERS) {
    if (await M.User.exists({ email }) || !roles[roleKey]) continue;
    await M.User.create({ name, email, password: hash, role: roles[roleKey]._id, department }); out.users += 1;
  }
  let order = 0;
  for (const [number, section, capacity] of TABLES) { order += 10; if (await M.RestaurantTable.exists({ number })) continue; await M.RestaurantTable.create({ number, section, capacity, sortOrder: order }); out.tables += 1; }
  let co = 0;
  for (const [name, items] of MENU) {
    co += 10; let cat = await M.MenuCategory.findOne({ name });
    if (!cat) { cat = await M.MenuCategory.create({ name, sortOrder: co }); out.categories += 1; }
    for (const [code, iname, description, price, isVeg, taxable = true] of items) {
      if (await M.MenuItem.exists({ code })) continue;
      await M.MenuItem.create({ code, name: iname, description, category: cat._id, price, isVeg, taxable, isDemo: true, priceHistory: [{ price, at: new Date() }] }); out.items += 1;
    }
  }
  const t5 = await M.RestaurantTable.findOne({ number: 'T5' });
  if (t5 && !(await M.RestaurantReservation.exists({ guestName: '(Demo) Verma family', table: t5._id }))) {
    const startsAt = new Date(Date.now() + 3 * 3600e3); const durationMinutes = 90;
    await M.RestaurantReservation.create({ reservationNumber: await M.Counter.next('TRS', 4), guestName: '(Demo) Verma family', phone: '9876543210', partySize: 5, table: t5._id, tableNumber: 'T5',
      startsAt, durationMinutes, endsAt: new Date(startsAt.getTime() + durationMinutes * 60000), businessDate: require('../utils/dates').todayStr(startsAt), notes: 'Demo reservation - anniversary dinner', history: [{ at: new Date(), action: 'created' }] });
    out.reservations += 1;
  }
  log(`Phase 6 init: ${JSON.stringify({ migration, ...out })}`);
  return { migration, ...out };
}
module.exports = seedPhase6;
if (require.main === module) { (async () => { await connectDB(); await seedPhase6(); await mongoose.disconnect(); })().catch((e) => { console.error(e); process.exit(1); }); }
