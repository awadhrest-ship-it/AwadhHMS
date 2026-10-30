const { Room } = require('../models');
const { ROOM_STATUSES } = require('../config/permissions');
const { bad } = require('../utils/ApiError');
const { onStatusChange } = require('./checklist');

const pushHistory = (room, req, entry) => {
  room.history.push({ at: new Date(), by: req?.user?._id, byName: req?.user?.name, ...entry });
  if (room.history.length > 100) room.history = room.history.slice(-100);
};

/** Single place that changes a room's status (+history). Caller is responsible for auditing. */
async function setRoomStatus(room, status, req, { reason, action = 'status' } = {}) {
  if (!ROOM_STATUSES.includes(status)) throw bad(`Invalid room status: ${status}`);
  const from = room.status;
  if (from === status) return room;
  room.status = status;
  room.blocked = status === 'Blocked';
  room.outOfOrder = status === 'Out of Order';
  if (status === 'Blocked' || status === 'Out of Order') { room.statusBeforeHold = from; room.statusReason = reason; }
  else room.statusReason = undefined;
  onStatusChange(room, from, status, req?.user); // checklist follows the room: reset when it needs cleaning, all done when it is ready
  pushHistory(room, req, { action, from, to: status, reason });
  await room.save();
  return room;
}

/** Block / unblock / out-of-order / restore. Reason mandatory when putting a room on hold. */
async function hold(room, kind, req, reason) {
  if (!reason?.trim()) throw bad('A reason is required');
  if (room.status === 'Occupied') throw bad(`Room ${room.roomNumber} is occupied; check the guest out or move them first`);
  return setRoomStatus(room, kind, req, { reason, action: kind === 'Blocked' ? 'block' : 'out-of-order' });
}
async function release(room, req) {
  if (!['Blocked', 'Out of Order'].includes(room.status)) throw bad('Room is not blocked or out of order');
  const back = ['Blocked', 'Out of Order'].includes(room.statusBeforeHold) || !room.statusBeforeHold ? 'Vacant & Clean' : room.statusBeforeHold;
  return setRoomStatus(room, back, req, { reason: 'Released', action: room.status === 'Blocked' ? 'unblock' : 'restore' });
}
module.exports = { setRoomStatus, hold, release };