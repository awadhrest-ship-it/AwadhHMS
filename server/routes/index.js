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
const inventory = require('../controllers/inventoryController');
const stocktake = require('../controllers/stocktakeController');
const hkc = require('../controllers/housekeepingController');
const rest = require('../controllers/restaurantController');
require('../services/restaurant/billing'); // registers the Discount / Complimentary food / Bill editing approval handlers
require('../services/housekeeping').init(); // subscribe to check-out events (idempotent)

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

/* ---- Phase 4: Inventory & Stores ---- */
router.get('/inventory/summary', rp('inventory.view'), inventory.summary);
router.get('/inventory/settings', rp('inventory.view'), inventory.getSettings);
router.put('/inventory/settings', rp('property.edit'), inventory.updateSettings);
router.get('/inventory/categories', rp('inventory.view'), inventory.listCategories);
router.post('/inventory/categories', rp('inventory.create'), inventory.createCategory);
router.put('/inventory/categories/:id', rp('inventory.edit'), inventory.updateCategory);
router.get('/inventory/units', rp('inventory.view'), inventory.listUnits);
router.post('/inventory/units', rp('inventory.create'), inventory.createUnit);
router.put('/inventory/units/:id', rp('inventory.edit'), inventory.updateUnit);
router.post('/inventory/convert', rp('inventory.view'), inventory.convert);
router.get('/inventory/items', rp('inventory.view'), inventory.listItems);
router.post('/inventory/items', rp('inventory.create'), inventory.createItem);
router.get('/inventory/items/:id', rp('inventory.view'), inventory.getItem);
router.put('/inventory/items/:id', rp('inventory.edit'), inventory.updateItem);
router.delete('/inventory/items/:id', rp('inventory.delete'), inventory.deactivateItem);
router.post('/inventory/items/:id/reactivate', rp('inventory.delete'), inventory.reactivateItem);
router.get('/inventory/items/:id/ledger', rp('inventory.view'), inventory.itemLedger);
router.get('/inventory/items/:id/prices', rp('inventory.reports'), inventory.itemPrices);
router.post('/inventory/items/:id/prices', rp('inventory.prices'), inventory.addPrice);
router.get('/inventory/stock', rp('inventory.view'), inventory.stock);
router.get('/inventory/alerts', rp('inventory.view'), inventory.alerts);
router.post('/inventory/alerts/refresh', rp('inventory.alerts'), inventory.refreshAlerts);
router.get('/inventory/movements', rp('inventory.view'), inventory.listMovements);
router.post('/inventory/movements', rp('inventory.move'), inventory.createMovement);
router.get('/inventory/movements/:id', rp('inventory.view'), inventory.getMovement);
router.post('/inventory/transfers', rp('inventory.move'), inventory.createTransfer);
router.post('/inventory/adjustments', rp('inventory.adjust'), inventory.requestAdjustment);
router.get('/inventory/reports/movements', rp('inventory.reports'), inventory.movementReport);
router.get('/inventory/stocktakes', rp('inventory.stocktake', 'inventory.view'), stocktake.list);
router.post('/inventory/stocktakes', rp('inventory.stocktake'), stocktake.start);
router.get('/inventory/stocktakes/:id', rp('inventory.stocktake', 'inventory.view'), stocktake.get);
router.put('/inventory/stocktakes/:id/counts', rp('inventory.stocktake'), stocktake.saveCounts);
router.post('/inventory/stocktakes/:id/lines', rp('inventory.stocktake'), stocktake.addLine);
router.post('/inventory/stocktakes/:id/submit', rp('inventory.stocktake'), stocktake.submit);
router.post('/inventory/stocktakes/:id/cancel', rp('inventory.stocktake'), stocktake.cancel);
router.post('/inventory/stocktakes/:id/request-adjustment', rp('inventory.adjust'), stocktake.requestAdjustment);
router.post('/inventory/stocktakes/:id/lines/:lineId/explain', rp('inventory.adjust'), stocktake.explain);

router.get('/audit-logs', rp('audit.view'), audit.list);
router.get('/audit-logs/modules', rp('audit.view'), audit.modules);

router.get('/notifications', audit.myNotifications);
router.post('/notifications/read-all', audit.markAllRead);
router.post('/notifications/:id/read', audit.markRead);

