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
  // Phase 4 - Inventory & Stores
  ['inventory.view', 'View inventory items & stock', 'Inventory'], ['inventory.create', 'Create items, categories & units', 'Inventory'],
  ['inventory.edit', 'Edit items, categories, units & minimum levels', 'Inventory'], ['inventory.delete', 'Deactivate inventory items', 'Inventory'],
  ['inventory.move', 'Record stock-in, stock-out, transfers, wastage & breakage', 'Inventory'], ['inventory.adjust', 'Request manual stock adjustments (needs approval)', 'Inventory'],
  ['inventory.stocktake', 'Run physical-stock verification', 'Inventory'], ['inventory.prices', 'Record purchase prices', 'Inventory'],
  ['inventory.reports', 'View stock reports, valuation & price history', 'Inventory'], ['inventory.alerts', 'Receive low-stock & expiry alerts', 'Inventory'],
  // Phase 5 - Housekeeping
  ['housekeeping.view', 'View all housekeeping tasks & boards', 'Housekeeping'], ['housekeeping.work', 'Work on own assigned cleaning tasks', 'Housekeeping'],
  ['housekeeping.assign', 'Create, assign & reassign cleaning tasks', 'Housekeeping'], ['housekeeping.inspect', 'Inspect cleaned rooms (supervisor)', 'Housekeeping'],
  ['housekeeping.stock', 'View housekeeping stock, issues & usage', 'Housekeeping'], ['housekeeping.reports', 'Manage damage, missing-item & lost-and-found records', 'Housekeeping'],
  ['housekeeping.performance', 'View housekeeping staff performance', 'Housekeeping'], ['housekeeping.configure', 'Configure housekeeping checklists & targets', 'Housekeeping'],
  // Phase 6 - Restaurant, Room Service & POS (TBC: who may do what was not defined by the client - editable demo defaults)
  ['restaurant.view', 'View restaurant tables, menu, orders, bills & kitchen tickets', 'Restaurant'], ['restaurant.tables', 'Create, edit & take tables in or out of service', 'Restaurant'],
  ['restaurant.reservations', 'Create & manage table reservations', 'Restaurant'], ['restaurant.menu', 'Create & edit menu categories and items', 'Restaurant'],
  ['restaurant.availability', 'Mark menu items available / unavailable', 'Restaurant'], ['restaurant.orders', 'Take, edit, send, serve & transfer orders', 'Restaurant'],
  ['restaurant.kitchen', 'Move kitchen tickets to preparing / ready', 'Restaurant'], ['restaurant.billing', 'Generate, split & finalise bills; request discounts & complimentary items', 'Restaurant'],
  ['restaurant.payment', 'Record restaurant bill payments', 'Restaurant'], ['restaurant.void', 'Cancel sent orders & items; void bills (approval)', 'Restaurant'],
  ['restaurant.close', 'Run & confirm restaurant daily closing', 'Restaurant'], ['restaurant.configure', 'Configure restaurant taxes, payment methods & rules', 'Restaurant'],
];
const ALL = PERMISSIONS.map((p) => p[0]);
const mod = (m) => ALL.filter((c) => c.startsWith(m + '.'));

const FRONT_OFFICE = [
  ...mod('rooms').filter((c) => c !== 'rooms.delete'), 'rates.view',
  ...mod('reservations'), ...mod('guests'), ...mod('bills'), ...mod('complaints'),
  'dashboard.frontoffice', 'approvals.view',
];

// Department-level inventory rights (own department's stock only - enforced in services/inventory/access.js).
const INV_DEPT = ['inventory.view', 'inventory.move', 'inventory.adjust', 'inventory.stocktake'];
const RESTAURANT_ALL = ALL.filter((c) => c.startsWith('restaurant.'));
const RESTAURANT_KITCHEN = ['restaurant.view', 'restaurant.availability', 'restaurant.kitchen'];
const HK_MANAGER = ['housekeeping.view', 'housekeeping.assign', 'housekeeping.inspect', 'housekeeping.stock', 'housekeeping.reports', 'housekeeping.performance', 'housekeeping.configure'];

