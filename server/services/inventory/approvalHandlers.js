// Registers what happens when a 'Stock adjustment' approval is decided. Required by anything that can decide approvals.
const approvals = require('../approvals');
const stock = require('./stock');
const stocktake = require('./stocktake');

approvals.registerHandler('Stock adjustment', {
  async apply(ar, req) {
    if (ar.referenceModel === 'Stocktake') return stocktake.applyApproved(ar, req);
    const mv = await stock.applyApprovedAdjustment(req, ar.referenceId);       // exactly once: idempotent op keys + Posted short-circuit
    if (mv?.source === 'bar-variance') await require('../bar/variance').onAdjustmentDecided(req, mv, 'Applied');   // Phase 8: realign the opened-liquor pool with the count
    return mv;
  },
  async onReject(ar, req) {
    if (ar.referenceModel === 'Stocktake') return stocktake.onRejected(ar, req);
    await stock.rejectAdjustment(req, ar.referenceId);
    const mv = await require('../../models').StockMovement.findById(ar.referenceId).select('source reference').lean();
    if (mv?.source === 'bar-variance') await require('../bar/variance').onAdjustmentDecided(req, mv, 'Rejected');
  },
});