/* ---- Phase 5: Housekeeping. Own tasks need only housekeeping.work; everything else is permission-gated and re-checked in the service ---- */
router.get('/housekeeping/board', rp('housekeeping.view', 'housekeeping.work'), hkc.board);
router.get('/housekeeping/staff', rp('housekeeping.assign', 'housekeeping.view'), hkc.staff);
router.get('/housekeeping/tasks', rp('housekeeping.view', 'housekeeping.work'), hkc.list);
router.post('/housekeeping/tasks', rp('housekeeping.assign'), hkc.create);
router.post('/housekeeping/tasks/sync', rp('housekeeping.assign'), hkc.sync);
router.post('/housekeeping/tasks/stayover', rp('housekeeping.assign'), hkc.generateStayover);
router.get('/housekeeping/tasks/:id', rp('housekeeping.view', 'housekeeping.work'), hkc.get);
router.patch('/housekeeping/tasks/:id', rp('housekeeping.assign'), hkc.update);
router.post('/housekeeping/tasks/:id/assign', rp('housekeeping.assign'), hkc.assign);
router.post('/housekeeping/tasks/:id/cancel', rp('housekeeping.assign'), hkc.cancel);
router.post('/housekeeping/tasks/:id/start', rp('housekeeping.work'), hkc.start);
router.patch('/housekeeping/tasks/:id/checklist/:itemId', rp('housekeeping.work'), hkc.toggle);
router.post('/housekeeping/tasks/:id/checklist', rp('housekeeping.work'), hkc.addItem);
router.delete('/housekeeping/tasks/:id/checklist/:itemId', rp('housekeeping.work'), hkc.removeItem);
router.post('/housekeeping/tasks/:id/photos', rp('housekeeping.work'), hkc.addPhoto);
router.delete('/housekeeping/tasks/:id/photos/:photoId', rp('housekeeping.work'), hkc.removePhoto);
router.post('/housekeeping/tasks/:id/submit', rp('housekeeping.work'), hkc.submit);
router.post('/housekeeping/tasks/:id/inspect', rp('housekeeping.inspect'), hkc.inspect);
router.get('/housekeeping/inspections', rp('housekeeping.view', 'housekeeping.inspect', 'housekeeping.work'), hkc.inspections);
router.get('/housekeeping/supplies/items', rp('housekeeping.work', 'housekeeping.stock'), hkc.supplyItems);
router.post('/housekeeping/supplies', rp('housekeeping.work', 'housekeeping.stock'), hkc.supplyUse);
router.get('/housekeeping/supplies', rp('housekeeping.work', 'housekeeping.stock', 'housekeeping.view'), hkc.supplyHistory);
router.get('/housekeeping/stock', rp('housekeeping.stock', 'housekeeping.view'), hkc.stock);
router.get('/housekeeping/reports/performance', rp('housekeeping.performance', 'housekeeping.work'), hkc.performance);
router.get('/housekeeping/reports', rp('housekeeping.work', 'housekeeping.view'), hkc.listReports);
router.post('/housekeeping/reports', rp('housekeeping.work', 'housekeeping.view'), hkc.createReport);
router.get('/housekeeping/reports/:id', rp('housekeeping.work', 'housekeeping.view'), hkc.getReport);
router.patch('/housekeeping/reports/:id', rp('housekeeping.assign', 'housekeeping.inspect'), hkc.updateReport);
router.post('/housekeeping/reports/:id/photos', rp('housekeeping.work', 'housekeeping.view'), hkc.addReportPhoto);
router.get('/housekeeping/settings', rp('housekeeping.view', 'housekeeping.work'), hkc.getSettings);
router.put('/housekeeping/settings', rp('housekeeping.configure'), hkc.updateSettings);
router.get('/files/:id', hkc.file);

