const router = require('express').Router();
const { authenticate, requirePermission: rp } = require('../middleware/auth');
const auth = require('../controllers/authController');
const users = require('../controllers/userController');
const property = require('../controllers/propertyController');
const rooms = require('../controllers/roomController');
const rates = require('../controllers/rateController');
const guests = require('../controllers/guestController');
const reservations = require('../controllers/reservationController');
const bills = require('../controllers/billController');
const complaints = require('../controllers/complaintController');
const approvals = require('../controllers/approvalController');
const audit = require('../controllers/auditController');
const dashboard = require('../controllers/dashboardController');

router.get('/health', (_q, r) => r.json({ success: true, status: 'ok' }));
router.post('/auth/login', auth.login);

router.use(authenticate); // everything below needs a valid JWT
router.get('/auth/me', auth.me);
router.post('/auth/logout', auth.logout);

router.get('/dashboard', rp('dashboard.owner', 'dashboard.frontoffice'), dashboard.summary);

router.get('/users', rp('users.view'), users.listUsers);
router.post('/users', rp('users.create'), users.createUser);
router.get('/users/:id', rp('users.view'), users.getUser);
router.put('/users/:id', rp('users.edit'), users.updateUser);
router.delete('/users/:id', rp('users.delete'), users.deleteUser);

router.get('/roles', rp('roles.view', 'users.view'), users.listRoles);
router.post('/roles', rp('roles.create'), users.createRole);
router.put('/roles/:id', rp('roles.edit'), users.updateRole);
router.get('/permissions', rp('roles.view'), users.listPermissions);

router.get('/property', property.getProperty); // read-only config is needed by all screens (payment methods, ID types...)
router.put('/property', rp('property.edit'), property.updateProperty);

router.get('/room-categories', rp('rooms.view'), rooms.listCategories);
router.post('/room-categories', rp('rooms.create'), rooms.createCategory);
router.put('/room-categories/:id', rp('rooms.edit'), rooms.updateCategory);

router.get('/rooms/availability', rp('rooms.view'), rooms.availability);
router.get('/rooms', rp('rooms.view'), rooms.listRooms);
router.post('/rooms', rp('rooms.create'), rooms.createRoom);
router.get('/rooms/:id', rp('rooms.view'), rooms.getRoom);
router.put('/rooms/:id', rp('rooms.edit'), rooms.updateRoom);
router.delete('/rooms/:id', rp('rooms.delete'), rooms.deleteRoom);
router.patch('/rooms/:id/status', rp('rooms.status'), rooms.changeStatus);
router.patch('/rooms/:id/checklist/:itemId', rp('rooms.status'), rooms.toggleChecklistItem);
router.post('/rooms/:id/checklist', rp('rooms.status'), rooms.addChecklistItem);
router.delete('/rooms/:id/checklist/:itemId', rp('rooms.status'), rooms.deleteChecklistItem);

router.get('/rate-plans', rp('rates.view'), rates.list);
router.post('/rate-plans/quote', rp('rates.view', 'reservations.create'), rates.quote);
router.post('/rate-plans', rp('rates.create'), rates.create);
router.put('/rate-plans/:id', rp('rates.edit'), rates.update);

router.get('/guests', rp('guests.view'), guests.list);
router.get('/guests/match', rp('guests.view'), guests.match);
router.post('/guests', rp('guests.create'), guests.create);
router.get('/guests/:id', rp('guests.view'), guests.get);
router.put('/guests/:id', rp('guests.edit'), guests.update);

router.get('/reservations', rp('reservations.view'), reservations.list);
router.post('/reservations', rp('reservations.create'), reservations.create);
router.get('/reservations/:id', rp('reservations.view'), reservations.get);
router.put('/reservations/:id', rp('reservations.edit'), reservations.update);
router.post('/reservations/:id/cancel', rp('reservations.cancel'), reservations.cancel);
router.post('/reservations/:id/price-change', rp('reservations.edit'), reservations.priceChange);
router.post('/reservations/:id/check-in', rp('reservations.checkin'), reservations.checkIn);
router.post('/reservations/:id/check-out', rp('reservations.checkout'), reservations.checkOut);

router.get('/bills', rp('bills.view'), bills.list);
router.get('/bills/:id', rp('bills.view'), bills.get);
router.post('/bills/:id/payment', rp('bills.payment'), bills.addPayment);

router.get('/complaints/categories', rp('complaints.view'), complaints.categories);
router.get('/complaints', rp('complaints.view'), complaints.list);
router.post('/complaints', rp('complaints.create'), complaints.create);
router.get('/complaints/:id', rp('complaints.view'), complaints.get);
router.put('/complaints/:id', rp('complaints.edit'), complaints.update);

router.get('/approvals', rp('approvals.view'), approvals.list);
router.get('/approvals/:id', rp('approvals.view'), approvals.get);
router.post('/approvals/:id/approve', rp('approvals.approve'), approvals.approve);
router.post('/approvals/:id/reject', rp('approvals.reject', 'approvals.approve'), approvals.reject);

router.get('/audit-logs', rp('audit.view'), audit.list);
router.get('/audit-logs/modules', rp('audit.view'), audit.modules);

router.get('/notifications', audit.myNotifications);
router.post('/notifications/read-all', audit.markAllRead);
router.post('/notifications/:id/read', audit.markRead);

module.exports = router;