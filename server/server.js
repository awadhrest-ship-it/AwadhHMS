require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { runMigrations } = require('./migrations');

if (!process.env.JWT_SECRET) { console.error('JWT_SECRET is not set. Copy server/.env.example to server/.env'); process.exit(1); }
const PORT = process.env.PORT || 5000;

async function boot() {
  await connectDB();
  await runMigrations();                                   // idempotent: permissions, units, categories, new default roles
  require('./services/housekeeping').init();               // subscribe to checkout events
  const stock = require('./services/inventory/stock'); const alerts = require('./services/inventory/alerts');
  try { const n = await stock.resumePending(); if (n) console.log(`Resumed ${n} interrupted stock movement(s)`); await alerts.sweep(); } catch (e) { console.error('Start-up stock checks failed:', e.message); }
  setInterval(() => alerts.sweep().catch((e) => console.error('alert sweep failed', e.message)), 60 * 60 * 1000).unref();
  const kd = require('./services/kitchen/delays'); const kc = require('./services/kitchen/consumption');   // Phase 7
  try { await kc.sweep(); await kd.sweep(); } catch (e) { console.error('Start-up kitchen checks failed:', e.message); }
  setInterval(() => kd.sweep().catch((e) => console.error('kitchen delay sweep failed', e.message)), 30 * 1000).unref();      // delayed-order alerts (deduplicated per ticket + station)
  setInterval(() => kc.sweep().catch((e) => console.error('kitchen consumption sweep failed', e.message)), 2 * 60 * 1000).unref(); // recover interrupted ingredient consumption
  setInterval(() => stock.resumePending().catch(() => {}), 5 * 60 * 1000).unref();
  app.listen(PORT, () => console.log(`Awadh Palace HMS API on http://localhost:${PORT}`));
}
boot().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
