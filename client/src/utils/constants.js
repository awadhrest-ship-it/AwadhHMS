// Room status palette copied from the HMS UI Preview (tinted tile + coloured left edge).
export const ROOM_STATUS = {
  'Available': { tile: 'bg-green-100 border-green-600 text-green-800', dot: 'bg-green-600', short: 'Available' },
  'Reserved': { tile: 'bg-blue-100 border-blue-600 text-blue-800', dot: 'bg-blue-600', short: 'Reserved' },
  'Occupied': { tile: 'bg-indigo-100 border-indigo-700 text-indigo-800', dot: 'bg-indigo-700', short: 'Occupied' },
  'Vacant & Clean': { tile: 'bg-teal-100 border-teal-700 text-teal-800', dot: 'bg-teal-700', short: 'Vac. Clean' },
  'Vacant & Dirty': { tile: 'bg-amber-100 border-amber-600 text-amber-800', dot: 'bg-amber-600', short: 'Vac. Dirty' },
  'Cleaning in Progress': { tile: 'bg-orange-100 border-orange-600 text-orange-800', dot: 'bg-orange-600', short: 'Cleaning' },
  'Inspection Pending': { tile: 'bg-violet-100 border-violet-600 text-violet-800', dot: 'bg-violet-600', short: 'Inspection' },
  'Maintenance Required': { tile: 'bg-pink-100 border-pink-700 text-pink-800', dot: 'bg-pink-700', short: 'Maintenance' },
  'Out of Order': { tile: 'bg-red-100 border-red-600 text-red-800', dot: 'bg-red-600', short: 'Out of Order' },
  'Blocked': { tile: 'bg-slate-200 border-slate-800 text-slate-800', dot: 'bg-slate-800', short: 'Blocked' },
};
export const ROOM_STATUS_LIST = Object.keys(ROOM_STATUS);

export const TONES = {
  green: 'bg-green-100 text-green-700', blue: 'bg-blue-100 text-blue-700', indigo: 'bg-indigo-100 text-indigo-700', amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700', slate: 'bg-slate-100 text-slate-600', violet: 'bg-violet-100 text-violet-700', teal: 'bg-teal-100 text-teal-700', orange: 'bg-orange-100 text-orange-700',
};
export const RES_TONE = { Pending: 'amber', Confirmed: 'blue', 'Checked In': 'indigo', 'Checked Out': 'slate', Cancelled: 'red' };
export const PAY_TONE = { Pending: 'red', 'Part-paid': 'amber', Paid: 'green' };
export const PRIORITY_TONE = { Low: 'slate', Medium: 'blue', High: 'orange', Urgent: 'red' };
export const COMPLAINT_TONE = { Open: 'red', 'In Progress': 'amber', Resolved: 'green', Closed: 'slate' };
export const APPROVAL_TONE = { Pending: 'amber', Approved: 'green', Rejected: 'red' };
export const SEVERITY_TONE = { info: 'blue', warning: 'amber', urgent: 'red' };
export const DEPARTMENTS = ['Management', 'Front Office', 'Housekeeping', 'Restaurant', 'Kitchen', 'Bar', 'Accounts', 'Stores', 'Purchase', 'Maintenance', 'Sales'];
export const RATE_PLAN_TYPES = ['Room Only', 'Room with Breakfast', 'Corporate Rate', 'Travel Agent Rate', 'Group Booking Rate', 'Long Stay Rate', 'Special Package'];
