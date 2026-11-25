/**
 * Units & conversions (Module 4.4).
 * Pure functions + one DB loader. Quantities are held as integer micro-units (SCALE) of the item's base unit.
 *
 * Conversion rules (nothing is assumed):
 *  1. Same unit as the item's base unit                      -> factor 1
 *  2. An explicit conversion stored on the item               -> its factor   (1 <unit> = <factor> base)
 *  3. Both units share a convertible dimension (count/weight/volume) -> unit.toBase / base.toBase
 *  4. Anything else (e.g. packet -> kg, kg -> litre)          -> rejected; add an explicit conversion on the item first.
 */
const { Unit } = require('../../models');
const { bad } = require('../../utils/ApiError');

const SCALE = 1e6;
const MAX_BASE_QTY = 1e9;
const toQ = (n) => Math.round(Number(n) * SCALE);
const fromQ = (q) => (q == null ? q : q / SCALE);
const round6 = (n) => Math.round(Number(n) * SCALE) / SCALE;

const DEFAULT_UNITS = [
  ['pcs', 'Pieces', 'count', 1], ['pair', 'Pair', 'count', 2], ['dozen', 'Dozen', 'count', 12],
  ['g', 'Gram', 'weight', 1], ['kg', 'Kilogram', 'weight', 1000],
  ['ml', 'Millilitre', 'volume', 1], ['l', 'Litre', 'volume', 1000],
  ['packet', 'Packet', 'package', 1], ['bottle', 'Bottle', 'package', 1], ['box', 'Box', 'package', 1], ['carton', 'Carton', 'package', 1],
  ['can', 'Can', 'package', 1], ['bag', 'Bag', 'package', 1], ['roll', 'Roll', 'package', 1], ['sachet', 'Sachet', 'package', 1], ['set', 'Set', 'package', 1],
];

async function loadUnits() {
  const list = await Unit.find({ active: true }).lean();
  return new Map(list.map((u) => [u.code, u]));
}

function needUnit(map, code) {
  const u = map.get(String(code || '').toLowerCase());
  if (!u) throw bad(`Unknown or inactive unit "${code}"`);
  return u;
}

/** Multiplier that turns <unitCode> quantities into the item's base unit. Throws a clear 400 if no safe conversion exists. */
function factorToBase(item, unitCode, map) {
  const code = String(unitCode || '').toLowerCase();
  if (code === item.baseUnit) return 1;
  const explicit = (item.conversions || []).find((c) => c.unit === code);
  if (explicit) {
    if (!(Number.isFinite(explicit.factor) && explicit.factor > 0)) throw bad(`The conversion for ${code} on this item is invalid`);
    return explicit.factor;
  }
  const u = needUnit(map, code), b = needUnit(map, item.baseUnit);
  if (u.dimension === 'package' || b.dimension === 'package' || u.dimension !== b.dimension) {
    throw bad(`No conversion is defined from ${u.name} to ${b.name} for ${item.name || 'this item'}. Add a conversion on the item first.`);
  }
  if (!(u.toBase > 0) || !(b.toBase > 0)) throw bad('Unit conversion factors must be greater than zero');
  return u.toBase / b.toBase;
}

/** Entered quantity + unit -> exact base quantity (micro-units + decimal). */
function toBase(item, quantity, unitCode, map) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw bad('Quantity must be greater than zero');
  const base = qty * factorToBase(item, unitCode, map);
  if (base > MAX_BASE_QTY) throw bad('Quantity is too large');
  const q = toQ(base);
  if (q <= 0) throw bad('Quantity is too small to record in the item\'s stock unit');
  return { baseQty: fromQ(q), qtyQ: q, factor: factorToBase(item, unitCode, map) };
}

/** Base quantity -> quantity in another unit (display). Returns null when the units are not convertible (never throws). */
function fromBase(item, baseQty, unitCode, map) {
  try { return round6(baseQty / factorToBase(item, unitCode, map)); } catch { return null; }
}

/** Units this item can be entered in: base + explicit conversions + same-dimension standard units. */
function convertibleUnits(item, map) {
  const out = new Set([item.baseUnit, ...(item.conversions || []).map((c) => c.unit)]);
  const b = map.get(item.baseUnit);
  if (b && b.dimension !== 'package') for (const u of map.values()) if (u.dimension === b.dimension) out.add(u.code);
  return [...out];
}

/** Validate unit configuration of an item (base unit, conversions, default purchase/usage units). Returns the cleaned item fields. */
function validateItemUnits(data, map) {
  const base = String(data.baseUnit || '').toLowerCase();
  needUnit(map, base);
  const seen = new Set(); const conversions = [];
  for (const c of data.conversions || []) {
    const unit = String(c.unit || '').toLowerCase();
    needUnit(map, unit);
    if (unit === base) throw bad('A conversion to the base unit itself is not needed');
    if (seen.has(unit)) throw bad(`Conversion for "${unit}" is listed twice`);
    seen.add(unit);
    const factor = Number(c.factor);
    if (!Number.isFinite(factor) || factor <= 0) throw bad(`Conversion factor for "${unit}" must be greater than zero`);
    if (factor > MAX_BASE_QTY || toQ(factor) <= 0) throw bad(`Conversion factor for "${unit}" is out of range`);
    conversions.push({ unit, factor });
  }
  const probe = { name: data.name, baseUnit: base, conversions };
  const out = { baseUnit: base, conversions };
  for (const k of ['purchaseUnit', 'usageUnit']) {
    const v = data[k] ? String(data[k]).toLowerCase() : undefined;
    if (v) { needUnit(map, v); factorToBase(probe, v, map); }
    out[k] = v;
  }
  return out;
}

module.exports = { SCALE, MAX_BASE_QTY, DEFAULT_UNITS, toQ, fromQ, round6, loadUnits, needUnit, factorToBase, toBase, fromBase, convertibleUnits, validateItemUnits };
