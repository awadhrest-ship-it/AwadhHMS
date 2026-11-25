/** Station assignment of menu items (PDF Q25: mapping is TBC - so nothing is guessed; items start Unassigned and managers assign them). */
const { MenuItem } = require('../../models');
const { audit } = require('../audit');
const C = require('./core');
const { escapeRegex } = require('../../utils/wrap');
const { bad, notFound } = require('../../utils/ApiError');

async function listMenu(q = {}) {
  const f = { active: true }; if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); f.$or = [{ name: rx }, { code: rx }]; }
  if (q.station === 'unassigned') f.$or = [{ station: null }, { station: { $exists: false } }, { station: { $nin: C.STATIONS } }]; else if (q.station && q.station !== 'all') f.station = q.station;
  const rows = await MenuItem.find(f).populate('category', 'name').sort({ name: 1 }).limit(500).select('name code category station available unavailableReason recipe price').lean();
  return rows.map((r) => ({ ...r, station: C.STATIONS.includes(r.station) ? r.station : null, hasRecipe: !!r.recipe }));
}
async function setStation(req, id, station) {
  if (station !== null && !C.STATIONS.includes(station)) throw bad(`Station must be one of: ${C.STATIONS.join(', ')} (or empty to un-assign)`);
  const m = await MenuItem.findById(id); if (!m) throw notFound('Menu item not found'); if ((m.station || null) === station) return m;
  await MenuItem.updateOne({ _id: id }, { $set: { station, stationChangedAt: new Date(), stationChangedBy: req.user._id } });
  await audit(req, { action: 'update', module: 'Kitchen', entity: 'MenuItem', entityId: id, entityLabel: `${m.name} station`, oldValue: { station: m.station || 'Unassigned' }, newValue: { station: station || 'Unassigned' } });
  return MenuItem.findById(id);
}
async function bulk(req, items) { const out = []; for (const i of items) out.push(await setStation(req, i.menuItem, i.station ?? null)); return { updated: out.length }; }
module.exports = { listMenu, setStation, bulk };
