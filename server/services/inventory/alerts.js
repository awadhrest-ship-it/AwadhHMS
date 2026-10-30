/**
 * Low-stock and expiry alerts. A StockAlert row records the STATE of each condition, so a notification is raised only when
 * a condition starts (inactive -> active). It re-arms automatically after the condition is resolved and recurs later.
 * Evaluated after every posted movement, after minimum-level edits, at start-up and by the hourly sweep - never on page load.
 */
const { InventoryItem, StockBalance, StockAlert } = require('../../models');
const { notify } = require('../notify');
const { inventorySettings } = require('../settings');
const U = require('./units');
const { today, addDays } = require('../../utils/dates');

const isDup = (e) => e && (e.code === 11000 || /E11000|duplicate key/i.test(e.message || ''));

/** Flip an alert to active. Returns true only on the inactive -> active transition (so the caller notifies once). */
async function activate(key, data) {
  const now = new Date();
  try {
    const r = await StockAlert.updateOne({ ...key, state: { $ne: 'active' } }, { $set: { state: 'active', openedAt: now, notifiedAt: now, resolvedAt: null, ...data }, $inc: { occurrences: 1 } }, { upsert: true });
    return (r.upsertedCount || r.modifiedCount || 0) > 0;
  } catch (e) { if (isDup(e)) { await StockAlert.updateOne({ ...key, state: 'active' }, { $set: data }); return false; } throw e; }
}
const resolve = (key) => StockAlert.updateOne({ ...key, state: 'active' }, { $set: { state: 'resolved', resolvedAt: new Date() } });

async function evaluateItem(item, settings, units) {
  const lots = await StockBalance.find({ item: item._id }).lean();
  const byDept = new Map(); let total = 0;
  for (const l of lots) { byDept.set(l.department, (byDept.get(l.department) || 0) + l.qtyQ); total += l.qtyQ; }
  const raised = [];
  const rules = [...(item.minLevels || []).map((m) => ({ department: m.department, min: m.minLevel, qty: byDept.get(m.department) || 0 }))];
  if (item.minStockLevel > 0) rules.push({ department: '*', min: item.minStockLevel, qty: total });
  const keep = new Set();
  for (const r of rules) {
    const key = { item: item._id, department: r.department, kind: 'low_stock', lotKey: '' };
    keep.add(r.department);
    const minQ = U.toQ(r.min);
    if (minQ > 0 && r.qty < minQ) { if (await activate(key, { onHand: U.fromQ(r.qty), minLevel: r.min })) raised.push({ ...r, onHand: U.fromQ(r.qty) }); }
    else await resolve(key);
  }
  // rules that were removed from the item no longer alert
  const open = await StockAlert.find({ item: item._id, kind: 'low_stock', state: 'active' }).lean();
  for (const a of open) if (!keep.has(a.department)) await resolve({ item: item._id, department: a.department, kind: 'low_stock', lotKey: '' });

  // expiry (optional - TBC in the PDF, so off unless configured)
  const expiryRaised = [];
  if (settings.expiryNotifications) {
    const limit = addDays(today(), settings.expiryWarningDays);
    const soon = lots.filter((l) => l.qtyQ > 0 && l.expiryDate && new Date(l.expiryDate) <= limit);
    const live = new Set();
    for (const l of soon) { live.add(`${l.department}|${l.lotKey}`); if (await activate({ item: item._id, department: l.department, kind: 'expiry', lotKey: l.lotKey }, { expiryDate: l.expiryDate, onHand: U.fromQ(l.qtyQ) })) expiryRaised.push(l); }
    const open2 = await StockAlert.find({ item: item._id, kind: 'expiry', state: 'active' }).lean();
    for (const a of open2) if (!live.has(`${a.department}|${a.lotKey}`)) await resolve({ item: item._id, department: a.department, kind: 'expiry', lotKey: a.lotKey });
  }
  return { raised, expiryRaised };
}

