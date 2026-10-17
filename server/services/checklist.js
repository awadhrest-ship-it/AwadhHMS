const { bad } = require('../utils/ApiError');

// Standard housekeeping checklist applied to every room. Custom items are added per room on top of these.
const DEFAULT_LABELS = [
  'Floor swept & mopped',
  'Bed sheets & pillow covers changed',
  'Toilet & bathroom cleaned',
  'Towels & toiletries replaced',
  'Surfaces dusted',
  'Dustbins emptied',
  'Amenities & minibar checked',
];

/**
 * The checklist only applies while a room is going through its cleaning cycle.
 *  - NEEDS_CLEANING: room is dirty / being cleaned / waiting inspection / under maintenance -> checklist starts unticked
 *  - CLEANING_STATUSES: checklist is open for ticking (NEEDS_CLEANING + Vacant & Clean, the step before Available)
 *  - everything else (Available, Reserved, Occupied, Blocked, Out of Order): checklist is locked
 */
const NEEDS_CLEANING = ['Vacant & Dirty', 'Cleaning in Progress', 'Inspection Pending', 'Maintenance Required'];
const CLEANING_STATUSES = [...NEEDS_CLEANING, 'Vacant & Clean'];
const READY_STATUSES = ['Available', 'Reserved', 'Occupied']; // room is clean -> everything shown as done

const isOpen = (status) => CLEANING_STATUSES.includes(status);
const defaultItems = (done = false) => DEFAULT_LABELS.map((label) => ({ label, custom: false, done }));

const tick = (i, by) => { i.done = true; i.doneBy = by?._id; i.doneByName = by?.name || 'System'; i.doneAt = new Date(); };
const untick = (i) => { i.done = false; i.doneBy = undefined; i.doneByName = undefined; i.doneAt = undefined; };

/** Legacy rooms have no checklist stored yet: fill it in, matching the room's current status (caller saves). Returns true if changed. */
function ensure(room) {
  let changed = false;
  if (!room.checklist || room.checklist.length === 0) {
    room.checklist = defaultItems(!NEEDS_CLEANING.includes(room.status)); changed = true;
  }
  // Self-heal: a room that is ready (Available / Reserved / Occupied) can never show unticked items.
  if (READY_STATUSES.includes(room.status) && room.checklist.some((i) => !i.done)) {
    room.checklist.forEach((i) => { if (!i.done) tick(i); }); changed = true;
  }
  return changed;
}

/** Called by setRoomStatus on every status change so the checklist always follows the room's real state. */
function onStatusChange(room, from, to, by) {
  ensure(room);
  const startsCleaning = NEEDS_CLEANING.includes(to) && (to === 'Vacant & Dirty' || !CLEANING_STATUSES.includes(from));
  if (startsCleaning) room.checklist.forEach(untick);                       // check-out / sent for cleaning -> fresh cycle
  else if (READY_STATUSES.includes(to)) room.checklist.forEach((i) => { if (!i.done) tick(i, by); }); // clean & ready -> all done, locked
}

/** Ticking / adding / removing is only allowed while the room is in its cleaning cycle. */
function assertOpen(room) {
  if (!isOpen(room.status)) throw bad(`Checklist is locked while the room is ${room.status}. It opens again when the room needs cleaning.`);
}
/** Gate for marking a room Available after it needed cleaning. Reserved rooms (no cleaning cycle) are not gated. */
function assertComplete(room) {
  if (!isOpen(room.status)) return;
  const items = room.checklist?.length ? room.checklist : defaultItems();
  const pending = items.filter((i) => !i.done);
  if (pending.length) throw bad(`Complete the housekeeping checklist first (${pending.length} of ${items.length} pending)`);
}
module.exports = { DEFAULT_LABELS, CLEANING_STATUSES, NEEDS_CLEANING, defaultItems, ensure, onStatusChange, isOpen, assertOpen, assertComplete };