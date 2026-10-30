module.exports = {
  Counter: require('./Counter'), Permission: require('./Permission'), Role: require('./Role'), User: require('./User'),
  Property: require('./Property'), RoomCategory: require('./RoomCategory'), Room: require('./Room'), RatePlan: require('./RatePlan'),
  Guest: require('./Guest'), Reservation: require('./Reservation'), Folio: require('./Folio'), Payment: require('./Payment'),
  Complaint: require('./Complaint'), ApprovalRequest: require('./ApprovalRequest'), AuditLog: require('./AuditLog'), Notification: require('./Notification'),
  // Phase 4 - Inventory & Stores
  Migration: require('./Migration'), Unit: require('./Unit'), InventoryCategory: require('./InventoryCategory'), InventoryItem: require('./InventoryItem'),
  StockBalance: require('./StockBalance'), StockMovement: require('./StockMovement'), StockLedger: require('./StockLedger'), StockAlert: require('./StockAlert'),
  PriceHistory: require('./PriceHistory'), Stocktake: require('./Stocktake'),
  // Phase 5 - Housekeeping
  Attachment: require('./Attachment'), HousekeepingTask: require('./HousekeepingTask'), RoomInspection: require('./RoomInspection'),
  SupplyUse: require('./SupplyUse'), HousekeepingReport: require('./HousekeepingReport'),
  // Phase 6 - Restaurant, Room Service & POS
  RestaurantTable: require('./RestaurantTable'), RestaurantReservation: require('./RestaurantReservation'), MenuCategory: require('./MenuCategory'), MenuItem: require('./MenuItem'),
  RestaurantOrder: require('./RestaurantOrder'), KitchenTicket: require('./KitchenTicket'), RestaurantBill: require('./RestaurantBill'), RestaurantPayment: require('./RestaurantPayment'),
  RestaurantClosing: require('./RestaurantClosing'),
};
