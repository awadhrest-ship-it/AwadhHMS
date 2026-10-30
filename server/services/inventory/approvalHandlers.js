// Registers what happens when a 'Stock adjustment' approval is decided. Required by anything that can decide approvals.
const approvals = require('../approvals');
const stock = require('./stock');
const stocktake = require('./stocktake');

approvals.registerHandler('Stock adjustment', {
  async apply(ar, req) {
    if (ar.referenceModel === 'Stocktake') return stocktake.applyApproved(ar, req);
    return stock.applyApprovedAdjustment(req, ar.referenceId);       // exactly once: idempotent op keys + Posted short-circuit
  },
  async onReject(ar, req) {
    if (ar.referenceModel === 'Stocktake') return stocktake.onRejected(ar, req);
    return stock.rejectAdjustment(req, ar.referenceId);
  },
});
