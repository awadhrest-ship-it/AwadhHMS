/** Linen / toiletry replacement and cleaning-supply use (Module 5.3). Each use is exactly one 'Consumption' movement of Housekeeping stock. */
const { SupplyUse, HousekeepingTask, InventoryItem, InventoryCategory, Room, StockMovement } = require('../../models');
const stock = require('../inventory/stock');
const { stockRows } = require('../inventory/reports');
const { audit } = require('../audit');
const { bad, notFound, forbidden } = require('../../utils/ApiError');
const tasks = require('./tasks');

const HK_DEPT = 'Housekeeping';
const KINDS = { 'Linen Replacement': 'linen', 'Toiletry Replacement': 'toiletries', 'Cleaning Supplies': 'cleaning_supplies' };

async function categoryFor(kind) {
  if (!KINDS[kind]) throw bad('Choose Linen Replacement, Toiletry Replacement or Cleaning Supplies');
  const cat = await InventoryCategory.findOne({ key: KINDS[kind], active: true });
  if (!cat) throw bad(`No inventory category is set up for ${kind}. Ask stores to create one (key "${KINDS[kind]}").`);
  return cat;
}
/** Items a housekeeper can pick for a kind, with what is on the Housekeeping shelf now. */
async function pickList(req, kind) {
  const cat = await categoryFor(kind);
  const items = await InventoryItem.find({ category: cat._id, active: true }).sort({ name: 1 }).lean();
  const rows = await stockRows(req, { department: HK_DEPT, category: cat._id }).catch(() => []);
  const on = new Map((rows.rows || rows).map((r) => [String(r.item._id), r.qty]));
  return items.map((i) => ({ _id: i._id, sku: i.sku, name: i.name, baseUnit: i.baseUnit, usageUnit: i.usageUnit || i.baseUnit, onHand: on.get(String(i._id)) || 0 }));
}

async function record(req, body) {
  if (!body.clientKey || String(body.clientKey).length < 8) throw bad('clientKey is required so a retry can never use stock twice');
  const qty = Number(body.quantity); if (!(qty > 0)) throw bad('Quantity must be greater than zero');
  const clientKey = `${req.user._id}:${body.clientKey}`;
  let use = await SupplyUse.findOne({ clientKey });
  if (use && use.status === 'Posted') return { use, replayed: true };
  const cat = await categoryFor(body.kind);
  const item = await InventoryItem.findById(body.item);
  if (!item || !item.active) throw bad('Item not found');
  if (String(item.category) !== String(cat._id)) throw bad(`${item.name} is not a ${body.kind.toLowerCase()} item`);
  let task, room = body.room;
  if (body.task) {
    task = await HousekeepingTask.findById(body.task);
    if (!task || (!tasks.canViewAll(req) && !tasks.isAssignee(req, task))) throw notFound('Task not found');
    if (!['In Progress', 'Re-clean Required', 'Assigned'].includes(task.status) && !tasks.canViewAll(req)) throw bad('Supplies can only be recorded on a task you are working on');
    room = task.room;
  }
  if (room && !(await Room.exists({ _id: room }))) throw bad('Room not found');
  const unit = (body.unit || item.usageUnit || item.baseUnit).toLowerCase();
  if (!use) {
    try {
      use = await SupplyUse.create({ clientKey, kind: body.kind, item: item._id, sku: item.sku, itemName: item.name, quantity: qty, unit, room, task: task?._id, department: HK_DEPT, notes: body.notes, usedBy: req.user._id, usedByName: req.user.name });
    } catch (e) { if (e.code === 11000) use = await SupplyUse.findOne({ clientKey }); else throw e; }
  }
  try {
    const { movement } = await stock.postMovement(req, { type: 'Consumption', rawKey: true, idempotencyKey: `supply:${clientKey}`, trusted: true, source: 'housekeeping',
      reason: `${body.kind}${room ? '' : ''}`, notes: body.notes, reference: { label: task ? task.taskNumber : 'Housekeeping' },
      lines: [{ item: item._id, quantity: qty, unit, fromDepartment: HK_DEPT }] });
    use.movement = movement._id; use.status = movement.status === 'Posted' ? 'Posted' : 'Pending';
    if (movement.lines?.[0]) { use.baseQty = movement.lines[0].baseQty; use.baseUnit = movement.lines[0].baseUnit; }
    await use.save();
  } catch (e) {
    use.status = 'Failed'; use.notes = [use.notes, e.message].filter(Boolean).join(' | ').slice(0, 300); await use.save().catch(() => {});
    throw e;
  }
  await audit(req, { action: 'create', module: 'Housekeeping', entity: 'SupplyUse', entityId: use._id, entityLabel: `${body.kind}: ${qty} ${unit} ${item.name}`, newValue: { room, task: task?.taskNumber, movement: use.movement } });
  return { use, replayed: false };
}

async function history(req, q) {
  const f = {}; if (q.kind) f.kind = q.kind; if (q.room) f.room = q.room; if (q.task) f.task = q.task; if (q.item) f.item = q.item;
  if (!tasks.canViewAll(req)) f.usedBy = req.user._id;
  if (q.from || q.to) { f.at = {}; if (q.from) f.at.$gte = new Date(`${q.from}T00:00:00+05:30`); if (q.to) f.at.$lte = new Date(`${q.to}T23:59:59.999+05:30`); }
  return SupplyUse.find(f).populate('room', 'roomNumber').populate('task', 'taskNumber').sort({ at: -1 }).limit(Math.min(500, Number(q.limit) || 200)).lean();
}

/** Housekeeping stock = the Housekeeping department's stock restricted to linen / toiletries / cleaning supplies, plus how much was used. */
async function stockView(req) {
  const cats = await InventoryCategory.find({ key: { $in: Object.values(KINDS) } }).lean();
  const res = await stockRows(req, { department: HK_DEPT });
  const rows = (res.rows || res).filter((r) => cats.some((c) => c.name === r.item.category));
  const since = new Date(Date.now() - 7 * 86400000);
  const used = await SupplyUse.find({ status: 'Posted', at: { $gte: since } }).lean();
  const usedBy = new Map(); for (const u of used) usedBy.set(String(u.item), (usedBy.get(String(u.item)) || 0) + (u.baseQty || 0));
  return rows.map((r) => ({ ...r, used7d: usedBy.get(String(r.item._id)) || 0 }));
}
module.exports = { KINDS, pickList, record, history, stockView };