// crossDepartment: may use modules belonging to other departments (TBC - Q07).
const DEFAULT_ROLES = [
  { key: 'hotel_owner', name: 'Hotel Owner', department: 'Management', crossDepartment: true, permissions: ALL },
  { key: 'director', name: 'Director', department: 'Management', crossDepartment: true,
    permissions: ['rooms.view', 'reservations.view', 'guests.view', 'bills.view', 'complaints.view', 'audit.view', 'dashboard.owner', 'approvals.view',
      'inventory.view', 'inventory.reports', 'housekeeping.view', 'housekeeping.performance', 'restaurant.view'] }, // TBC Q08
  { key: 'general_manager', name: 'General Manager', department: 'Management', crossDepartment: true,
    permissions: ALL.filter((c) => !['users.delete'].includes(c)) },
  { key: 'front_office_manager', name: 'Front Office Manager', department: 'Front Office', crossDepartment: false,
    permissions: [...FRONT_OFFICE, 'rates.create', 'rates.edit', 'rooms.delete', 'restaurant.view'] }, // TBC (PDF Phase 6): front-office responsibility for room bills - view only until confirmed
  { key: 'receptionist', name: 'Receptionist', department: 'Front Office', crossDepartment: false,
    permissions: ['rooms.view', 'rates.view', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
      'reservations.checkin', 'reservations.checkout', 'guests.view', 'guests.create', 'guests.edit', 'bills.view', 'bills.payment',
      'complaints.view', 'complaints.create', 'complaints.edit', 'dashboard.frontoffice'] },
  { key: 'sales_manager', name: 'Sales Manager', department: 'Sales', crossDepartment: false,
    permissions: ['guests.view', 'guests.create', 'guests.edit', 'reservations.view', 'reservations.create', 'rates.view', 'rooms.view'] },
  { key: 'accounts_manager', name: 'Accounts Manager', department: 'Accounts', crossDepartment: false,
    permissions: ['bills.view', 'bills.payment', 'guests.view', 'audit.view', 'approvals.view', 'restaurant.view'] },
  { key: 'housekeeping_manager', name: 'Housekeeping Manager', department: 'Housekeeping', crossDepartment: false,
    // TBC Q46-Q49: the form says the General Manager assigns housekeeping tasks, so assign is NOT granted here (grant 'housekeeping.assign' in Roles if the hotel confirms the manager may assign).
    permissions: ['rooms.view', 'rooms.status', ...HK_MANAGER, ...INV_DEPT] },
  { key: 'supervisor', name: 'Supervisor', department: 'Housekeeping', crossDepartment: false, // TBC: which role is the supervisor (Q49). Inspection is permission-based, so any role holding housekeeping.inspect can inspect.
    permissions: ['housekeeping.view', 'housekeeping.inspect'] },
  { key: 'restaurant_manager', name: 'Restaurant Manager', department: 'Restaurant', crossDepartment: false, permissions: ['rooms.view', ...INV_DEPT, ...RESTAURANT_ALL, 'approvals.view'] },
  { key: 'kitchen_manager', name: 'Kitchen Manager', department: 'Kitchen', crossDepartment: false, permissions: [...INV_DEPT, ...RESTAURANT_KITCHEN] },
  { key: 'head_chef', name: 'Head Chef', department: 'Kitchen', crossDepartment: false, permissions: ['inventory.view', 'inventory.move', ...RESTAURANT_KITCHEN] },
  { key: 'bar_manager', name: 'Bar Manager', department: 'Bar', crossDepartment: false, permissions: [...INV_DEPT] },
  { key: 'store_manager', name: 'Store Manager', department: 'Stores', crossDepartment: false, permissions: [...mod('inventory'), 'housekeeping.stock', 'approvals.view'] },
  { key: 'purchase_manager', name: 'Purchase Manager', department: 'Purchase', crossDepartment: false, permissions: ['approvals.view', 'inventory.view', 'inventory.reports', 'inventory.prices', 'inventory.alerts'] },
  { key: 'banquet_manager', name: 'Banquet Manager', department: 'Sales', crossDepartment: false, permissions: [] },
  // TBC (Q23): whether the Captain or waiters enter orders / prepare bills is not confirmed. Provisional: the Captain does tables, reservations, orders and bills; payments/void/closing stay with the manager and cashier.
  { key: 'captain', name: 'Captain', department: 'Restaurant', crossDepartment: false, permissions: ['restaurant.view', 'restaurant.reservations', 'restaurant.orders', 'restaurant.billing'] },
  { key: 'chef', name: 'Chef', department: 'Kitchen', crossDepartment: false, permissions: [...RESTAURANT_KITCHEN] },
  { key: 'housekeeping_staff', name: 'Housekeeping Staff', department: 'Housekeeping', crossDepartment: false, permissions: ['housekeeping.work'] }, // least privilege: own tasks only (no rooms.view)
  { key: 'bartender', name: 'Bartender', department: 'Bar', crossDepartment: false, permissions: [] },
  { key: 'cashier', name: 'Cashier', department: 'Accounts', crossDepartment: false, permissions: ['bills.view', 'bills.payment', 'restaurant.view', 'restaurant.billing', 'restaurant.payment'] },
  { key: 'technician', name: 'Technician', department: 'Maintenance', crossDepartment: false, permissions: [] },
];