/* ---- Phase 6: Restaurant, Room Service & POS. Every route is permission-gated here AND re-checked in the services where it depends on the action. ---- */
router.get('/restaurant/overview', rp('restaurant.view'), rest.overview);
router.get('/restaurant/settings', rp('restaurant.view'), rest.getSettings);
router.put('/restaurant/settings', rp('restaurant.configure'), rest.updateSettings);
router.get('/restaurant/tables', rp('restaurant.view'), rest.listTables);
router.post('/restaurant/tables', rp('restaurant.tables'), rest.createTable);
router.get('/restaurant/tables/:id', rp('restaurant.view'), rest.getTable);
router.put('/restaurant/tables/:id', rp('restaurant.tables'), rest.updateTable);
router.get('/restaurant/reservations', rp('restaurant.view'), rest.listReservations);
router.post('/restaurant/reservations', rp('restaurant.reservations'), rest.createReservation);
router.put('/restaurant/reservations/:id', rp('restaurant.reservations'), rest.updateReservation);
router.post('/restaurant/reservations/:id/cancel', rp('restaurant.reservations'), rest.cancelReservation);
router.post('/restaurant/reservations/:id/no-show', rp('restaurant.reservations'), rest.noShowReservation);
router.post('/restaurant/reservations/:id/seat', rp('restaurant.reservations'), rest.seatReservation);
router.post('/restaurant/reservations/:id/complete', rp('restaurant.reservations'), rest.completeReservation);
router.get('/restaurant/menu', rp('restaurant.view'), rest.posMenu);
router.get('/restaurant/menu/categories', rp('restaurant.view'), rest.listCategories);
router.post('/restaurant/menu/categories', rp('restaurant.menu'), rest.createCategory);
router.put('/restaurant/menu/categories/:id', rp('restaurant.menu'), rest.updateCategory);
router.get('/restaurant/menu/items', rp('restaurant.view'), rest.listItems);
router.post('/restaurant/menu/items', rp('restaurant.menu'), rest.createItem);
router.post('/restaurant/menu/reset-availability', rp('restaurant.availability', 'restaurant.menu'), rest.resetAvailability);
router.get('/restaurant/menu/items/:id', rp('restaurant.view'), rest.getItem);
router.put('/restaurant/menu/items/:id', rp('restaurant.menu'), rest.updateItem);
router.patch('/restaurant/menu/items/:id/availability', rp('restaurant.availability', 'restaurant.menu'), rest.setAvailability);
router.get('/restaurant/in-house', rp('restaurant.orders'), rest.inHouse);
router.get('/restaurant/orders', rp('restaurant.view'), rest.listOrders);
router.post('/restaurant/orders', rp('restaurant.orders'), rest.createOrder);
router.get('/restaurant/orders/:id', rp('restaurant.view'), rest.getOrder);
router.patch('/restaurant/orders/:id', rp('restaurant.orders'), rest.updateOrder);
router.post('/restaurant/orders/:id/items', rp('restaurant.orders'), rest.addItems);
router.patch('/restaurant/orders/:id/items/:itemId', rp('restaurant.orders'), rest.updateItem2);
router.delete('/restaurant/orders/:id/items/:itemId', rp('restaurant.orders'), rest.removeItem);
router.post('/restaurant/orders/:id/send', rp('restaurant.orders'), rest.send);
router.post('/restaurant/orders/:id/serve', rp('restaurant.orders'), rest.serve);
router.post('/restaurant/orders/:id/cancel', rp('restaurant.orders'), rest.cancelOrder);
router.post('/restaurant/orders/:id/transfer', rp('restaurant.orders'), rest.transfer);
router.post('/restaurant/orders/:orderId/bills', rp('restaurant.billing'), rest.generateBills);
router.get('/restaurant/tickets', rp('restaurant.view'), rest.listTickets);
router.post('/restaurant/tickets/:id/status', rp('restaurant.kitchen', 'restaurant.orders'), rest.ticketStatus);
router.get('/restaurant/bills', rp('restaurant.view'), rest.listBills);
router.get('/restaurant/adjustments', rp('restaurant.view'), rest.listAdjustments);
router.get('/restaurant/bills/:id', rp('restaurant.view'), rest.getBill);
router.post('/restaurant/bills/:id/adjustments', rp('restaurant.billing'), rest.requestAdjustment);
router.post('/restaurant/bills/:id/finalise', rp('restaurant.billing'), rest.finalise);
router.post('/restaurant/bills/:id/post-to-folio', rp('restaurant.billing'), rest.postToFolio);
router.post('/restaurant/bills/:id/payments', rp('restaurant.payment'), rest.addPayment);
router.post('/restaurant/bills/:id/void', rp('restaurant.billing', 'restaurant.void'), rest.voidBill);
router.get('/restaurant/closing/preview', rp('restaurant.close'), rest.closingPreview);
router.post('/restaurant/closing', rp('restaurant.close'), rest.closeDay);
router.get('/restaurant/closings', rp('restaurant.close'), rest.closings);
router.get('/restaurant/closings/:date', rp('restaurant.close'), rest.closingFor);
router.get('/restaurant/closings/:date/status', rp('restaurant.close', 'restaurant.view'), rest.closingStatus); // Phase 13 (Night Audit) boundary

module.exports = router;