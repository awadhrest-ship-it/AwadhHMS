// Registers what happens when a bar "Complimentary drinks" approval is decided (the common Phase 1 approval framework decides WHO may approve).
const approvals = require('../approvals');
const comp = require('./comp');
approvals.registerHandler('Complimentary drinks', { apply: (ar, req) => comp.onApproved(ar, req), onReject: (ar, req) => comp.onRejected(ar, req) });
