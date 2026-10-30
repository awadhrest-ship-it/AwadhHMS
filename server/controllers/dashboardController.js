const { HousekeepingTask, Room, Reservation, Payment, Folio, Complaint, ApprovalRequest, AuditLog, Notification } = require('../models');
const { wrap } = require('../utils/wrap');
const { toDate, todayStr, addDays, startOfIstDay, startOfIstMonth } = require('../utils/dates');

const sum = async (match) => (await Payment.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: '$amount' } } }]))[0]?.t || 0;

/** All figures computed from MongoDB - nothing hard-coded. Revenue = payments received (cash-basis) until accounting rules are confirmed. */
exports.summary = wrap(async (req, res) => {
  const t = toDate(todayStr()), tomorrow = addDays(t, 1);
  const rooms = await Room.find({ active: true }).select('status category roomNumber floor');
  const sellable = rooms.filter((r) => !['Out of Order', 'Blocked'].includes(r.status)).length || rooms.length;
  const occupied = rooms.filter((r) => r.status === 'Occupied').length;
  const statusCounts = rooms.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const [todayRev, yRev, monthRev, lastMonthRev] = await Promise.all([
    sum({ receivedAt: { $gte: startOfIstDay() } }),
    sum({ receivedAt: { $gte: startOfIstDay(todayStr(addDays(t, -1))), $lt: startOfIstDay() } }),
    sum({ receivedAt: { $gte: startOfIstMonth() } }), 0,
  ]);
  const arrivalsAll = await Reservation.find({ checkIn: t, status: { $in: ['Pending', 'Confirmed', 'Checked In'] } });
  const departuresAll = await Reservation.find({ checkOut: t, status: { $in: ['Checked In', 'Checked Out'] } }).populate('folio', 'outstanding');
  const dues = await Folio.aggregate([{ $match: { outstanding: { $gt: 0 }, charges: { $ne: [] } } }, { $group: { _id: '$guest', due: { $sum: '$outstanding' } } }]);
  const [openComplaints, totalComplaints, pendingApprovals] = await Promise.all([
    Complaint.countDocuments({ status: { $in: ['Open', 'In Progress'] } }), Complaint.countDocuments({ status: 'Open' }), ApprovalRequest.countDocuments({ status: 'Pending' }),
  ]);
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);

  // next 7 days occupancy trend from reservations
  const win = await Reservation.find({ status: { $in: ['Confirmed', 'Pending', 'Checked In'] }, checkIn: { $lt: addDays(t, 7) }, checkOut: { $gt: t }, room: { $ne: null } }).select('checkIn checkOut');
  const trend = Array.from({ length: 7 }, (_, i) => { const d = addDays(t, i); const n = win.filter((r) => r.checkIn <= d && r.checkOut > d).length; return { date: d, booked: n, occupancyPct: rooms.length ? Math.round((n / rooms.length) * 100) : 0 }; });

  const pop = [{ path: 'guest', select: 'firstName lastName phone vip' }, { path: 'room', select: 'roomNumber' }, { path: 'roomCategory', select: 'name' }, { path: 'folio', select: 'outstanding totalCharges totalPaid' }];
  const [todaysArrivals, todaysDepartures, recent, upcoming, activity, alerts, pendingList] = await Promise.all([
    Reservation.find({ checkIn: t, status: { $in: ['Pending', 'Confirmed', 'Checked In'] } }).populate(pop).sort({ status: -1 }),
    Reservation.find({ checkOut: t, status: { $in: ['Checked In', 'Checked Out'] } }).populate(pop),
    Reservation.find().sort({ createdAt: -1 }).limit(6).populate(pop),
    Reservation.find({ checkIn: { $gt: t, $lte: addDays(t, 3) }, status: { $in: ['Pending', 'Confirmed'] } }).sort({ checkIn: 1 }).limit(6).populate(pop),
    req.permissions.has('audit.view') ? AuditLog.find({ action: { $nin: ['login', 'logout'] } }).sort({ timestamp: -1 }).limit(8) : [],
    Notification.find({ $or: [{ recipientUser: req.user._id }, { recipientPermission: { $in: [...req.permissions] } }] }).sort({ createdAt: -1 }).limit(6),
    req.permissions.has('approvals.view') ? ApprovalRequest.find({ status: 'Pending' }).sort({ requestedAt: -1 }).limit(5).populate('requestedBy', 'name') : [],
  ]);
  // Phase 4/5 additions (additive: only present for users who may see them)
  const operations = {};
  if (req.permissions.has('inventory.view')) { try { const sm = await require('../services/inventory/reports').summary(req); operations.inventory = { lowStock: sm.lowStock, expiringSoon: sm.expiringSoon, expired: sm.expired, outOfStock: sm.outOfStock, pendingAdjustments: sm.pendingAdjustments, stockValue: sm.stockValue }; } catch { /* department may not hold stock */ } }
  if (req.permissions.has('housekeeping.view')) {
    const open = await HousekeepingTask.find({ status: { $in: HousekeepingTask.OPEN } }).select('status dueAt').lean(); const now = new Date();
    operations.housekeeping = { openTasks: open.length, unassigned: open.filter((x) => x.status === 'Unassigned').length, inspectionPending: open.filter((x) => x.status === 'Inspection Pending').length,
      recleanRequired: open.filter((x) => x.status === 'Re-clean Required').length, overdue: open.filter((x) => x.dueAt && new Date(x.dueAt) < now && x.status !== 'Inspection Pending').length };
  }
  res.json({ success: true, data: {
    operations,
    asOf: new Date(), today: todayStr(),
    kpis: {
      todayRevenue: todayRev, revenueVsYesterdayPct: pct(todayRev, yRev), monthlyRevenue: monthRev,
      occupancyPct: sellable ? Math.round((occupied / sellable) * 100) : 0, occupiedRooms: occupied, totalRooms: rooms.length,
      availableRooms: rooms.filter((r) => ['Available', 'Vacant & Clean'].includes(r.status)).length, vacantClean: statusCounts['Vacant & Clean'] || 0,
      arrivals: arrivalsAll.length, arrivalsCheckedIn: arrivalsAll.filter((r) => r.status === 'Checked In').length,
      pendingCheckins: arrivalsAll.filter((r) => r.status !== 'Checked In').length,
      departures: departuresAll.length, departuresPendingBill: departuresAll.filter((r) => r.status === 'Checked In' && (r.folio?.outstanding || 0) > 0).length,
      pendingPayments: dues.reduce((s, d) => s + d.due, 0), pendingPaymentGuests: dues.length,
      complaintsOpen: openComplaints, complaintsNew: totalComplaints, pendingApprovals,
    },
    roomStatus: statusCounts, occupancyTrend: trend,
    todaysArrivals, todaysDepartures, recentReservations: recent, upcomingArrivals: upcoming, recentActivity: activity, alerts, pendingApprovalList: pendingList,
  } });
});
