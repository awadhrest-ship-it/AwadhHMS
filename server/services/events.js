// In-process domain events. Later phases subscribe (e.g. Phase 5 Housekeeping listens to 'checkout.completed').
const EventEmitter = require('events');
const bus = new EventEmitter();
const log = [];
bus.publish = (name, payload) => { log.push({ name, at: new Date(), payload }); if (log.length > 200) log.shift(); bus.emit(name, payload); };
bus.recent = () => log.slice(-50);
module.exports = bus;
