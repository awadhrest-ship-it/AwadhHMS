/**
 * Permission catalogue + demo default roles.
 * TBC (requirements §10 / Q06): the exact role x module rights were NOT provided by the client.
 * The matrices below are DEMO DEFAULTS only. They are editable at runtime in Settings > Roles.
 */
const PERMISSIONS = [
  // [code, label, module]
  ['users.view', 'View users', 'Users'], ['users.create', 'Create users', 'Users'],
  ['users.edit', 'Edit users', 'Users'], ['users.delete', 'Deactivate users', 'Users'],
  ['roles.view', 'View roles', 'Roles'], ['roles.create', 'Create custom roles', 'Roles'], ['roles.edit', 'Edit roles', 'Roles'],
  ['property.view', 'View property setup', 'Property'], ['property.edit', 'Edit property setup & configuration', 'Property'],
  ['rooms.view', 'View rooms', 'Rooms'], ['rooms.create', 'Create rooms & categories', 'Rooms'],
  ['rooms.edit', 'Edit rooms & categories', 'Rooms'], ['rooms.delete', 'Delete rooms', 'Rooms'],
  ['rooms.status', 'Change room status / block / out of order', 'Rooms'],
  ['rates.view', 'View rate plans', 'Pricing'], ['rates.create', 'Create rate plans', 'Pricing'], ['rates.edit', 'Edit rate plans', 'Pricing'],
  ['reservations.view', 'View reservations', 'Reservations'], ['reservations.create', 'Create reservations', 'Reservations'],
  ['reservations.edit', 'Edit reservations', 'Reservations'], ['reservations.cancel', 'Request cancellation', 'Reservations'],
  ['reservations.checkin', 'Check guests in', 'Front Desk'], ['reservations.checkout', 'Check guests out', 'Front Desk'],
  ['guests.view', 'View guests', 'Guests'], ['guests.create', 'Create guests', 'Guests'], ['guests.edit', 'Edit guests', 'Guests'],
  ['bills.view', 'View guest bills', 'Billing'], ['bills.payment', 'Record payments', 'Billing'], ['bills.edit', 'Request bill edits', 'Billing'],
  ['complaints.view', 'View complaints', 'Complaints'], ['complaints.create', 'Register complaints', 'Complaints'], ['complaints.edit', 'Update / resolve complaints', 'Complaints'],
  ['approvals.view', 'View approval requests', 'Approvals'], ['approvals.approve', 'Approve requests', 'Approvals'], ['approvals.reject', 'Reject requests', 'Approvals'],
  ['audit.view', 'View audit log', 'Audit'],
  ['dashboard.owner', 'View management dashboard', 'Dashboard'], ['dashboard.frontoffice', 'View front-office dashboard', 'Dashboard'],
];
const ALL = PERMISSIONS.map((p) => p[0]);
const mod = (m) => ALL.filter((c) => c.startsWith(m + '.'));

const FRONT_OFFICE = [
  ...mod('rooms').filter((c) => c !== 'rooms.delete'), 'rates.view',
  ...mod('reservations'), ...mod('guests'), ...mod('bills'), ...mod('complaints'),
  'dashboard.frontoffice', 'approvals.view',
];