const DEPARTMENTS = ['Management', 'Front Office', 'Housekeeping', 'Restaurant', 'Kitchen', 'Bar', 'Accounts', 'Stores', 'Purchase', 'Maintenance', 'Sales'];

// Which department "owns" each API module. Used by department restriction middleware.
const MODULE_DEPARTMENT = {
  rooms: 'Front Office', reservations: 'Front Office', guests: 'Front Office', bills: 'Front Office',
  complaints: 'Front Office', rates: 'Front Office',
  inventory: 'Stores', housekeeping: 'Housekeeping', restaurant: 'Restaurant',
};
// Departments that may legitimately touch a module besides the owning department (TBC - demo default).
const MODULE_EXTRA_DEPARTMENTS = {
  rooms: ['Housekeeping', 'Maintenance', 'Restaurant'],
  guests: ['Sales', 'Accounts'], reservations: ['Sales'], bills: ['Accounts'], rates: ['Sales'],
  inventory: ['Purchase', 'Housekeeping', 'Kitchen', 'Restaurant', 'Bar', 'Maintenance'],
  housekeeping: ['Stores'],
  restaurant: ['Kitchen', 'Front Office', 'Accounts'], // kitchen staff work the tickets; front office sees room bills; cashiers take payments (TBC)
};

// Approval types (requirements §8). Thresholds are TBC (Q41) -> empty by default and editable.
const APPROVAL_TYPES = [
  'Booking cancellation', 'Booking price change', 'Complimentary room', 'Late-checkout waiver', 'Discount',
  'Refund', 'Bill editing', 'Complimentary food', 'Complimentary drinks', 'Expense', 'Purchase', 'Stock adjustment',
];
const DEFAULT_APPROVAL_RULES = Object.fromEntries(APPROVAL_TYPES.map((t) => [t, {
  required: ['Booking cancellation', 'Booking price change', 'Complimentary room', 'Late-checkout waiver', 'Discount', 'Refund', 'Bill editing', 'Stock adjustment', 'Complimentary food'].includes(t), // PDF s8: complimentary food needs approval
  approverRoles: ['general_manager', 'hotel_owner'],
  thresholds: [], // TBC Q41: [{ minAmount, approverRoles }] - not invented
}]));

const ROOM_STATUSES = ['Available', 'Reserved', 'Occupied', 'Vacant & Clean', 'Vacant & Dirty', 'Cleaning in Progress',
  'Inspection Pending', 'Maintenance Required', 'Out of Order', 'Blocked'];
const SELLABLE_STATUSES = ['Available', 'Reserved', 'Occupied', 'Vacant & Clean', 'Vacant & Dirty', 'Cleaning in Progress', 'Inspection Pending'];
const RATE_PLAN_TYPES = ['Room Only', 'Room with Breakfast', 'Corporate Rate', 'Travel Agent Rate', 'Group Booking Rate', 'Long Stay Rate', 'Special Package'];

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES, DEPARTMENTS, MODULE_DEPARTMENT, MODULE_EXTRA_DEPARTMENTS,
  APPROVAL_TYPES, DEFAULT_APPROVAL_RULES, ROOM_STATUSES, SELLABLE_STATUSES, RATE_PLAN_TYPES };
