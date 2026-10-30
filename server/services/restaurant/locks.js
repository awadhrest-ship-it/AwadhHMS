// Per-key in-process lock (same technique as the room lock in services/availability.js) to serialise check-then-write sequences on one node.
// For multi-instance deployments use a replica set + transactions; the atomic claims used elsewhere in this module (table claim, bill
// revision, payment balance guard, folio posting reference) are single-document conditional updates and do not rely on this lock.
const locks = new Map();
async function withLock(key, fn) {
  key = String(key);
  const prev = locks.get(key) || Promise.resolve();
  let release; const next = new Promise((r) => (release = r));
  locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); }
}
module.exports = { withLock };