async function announce(item, { raised, expiryRaised }) {
  for (const r of raised) {
    await notify({ type: 'low_stock', title: `Low stock: ${item.name}`, severity: 'warning', link: '/inventory/alerts', permission: 'inventory.alerts',
      message: `${r.department === '*' ? 'Hotel-wide' : r.department}: ${r.onHand} ${item.baseUnit} left (minimum ${r.min})` });
  }
  for (const l of expiryRaised) {
    await notify({ type: 'expiry', title: `Expiry: ${item.name}`, severity: 'warning', link: '/inventory/alerts', permission: 'inventory.alerts',
      message: `${l.department}: ${U.fromQ(l.qtyQ)} ${item.baseUnit} expire on ${new Date(l.expiryDate).toISOString().slice(0, 10)}` });
  }
}

/** Evaluate the items touched by a change. pairs: [{ item, department }] */
async function evaluate(_req, pairs) {
  const ids = [...new Set(pairs.map((p) => String(p.item)))];
  if (!ids.length) return;
  const [items, settings, units] = [await InventoryItem.find({ _id: { $in: ids } }).lean(), await inventorySettings(), null];
  for (const item of items) { if (!item.active) continue; await announce(item, await evaluateItem(item, settings, units)); }
}
async function sweep() {
  const settings = await inventorySettings();
  for (const item of await InventoryItem.find({ active: true }).lean()) await announce(item, await evaluateItem(item, settings, null));
}

/** Current alert picture computed from live balances (not from the alert rows) - what the Alerts screen shows. */
async function currentAlerts(scopeDepartments) {
  const settings = await inventorySettings();
  const items = await InventoryItem.find({ active: true }).populate('category', 'name').lean();
  const lots = await StockBalance.find({ qtyQ: { $gt: 0 } }).lean();
  const byItem = new Map(); for (const l of lots) { (byItem.get(String(l.item)) || byItem.set(String(l.item), []).get(String(l.item))).push(l); }
  const t = today(); const warn = addDays(t, settings.expiryWarningDays);
  const low = [], expiring = [], expired = [];
  const inScope = (d) => !scopeDepartments || scopeDepartments.includes(d);
  for (const item of items) {
    const ls = byItem.get(String(item._id)) || [];
    const dept = new Map(); let total = 0; for (const l of ls) { dept.set(l.department, (dept.get(l.department) || 0) + l.qtyQ); total += l.qtyQ; }
    for (const m of item.minLevels || []) {
      const q = dept.get(m.department) || 0;
      if (inScope(m.department) && U.toQ(m.minLevel) > 0 && q < U.toQ(m.minLevel)) low.push({ item: { _id: item._id, sku: item.sku, name: item.name, baseUnit: item.baseUnit, category: item.category?.name }, department: m.department, onHand: U.fromQ(q), minLevel: m.minLevel, shortBy: U.round6(m.minLevel - U.fromQ(q)) });
    }
    if (!scopeDepartments && item.minStockLevel > 0 && total < U.toQ(item.minStockLevel)) low.push({ item: { _id: item._id, sku: item.sku, name: item.name, baseUnit: item.baseUnit, category: item.category?.name }, department: '*', onHand: U.fromQ(total), minLevel: item.minStockLevel, shortBy: U.round6(item.minStockLevel - U.fromQ(total)) });
    for (const l of ls) {
      if (!l.expiryDate || !inScope(l.department)) continue;
      const row = { item: { _id: item._id, sku: item.sku, name: item.name, baseUnit: item.baseUnit }, department: l.department, lotNo: l.lotNo, lotId: l._id, expiryDate: l.expiryDate, qty: U.fromQ(l.qtyQ), daysLeft: Math.round((new Date(l.expiryDate) - t) / 864e5) };
      if (new Date(l.expiryDate) < t) expired.push(row); else if (new Date(l.expiryDate) <= warn) expiring.push(row);
    }
  }
  expiring.sort((a, b) => a.daysLeft - b.daysLeft); expired.sort((a, b) => a.daysLeft - b.daysLeft);
  return { low, expiring, expired, expiryWarningDays: settings.expiryWarningDays };
}

module.exports = { evaluate, sweep, currentAlerts, evaluateItem };
