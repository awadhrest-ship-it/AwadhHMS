/**
 * Bottle opening (Module 8.2). Opening moves liquor from "sealed" to "opened" inside the bar layer - it changes NO Phase 4 quantity, so it can never be
 * confused with consumption or wastage. Each opening is an immutable record (who, when, how many bottles, capacity, Phase 4 total at that moment,
 * pool before/after). Retrying the same request (same idempotency key) records one opening and moves the liquor once.
 */
const { BarBottleOpening, BarOpenStock, Counter } = require('../../models');
const C = require('./core');
const U = require('../inventory/units');
const { audit } = require('../audit');
const { barSettings } = require('../settings');
const { bad, conflict, notFound } = require('../../utils/ApiError');

async function complete(req, rec) {
  if (rec.applied) return rec;
  const k = `bar-open:${rec._id}`; const r = await C.applyOpen(rec.item, U.toQ(rec.totalMl), k);
  await C.writeOpenLedger([{ key: k, item: rec.item, deltaQ: U.toQ(rec.totalMl), kind: 'open', refModel: 'BarBottleOpening', refId: rec._id, refLabel: rec.openingNumber, by: rec.openedBy, at: rec.openedAt }]);
  const after = r.openQ != null ? r.openQ / U.SCALE : undefined;
  const upd = await BarBottleOpening.findOneAndUpdate({ _id: rec._id, applied: false }, { $set: { applied: true, openMlAfter: after } }, { new: true });
  if (upd) await audit(req, { action: 'create', module: 'Bar', entity: 'BarBottleOpening', entityId: rec._id, entityLabel: `${rec.openingNumber} ${rec.itemName} x${rec.bottles}`, newValue: upd });
  return upd || (await BarBottleOpening.findById(rec._id));
}
/** open(req, { item, bottles, notes, idempotencyKey, source }) */
async function open(req, { item: itemId, bottles, notes, idempotencyKey, source = 'manual', shift }) {
  const n = Number(bottles); if (!Number.isInteger(n) || n < 1 || n > 50) throw bad('Enter a whole number of bottles (1 to 50)');
  const key = `u:${req.user?._id || 'sys'}:${idempotencyKey}`;
  const existing = await BarBottleOpening.findOne({ idempotencyKey: key });
  if (existing) return { opening: await complete(req, existing), replayed: true };
  const settings = await barSettings(); const items = await C.loadItems([itemId]); const item = items.get(String(itemId));
  if (!item || !item.active) throw bad('Inventory item not found or inactive');
  if (!C.inLiquorCategory(item, settings)) throw bad(`${item.name} is not a liquor item`);
  const cap = C.capacityOf(item, await U.loadUnits()); if (!cap) throw bad(`${item.name} is not set up for bottle tracking: it needs ml as its stock unit and a bottle capacity.`);
  const st = (await C.stateOf([itemId], settings.department)).get(String(itemId)); const need = U.toQ(cap * n);
  if (need > st.sealedQ) throw conflict(`Only ${Math.floor(st.sealedQ / U.toQ(cap))} sealed bottle(s) of ${item.name} are in stock in ${settings.department}; you asked to open ${n}`);
  const sh = shift || (await C.myOpenShift(req, settings))?._id;
  let rec;
  try {
    rec = await BarBottleOpening.create({ openingNumber: await Counter.next('BOP', 4), idempotencyKey: key, item: item._id, itemName: item.name, sku: item.sku, bottles: n, capacityMl: cap, totalMl: U.round6(cap * n), source,
      openedBy: req.user?._id, openedByName: req.user?.name || 'System', shift: sh, phase4OnHandMl: st.totalQ / U.SCALE, openMlBefore: st.openQ / U.SCALE, notes: notes?.toString().slice(0, 300) });
  } catch (e) { if (C.isDup(e)) { const again = await BarBottleOpening.findOne({ idempotencyKey: key }); if (again) return { opening: await complete(req, again), replayed: true }; } throw e; }
  return { opening: await complete(req, rec), replayed: false };
}
async function list(q = {}) {
  const f = {}; if (q.item) f.item = q.item; if (q.from || q.to) { f.openedAt = {}; if (q.from) f.openedAt.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.openedAt.$lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 864e5); }
  if (q.user) f.openedBy = q.user;
  return BarBottleOpening.find(f).sort({ openedAt: -1 }).limit(Math.min(Number(q.limit) || 100, 500)).lean();
}
/** Bottle & peg-wise inventory (Module 8.2): per liquor / mixer item. */
async function inventory(q = {}) {
  const settings = await barSettings(); const units = await U.loadUnits(); const ids = await C.trackedItemIds(settings);
  const items = await C.loadItems(ids); const st = await C.stateOf(ids, settings.department); const out = [];
  for (const [id, it] of items) {
    const s = st.get(id); const liquor = C.isLiquor(it, settings); const cap = C.capacityOf(it, units);
    const needsSetup = !liquor && C.inLiquorCategory(it, settings) ? (it.baseUnit !== 'ml' ? `Stored in ${it.baseUnit}: bottle and peg tracking needs ml as the stock unit` : 'No bottle capacity set') : null;
    const row = { item: it._id, sku: it.sku, name: it.name, category: it.categoryName, baseUnit: it.baseUnit, isLiquor: liquor, needsSetup, minLevel: it.minLevels?.find((m) => m.department === settings.department)?.minLevel ?? null,
      totalQty: s.totalQ / U.SCALE, bookDrift: s.drift / U.SCALE };
    if (liquor) {
      Object.assign(row, { capacityMl: cap, capacityConfigured: !!cap, sealedMl: s.sealedQ / U.SCALE, openedMl: s.openQ / U.SCALE, sealedBottles: cap ? Math.floor(s.sealedQ / U.toQ(cap)) : null, sealedRemainderMl: cap ? (s.sealedQ % U.toQ(cap)) / U.SCALE : null,
        pegs30: Math.floor(s.openQ / U.SCALE / 30), pegs60: Math.floor(s.openQ / U.SCALE / 60), openedPegsAt: settings.pegMl, openedPegs: Math.floor(s.openQ / U.SCALE / settings.pegMl) });
    }
    out.push(row);
  }
  return out.sort((a, b) => (b.isLiquor - a.isLiquor) || a.name.localeCompare(b.name));
}
module.exports = { open, list, inventory };
