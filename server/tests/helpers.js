// Shared test harness. Database tests ONLY run against a database whose name contains "test": the seed wipes it.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('path').join(require('os').tmpdir(), 'awadh-test-uploads');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const uri = () => process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/awadh_test';
function dbName(u) { const m = /\/([^/?]+)(\?|$)/.exec(u.replace(/^mongodb(\+srv)?:\/\/[^/]*/, '')); return m ? m[1] : ''; }
function assertTestDb() {
  const name = dbName(uri()) || (uri().split('/').pop() || '');
  if (!/test/i.test(name)) throw new Error(`Refusing to run: database "${name}" is not a dedicated test database (its name must contain "test"). The tests wipe it.`);
}
const ymd = (n = 0) => new Date(Date.now() + 5.5 * 36e5 + n * 864e5).toISOString().slice(0, 10);

async function boot(logins) {
  assertTestDb();
  process.env.MONGO_URI = uri();
  const seed = require('../seed/seed'); const app = require('../app');
  await seed(process.env.MONGO_URI);
  const ctx = { tokens: {}, ymd };
  await new Promise((r) => { ctx.server = app.listen(0, r); });
  ctx.base = `http://127.0.0.1:${ctx.ctxPort = ctx.server.address().port}`;
  ctx.call = async (who, method, path, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const r = await fetch(`${ctx.base}/api${path}`, { method, headers: { ...(isBuf ? {} : { 'Content-Type': 'application/json' }), ...(ctx.tokens[who] ? { Authorization: `Bearer ${ctx.tokens[who]}` } : {}), ...headers }, body: body === undefined ? undefined : isBuf ? body : JSON.stringify(body) });
    let json = {}; try { json = await r.json(); } catch {}
    return { status: r.status, ...json };
  };
  for (const [who, email] of Object.entries(logins)) {
    const r = await ctx.call(null, 'POST', '/auth/login', { email, password: 'Awadh@123' });
    assert.equal(r.status, 200, `login ${who}`); ctx.tokens[who] = r.token;
  }
  // FerretDB (used when no mongod is available) does not make findAndModify atomic under concurrent connections (measured: 8 parallel
  // conditional updates on one document produced 2-5 "winners"). Real MongoDB guarantees single-document atomicity, which the stock
  // engine and the housekeeping transitions rely on, so tests that fire truly concurrent requests are skipped on FerretDB.
  try { const info = await mongoose.connection.db.admin().command({ buildInfo: 1 }); ctx.ferret = !!(info.ferretdbVersion || /ferret/i.test(JSON.stringify(info))); } catch { ctx.ferret = false; }
  if (process.env.FORCE_CONCURRENCY_TESTS === '1') ctx.ferret = false;
  ctx.concurrency = (t) => { if (ctx.ferret) { t.skip('FerretDB is not atomic under concurrent findAndModify; run against real MongoDB (or set FORCE_CONCURRENCY_TESTS=1)'); return false; } return true; };
  ctx.close = async () => { ctx.server?.close(); await mongoose.disconnect(); };
  return ctx;
}
module.exports = { boot, assertTestDb, ymd, dbName };
