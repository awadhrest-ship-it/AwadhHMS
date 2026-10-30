const { z } = require('zod');
const { InventoryCategory, InventoryItem, Unit, StockMovement, Property, ApprovalRequest, PriceHistory } = require('../models');
const items = require('../services/inventory/items');
const stock = require('../services/inventory/stock');
const reports = require('../services/inventory/reports');
const alerts = require('../services/inventory/alerts');
const U = require('../services/inventory/units');
const { scope, assertDepartment } = require('../services/inventory/access');
const { inventorySettings, INVENTORY_DEFAULTS } = require('../services/settings');
const { audit } = require('../services/audit');
const { wrap, parse } = require('../utils/wrap');
const { bad, notFound, conflict } = require('../utils/ApiError');
require('../services/inventory/approvalHandlers');

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const qty = z.coerce.number().positive('Quantity must be greater than zero').max(1e9);
const dept = z.string().min(2);
const keyOf = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const csv = (res, name, text) => { res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="${name}"`); res.send(text); };

/* ---------------- categories ---------------- */
const catBody = z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(300).optional(), defaultDepartment: z.string().optional(), trackExpiryDefault: z.boolean().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() });
exports.listCategories = wrap(async (_req, res) => res.json({ success: true, data: await InventoryCategory.find().sort({ sortOrder: 1, name: 1 }) }));
exports.createCategory = wrap(async (req, res) => {
  const c = await InventoryCategory.create(parse(catBody, req.body));
  await audit(req, { action: 'create', module: 'Inventory', entity: 'InventoryCategory', entityId: c._id, entityLabel: c.name, newValue: c });
  res.status(201).json({ success: true, data: c });
});
exports.updateCategory = wrap(async (req, res) => {
  const c = await InventoryCategory.findById(req.params.id); if (!c) throw notFound('Category not found');
  const b = parse(catBody.partial(), req.body);
  if (b.active === false && (await InventoryItem.exists({ category: c._id, active: true }))) throw conflict('This category still has active items');
  const before = c.toObject(); Object.assign(c, b); await c.save();
  await audit(req, { action: 'update', module: 'Inventory', entity: 'InventoryCategory', entityId: c._id, entityLabel: c.name, oldValue: before, newValue: c });
  res.json({ success: true, data: c });
});

/* ---------------- units ---------------- */
const unitBody = z.object({ code: z.string().trim().toLowerCase(), name: z.string().trim().min(2).max(40), dimension: z.enum(['count', 'weight', 'volume', 'package']), toBase: z.number().positive().max(1e9).optional(), active: z.boolean().optional() });
exports.listUnits = wrap(async (_req, res) => res.json({ success: true, data: await Unit.find().sort({ dimension: 1, toBase: 1, code: 1 }) }));
exports.createUnit = wrap(async (req, res) => {
  const b = parse(unitBody, req.body);
  if (b.dimension !== 'package' && !b.toBase) throw bad('Enter how many base units (pcs / g / ml) one of these equals');
  const u = await Unit.create({ ...b, toBase: b.dimension === 'package' ? 1 : b.toBase });
  await audit(req, { action: 'create', module: 'Inventory', entity: 'Unit', entityId: u._id, entityLabel: u.code, newValue: u });
  res.status(201).json({ success: true, data: u });
});
exports.updateUnit = wrap(async (req, res) => {
  const u = await Unit.findById(req.params.id); if (!u) throw notFound('Unit not found');
  const b = parse(unitBody.partial().omit({ code: true }), req.body);
  const inUse = await InventoryItem.exists({ $or: [{ baseUnit: u.code }, { purchaseUnit: u.code }, { usageUnit: u.code }, { 'conversions.unit': u.code }] });
  if (inUse && ((b.dimension && b.dimension !== u.dimension) || (b.toBase && b.toBase !== u.toBase))) throw conflict('This unit is used by items, so its type and factor cannot change');
  if (inUse && b.active === false) throw conflict('This unit is used by items and cannot be deactivated');
  const before = u.toObject(); Object.assign(u, b); await u.save();
  await audit(req, { action: 'update', module: 'Inventory', entity: 'Unit', entityId: u._id, entityLabel: u.code, oldValue: before, newValue: u });
  res.json({ success: true, data: u });
});
exports.convert = wrap(async (req, res) => {
  const b = parse(z.object({ item: oid, quantity: qty, unit: z.string(), toUnit: z.string().optional() }), req.body);
  const item = await InventoryItem.findById(b.item).lean(); if (!item) throw notFound('Item not found');
  const units = await U.loadUnits(); const base = U.toBase(item, b.quantity, b.unit, units);
  res.json({ success: true, data: { baseQty: base.baseQty, baseUnit: item.baseUnit, factor: base.factor, ...(b.toUnit ? { converted: U.fromBase(item, base.baseQty, b.toUnit, units), toUnit: b.toUnit } : {}) } });
});

/* ---------------- items ---------------- */
const itemBody = z.object({
  sku: z.string().trim().min(2).max(32), name: z.string().trim().min(2).max(100), category: oid, description: z.string().max(500).optional(),
  baseUnit: z.string(), purchaseUnit: z.string().optional(), usageUnit: z.string().optional(),
  conversions: z.array(z.object({ unit: z.string(), factor: z.number().positive() })).max(10).optional(),
  minStockLevel: z.number().min(0).optional(), minLevels: z.array(z.object({ department: dept, minLevel: z.number().min(0) })).optional(), trackExpiry: z.boolean().optional(),
  openingStock: z.array(z.object({ department: dept, quantity: qty, unit: z.string().optional(), unitPrice: z.number().min(0).optional(), expiryDate: z.string().optional(), lotNo: z.string().optional() })).optional(),
  isDemo: z.boolean().optional(),
});
exports.listItems = wrap(async (req, res) => { const r = await items.listItems(req, req.query); res.json({ success: true, ...r }); });
exports.getItem = wrap(async (req, res) => res.json({ success: true, data: await items.getItem(req, req.params.id) }));
exports.createItem = wrap(async (req, res) => {
  const { isDemo, ...b } = parse(itemBody, req.body);
  const item = await items.createItem(req, b);
  res.status(201).json({ success: true, data: await items.getItem(req, item._id) });
});
exports.updateItem = wrap(async (req, res) => {
  const b = parse(itemBody.omit({ openingStock: true, isDemo: true }).partial(), req.body);
  await items.updateItem(req, req.params.id, b);
  res.json({ success: true, data: await items.getItem(req, req.params.id) });
});
exports.deactivateItem = wrap(async (req, res) => { await items.setActive(req, req.params.id, false); res.json({ success: true }); });
exports.reactivateItem = wrap(async (req, res) => { await items.setActive(req, req.params.id, true); res.json({ success: true }); });
exports.itemLedger = wrap(async (req, res) => { await items.getItem(req, req.params.id); res.json({ success: true, ...(await reports.itemLedger(req, req.params.id, req.query)) }); });
exports.itemPrices = wrap(async (req, res) => { if (!(await InventoryItem.exists({ _id: req.params.id }))) throw notFound('Item not found'); res.json({ success: true, ...(await reports.prices(req.params.id)) }); });
exports.addPrice = wrap(async (req, res) => {
  const b = parse(z.object({ unitPrice: z.number().min(0), unit: z.string().optional(), supplier: z.string().max(80).optional(), note: z.string().max(200).optional(), date: z.string().optional() }), req.body);
  const item = await InventoryItem.findById(req.params.id); if (!item) throw notFound('Item not found');
  const units = await U.loadUnits(); const unit = (b.unit || item.purchaseUnit || item.baseUnit).toLowerCase();
  const per = b.unitPrice / U.factorToBase(item, unit, units); const at = b.date ? new Date(`${b.date.slice(0, 10)}T12:00:00+05:30`) : new Date();
  const row = await PriceHistory.create({ entryKey: `manual:${require('crypto').randomUUID()}`, item: item._id, unitPrice: b.unitPrice, unit, pricePerBase: per, supplier: b.supplier, note: b.note, date: at, recordedBy: req.user._id });
  const newest = await PriceHistory.findOne({ item: item._id }).sort({ date: -1 });
  if (String(newest._id) === String(row._id)) await InventoryItem.updateOne({ _id: item._id }, { $set: { lastPurchase: { unitPrice: b.unitPrice, unit, pricePerBase: per, date: at, supplier: b.supplier, reference: 'Manual entry' } } });
  await audit(req, { action: 'create', module: 'Inventory', entity: 'PriceHistory', entityId: row._id, entityLabel: `${item.sku} price`, newValue: row });
  res.status(201).json({ success: true, data: row });
});

/* ---------------- stock views ---------------- */
exports.summary = wrap(async (req, res) => res.json({ success: true, data: await reports.summary(req) }));
exports.stock = wrap(async (req, res) => {
  const rows = await reports.stockRows(req, req.query);
  if (req.query.format === 'csv') return csv(res, 'stock.csv', reports.toCsv([{ header: 'Department', get: (r) => r.department }, { header: 'Item code', get: (r) => r.item.sku }, { header: 'Item', get: (r) => r.item.name }, { header: 'Category', get: (r) => r.item.category }, { header: 'Quantity', get: (r) => r.qty }, { header: 'Unit', get: (r) => r.unit }, { header: 'Minimum', get: (r) => r.minLevel }, { header: 'Low stock', get: (r) => (r.low ? 'Yes' : '') }, { header: 'Next expiry', get: (r) => r.nextExpiry }, { header: 'Value (last cost)', get: (r) => r.value }], rows));
  res.json({ success: true, data: rows });
});
exports.alerts = wrap(async (req, res) => { const sc = await scope(req); res.json({ success: true, data: await alerts.currentAlerts(sc.all ? null : sc.departments) }); });
exports.refreshAlerts = wrap(async (_req, res) => { await alerts.sweep(); res.json({ success: true }); });

/* ---------------- movements ---------------- */
const lineBody = z.object({
  item: oid, quantity: qty, unit: z.string().optional(), fromDepartment: z.string().optional(), toDepartment: z.string().optional(),
  unitPrice: z.coerce.number().min(0).optional().or(z.literal('').transform(() => undefined)), expiryDate: z.string().optional().or(z.literal('').transform(() => undefined)), lotNo: z.string().max(40).optional(), lotId: oid.optional(), supplier: z.string().max(80).optional(),
});
const moveBody = z.object({ type: z.enum(['Stock In', 'Stock Out', 'Wastage', 'Breakage', 'Damaged', 'Consumption']), lines: z.array(lineBody).min(1).max(100), reason: z.string().max(300).optional(), notes: z.string().max(500).optional(), idempotencyKey: z.string().max(80).optional(), reference: z.object({ label: z.string().max(80) }).optional() });
exports.createMovement = wrap(async (req, res) => {
  const b = parse(moveBody, req.body);
  const { movement, replayed } = await stock.postMovement(req, { ...b, idempotencyKey: keyOf(req) });
  res.status(replayed ? 200 : 201).json({ success: true, data: movement, replayed });
});
exports.createTransfer = wrap(async (req, res) => {
  const b = parse(moveBody.omit({ type: true }).extend({ lines: z.array(lineBody.extend({ fromDepartment: dept, toDepartment: dept })).min(1).max(100) }), req.body);
  const { movement, replayed } = await stock.postMovement(req, { ...b, type: 'Transfer', idempotencyKey: keyOf(req) });
  res.status(replayed ? 200 : 201).json({ success: true, data: movement, replayed });
});
exports.requestAdjustment = wrap(async (req, res) => {
  const b = parse(z.object({ item: oid, department: dept, direction: z.enum(['increase', 'decrease']), quantity: qty, unit: z.string().optional(), reason: z.string().trim().min(3, 'Enter the reason for the adjustment').max(300), notes: z.string().max(500).optional(), expiryDate: z.string().optional().or(z.literal('').transform(() => undefined)), lotNo: z.string().max(40).optional(), lotId: oid.optional(), idempotencyKey: z.string().max(80).optional() }), req.body);
  const r = await stock.requestAdjustment(req, { ...b, idempotencyKey: keyOf(req) });
  res.status(r.replayed ? 200 : 202).json({ success: true, approvalRequired: true, data: r.movement, approval: r.approval, replayed: r.replayed, message: 'Adjustment submitted for approval. Stock will not change until it is approved.' });
});
exports.listMovements = wrap(async (req, res) => {
  const r = await reports.movements(req, req.query);
  if (req.query.format === 'csv') {
    const rows = r.data.flatMap((m) => m.lines.map((l) => ({ m, l })));
    return csv(res, 'movements.csv', reports.toCsv([{ header: 'Reference', get: (x) => x.m.movementNumber }, { header: 'Date', get: (x) => x.m.createdAt }, { header: 'Type', get: (x) => x.m.type }, { header: 'Status', get: (x) => x.m.status }, { header: 'Item code', get: (x) => x.l.sku }, { header: 'Item', get: (x) => x.l.itemName }, { header: 'Quantity', get: (x) => x.l.quantity }, { header: 'Unit', get: (x) => x.l.unit }, { header: 'Base quantity', get: (x) => x.l.baseQty }, { header: 'Base unit', get: (x) => x.l.baseUnit }, { header: 'From', get: (x) => x.l.fromDepartment }, { header: 'To', get: (x) => x.l.toDepartment }, { header: 'Reason', get: (x) => x.m.reason }, { header: 'By', get: (x) => x.m.performedByName }], rows));
  }
  res.json({ success: true, ...r });
});
exports.getMovement = wrap(async (req, res) => {
  const m = await StockMovement.findById(req.params.id).select('-ops').populate('approval', 'requestNumber status rejectionReason approver approvedAt').lean(); if (!m) throw notFound('Movement not found');
  const sc = await scope(req);
  if (!sc.all && !m.lines.some((l) => sc.departments.includes(l.fromDepartment) || sc.departments.includes(l.toDepartment))) throw notFound('Movement not found');
  res.json({ success: true, data: m });
});
exports.movementReport = wrap(async (req, res) => res.json({ success: true, data: await reports.movementReport(req, req.query) }));

/* ---------------- settings ---------------- */
exports.getSettings = wrap(async (_req, res) => res.json({ success: true, data: await inventorySettings(), defaults: INVENTORY_DEFAULTS }));
exports.updateSettings = wrap(async (req, res) => {
  const b = parse(z.object({ stockDepartments: z.array(z.string()).min(1).optional(), allAccessDepartments: z.array(z.string()).optional(), expiryWarningDays: z.number().int().min(0).max(365).optional(), expiryNotifications: z.boolean().optional() }), req.body);
  const p = await Property.findOne(); const before = await inventorySettings();
  p.set('settings.inventory', { ...before, ...b }); p.markModified('settings'); await p.save();
  await audit(req, { action: 'update', module: 'Inventory', entity: 'Settings', entityId: p._id, entityLabel: 'Inventory settings', oldValue: before, newValue: { ...before, ...b } });
  res.json({ success: true, data: await inventorySettings() });
});
