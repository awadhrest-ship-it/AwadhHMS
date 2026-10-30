const { z } = require('zod');
const st = require('../services/inventory/stocktake');
const { audit } = require('../services/audit');
const { wrap, parse } = require('../utils/wrap');
require('../services/inventory/approvalHandlers');
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const ok = (res, data, extra = {}, status = 200) => res.status(status).json({ success: true, data, ...extra });

exports.list = wrap(async (req, res) => ok(res, await st.list(req, req.query)));
exports.get = wrap(async (req, res) => ok(res, await st.get(req, req.params.id)));
exports.start = wrap(async (req, res) => ok(res, await st.start(req, parse(z.object({ department: z.string().min(2), category: oid.optional().or(z.literal('').transform(() => undefined)), notes: z.string().max(300).optional() }), req.body)), {}, 201));
exports.addLine = wrap(async (req, res) => ok(res, await st.addLine(req, req.params.id, parse(z.object({ item: oid }), req.body).item)));
exports.saveCounts = wrap(async (req, res) => ok(res, await st.saveCounts(req, req.params.id, parse(z.object({ counts: z.array(z.object({ lineId: oid, quantity: z.union([z.coerce.number(), z.null(), z.literal('')]).optional(), unit: z.string().optional(), note: z.string().max(200).optional() })).min(1) }), req.body).counts)));
exports.submit = wrap(async (req, res) => ok(res, await st.submit(req, req.params.id)));
exports.cancel = wrap(async (req, res) => ok(res, await st.cancel(req, req.params.id)));
exports.explain = wrap(async (req, res) => ok(res, await st.explain(req, req.params.id, req.params.lineId, parse(z.object({ note: z.string().min(3) }), req.body).note)));
exports.requestAdjustment = wrap(async (req, res) => {
  const b = parse(z.object({ lineIds: z.array(oid).optional(), reason: z.string().max(300).optional() }), req.body || {});
  const r = await st.requestAdjustment(req, req.params.id, b);
  ok(res, r.stocktake, { approval: r.approval, approvalRequired: true, message: 'Adjustment submitted for approval. Stock will not change until it is approved.' }, 202);
});
