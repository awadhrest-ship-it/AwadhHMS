// In-process domain events. Phase 5 Housekeeping listens to 'checkout.completed'.
const EventEmitter = require('events');
const bus = new EventEmitter();
const log = [];
const record = (name, payload) => { log.push({ name, at: new Date(), payload }); if (log.length > 200) log.shift(); };
bus.publish = (name, payload) => { record(name, payload); bus.emit(name, payload); };
/**
 * publishAsync(name, payload, ctx) - like publish, but awaits every listener (so callers/tests know the work is done) and isolates
 * failures: a failing listener is logged and never breaks the publisher (e.g. a check-out must still succeed). `ctx` (e.g. { req })
 * is handed to listeners but is not stored in the event log.
 */
bus.publishAsync = async (name, payload, ctx = {}) => {
  record(name, payload);
  const results = await Promise.allSettled(bus.listeners(name).map((fn) => Promise.resolve().then(() => fn(payload, ctx))));
  results.forEach((r) => { if (r.status === 'rejected') console.error(`event listener for ${name} failed:`, r.reason?.message || r.reason); });
  return results;
};
bus.recent = () => log.slice(-50);
module.exports = bus;