// crossDepartment: may use modules belonging to other departments (TBC - Q07).
const DEFAULT_ROLES = [
  { key: 'hotel_owner', name: 'Hotel Owner', department: 'Management', crossDepartment: true, permissions: ALL },
  { key: 'director', name: 'Director', department: 'Management', crossDepartment: true,
    permissions: ['rooms.view', 'reservations.view', 'guests.view', 'bills.view', 'complaints.view', 'audit.view', 'dashboard.owner', 'approvals.view'] }, // TBC Q08
  { key: 'general_manager', name: 'General Manager', department: 'Management', crossDepartment: true,
    permissions: ALL.filter((c) => !['users.delete'].includes(c)) },
  { key: 'front_office_manager', name: 'Front Office Manager', department: 'Front Office', crossDepartment: false,
    permissions: [...FRONT_OFFICE, 'rates.create', 'rates.edit', 'rooms.delete'] },
  { key: 'receptionist', name: 'Receptionist', department: 'Front Office', crossDepartment: false,
    permissions: ['rooms.view', 'rates.view', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
      'reservations.checkin', 'reservations.checkout', 'guests.view', 'guests.create', 'guests.edit', 'bills.view', 'bills.payment',
      'complaints.view', 'complaints.create', 'complaints.edit', 'dashboard.frontoffice'] },
  { key: 'sales_manager', name: 'Sales Manager', department: 'Sales', crossDepartment: false,
    permissions: ['guests.view', 'guests.create', 'guests.edit', 'reservations.view', 'reservations.create', 'rates.view', 'rooms.view'] },
  { key: 'accounts_manager', name: 'Accounts Manager', department: 'Accounts', crossDepartment: false,
    permissions: ['bills.view', 'bills.payment', 'guests.view', 'audit.view', 'approvals.view'] },
  { key: 'housekeeping_manager', name: 'Housekeeping Manager', department: 'Housekeeping', crossDepartment: false,
    permissions: ['rooms.view', 'rooms.status'] },
  { key: 'restaurant_manager', name: 'Restaurant Manager', department: 'Restaurant', crossDepartment: false, permissions: ['rooms.view'] },
  { key: 'kitchen_manager', name: 'Kitchen Manager', department: 'Kitchen', crossDepartment: false, permissions: [] },
  { key: 'head_chef', name: 'Head Chef', department: 'Kitchen', crossDepartment: false, permissions: [] },
  { key: 'bar_manager', name: 'Bar Manager', department: 'Bar', crossDepartment: false, permissions: [] },
  { key: 'store_manager', name: 'Store Manager', department: 'Stores', crossDepartment: false, permissions: [] },
  { key: 'purchase_manager', name: 'Purchase Manager', department: 'Purchase', crossDepartment: false, permissions: ['approvals.view'] },
  { key: 'banquet_manager', name: 'Banquet Manager', department: 'Sales', crossDepartment: false, permissions: [] },
  { key: 'captain', name: 'Captain', department: 'Restaurant', crossDepartment: false, permissions: [] },
  { key: 'chef', name: 'Chef', department: 'Kitchen', crossDepartment: false, permissions: [] },
  { key: 'housekeeping_staff', name: 'Housekeeping Staff', department: 'Housekeeping', crossDepartment: false, permissions: ['rooms.view'] },
  { key: 'bartender', name: 'Bartender', department: 'Bar', crossDepartment: false, permissions: [] },
  { key: 'cashier', name: 'Cashier', department: 'Accounts', crossDepartment: false, permissions: ['bills.view', 'bills.payment'] },
  { key: 'technician', name: 'Technician', department: 'Maintenance', crossDepartment: false, permissions: [] },
];

const DEPARTMENTS = ['Management', 'Front Office', 'Housekeeping', 'Restaurant', 'Kitchen', 'Bar', 'Accounts', 'Stores', 'Purchase', 'Maintenance', 'Sales'];

// Which department "owns" each API module. Used by department restriction middleware.
const MODULE_DEPARTMENT = {
  rooms: 'Front Office', reservations: 'Front Office', guests: 'Front Office', bills: 'Front Office',
  complaints: 'Front Office', rates: 'Front Office',
};
// Departments that may legitimately touch a module besides the owning department (TBC - demo default).
const MODULE_EXTRA_DEPARTMENTS = {
  rooms: ['Housekeeping', 'Maintenance', 'Restaurant'],
  guests: ['Sales', 'Accounts'], reservations: ['Sales'], bills: ['Accounts'], rates: ['Sales'],
};

// Approval types (requirements §8). Thresholds are TBC (Q41) -> empty by default and editable.
const APPROVAL_TYPES = [
  'Booking cancellation', 'Booking price change', 'Complimentary room', 'Late-checkout waiver', 'Discount',
  'Refund', 'Bill editing', 'Complimentary food', 'Complimentary drinks', 'Expense', 'Purchase', 'Stock adjustment',
];
const DEFAULT_APPROVAL_RULES = Object.fromEntries(APPROVAL_TYPES.map((t) => [t, {
  required: ['Booking cancellation', 'Booking price change', 'Complimentary room', 'Late-checkout waiver', 'Discount', 'Refund', 'Bill editing'].includes(t),
  approverRoles: ['general_manager', 'hotel_owner'],
  thresholds: [], // TBC Q41: [{ minAmount, approverRoles }] - not invented
}]));

const ROOM_STATUSES = ['Available', 'Reserved', 'Occupied', 'Vacant & Clean', 'Vacant & Dirty', 'Cleaning in Progress',
  'Inspection Pending', 'Maintenance Required', 'Out of Order', 'Blocked'];
const SELLABLE_STATUSES = ['Available', 'Reserved', 'Occupied', 'Vacant & Clean', 'Vacant & Dirty', 'Cleaning in Progress', 'Inspection Pending'];
const RATE_PLAN_TYPES = ['Room Only', 'Room with Breakfast', 'Corporate Rate', 'Travel Agent Rate', 'Group Booking Rate', 'Long Stay Rate', 'Special Package'];

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES, DEPARTMENTS, MODULE_DEPARTMENT, MODULE_EXTRA_DEPARTMENTS,
  APPROVAL_TYPES, DEFAULT_APPROVAL_RULES, ROOM_STATUSES, SELLABLE_STATUSES, RATE_PLAN_TYPES };
