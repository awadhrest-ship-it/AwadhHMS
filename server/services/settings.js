/**
 * Phase 4/5 configuration lives in Property.settings.inventory / Property.settings.housekeeping (same place as every other
 * hotel rule). Anything the PDF leaves "to be confirmed" is a configurable default here - nothing is hard-wired into logic.
 */
const { Property } = require('../models');
const { DEFAULT_LABELS } = require('./checklist');

const INVENTORY_DEFAULTS = {
  stockDepartments: ['Stores', 'Housekeeping', 'Kitchen', 'Restaurant', 'Bar', 'Maintenance', 'Front Office'], // departments that can hold stock
  allAccessDepartments: ['Management', 'Stores', 'Purchase'], // TBC: users of these departments (and cross-department roles) see/move stock of every department; everyone else only their own
  expiryWarningDays: 30,        // items expiring within N days are flagged "expiring soon"
  expiryNotifications: false,   // TBC (PDF 4.3): whether expiry dates should raise alerts - off until the hotel confirms
};
const HK_DEFAULTS = {
  checklistTemplates: {         // TBC (PDF 5.2): checklist contents were not provided - editable demo defaults
    checkout: DEFAULT_LABELS,
    stayover: ['Bed made / linen tidied', 'Bathroom cleaned', 'Towels & toiletries replaced if needed', 'Dustbins emptied', 'Floor swept', 'Surfaces dusted'],
  },
  targetMinutes: { Checkout: 60, 'Stay-over': 30, Manual: 60 }, // TBC: used only for the "overdue" figure
  requireChecklistComplete: true,
  requirePhotos: false,         // when true a before and an after photo are needed to submit
  inspectorMustDifferFromCleaner: true,
  stayoverNeedsInspection: false,
  priorityWhenArrivalToday: true, // checkout tasks for rooms with a booking arriving today start as High priority
};

const RESTAURANT_DEFAULTS = {
  // TBC (PDF Phase 6 / Q14): applicable taxes were NOT confirmed. No tax is charged until the hotel configures it. Each entry is
  // { code, name, ratePercent }; prices are treated as tax-EXCLUSIVE and every configured tax is applied to the taxable (post-discount) amount.
  taxes: [],
  // TBC (Q14): payment methods. null = use the property-wide list (Property.settings.paymentMethods); set an array to give the restaurant its own.
  paymentMethods: null,
  reservationDurationMinutes: 90,   // default length of a table reservation (editable per reservation)
  reservationHoldMinutes: 30,       // a walk-in order cannot start on a table whose booked reservation begins within this many minutes
  deliveryRequiredFields: ['contactName', 'phone', 'address'], // TBC (Q24): minimum delivery details; staff may be asked for more later
  maxQuantityPerLine: 50,
};
/**
 * Phase 7 (Kitchen). Every value below that the PDF marks "to be confirmed" is a PROVISIONAL, configurable default - never an official hotel policy:
 *   delay threshold (Q26), alert recipients (Q26), escalation (Q26), chef-performance method (Q60). Station assignment of menu items (Q25) is NOT defaulted at all.
 */
const KITCHEN_DEFAULTS = {
  delay: {
    enabled: true,
    defaultMinutes: 20,                    // PROVISIONAL - the PDF gives no time limit. Measured from the moment the ticket was queued until it is Ready.
    stationMinutes: {},                    // e.g. { Tandoor: 25 } - overrides the default for that station's share of a ticket
    orderTypeThresholdsEnabled: false,     // when true, orderTypeMinutes applies to stations without their own value
    orderTypeMinutes: {},                  // e.g. { 'Room Service': 15 }
    // precedence: station value -> (order-type value, if enabled) -> default
  },
  recipients: { roles: ['kitchen_manager', 'restaurant_manager'], users: [] }, // PROVISIONAL - the PDF names Kitchen Manager and Restaurant Manager but marks recipients TBC. In-app notifications only.
  escalation: { enabled: false, afterMinutes: 10, roles: ['general_manager'], users: [] },   // OFF until the hotel confirms (Q26): one extra alert N minutes after the first, to these recipients
  wastageReasons: ['Spoilage', 'Expired ingredient', 'Preparation error', 'Over-preparation', 'Burnt food', 'Damaged food', 'Returned food', 'Other'], // practical defaults, not an official list - extendable here
  consumption: { autoConsume: true, department: 'Kitchen', enabledFrom: null }, // enabledFrom is stamped by the Phase 7 migration: bills finalised before it are NEVER consumed retroactively
  prep: { referenceDays: 7 },            // how many past days the preparation list shows sales for (reference only - not a forecast)
  performance: { onTimeUsesDelayThreshold: true, composite: { enabled: false, onTimeWeight: 60, taskWeight: 40 } }, // composite indicator OFF by default; method is TBC (Q60)
  board: { pollSeconds: 5, newHighlightSeconds: 120 },
};
/**
 * Phase 8 (Bar). Everything the PDF marks "to be confirmed" is configuration, never a hard-wired rule:
 *   happy-hour timings & rules (Q29)  -> happyHour.rules is EMPTY: no happy hour is active until the hotel configures one
 *   variance tolerance (Q29)           -> variance.toleranceMl / tolerancePercent / toleranceOther are null: until set, EVERY difference is reported (provisional)
 *   variance alert recipients (Q29)    -> variance.recipients empty: provisional fallback = everyone holding bar.variance.view (the PDF's applicable roles are permission-driven)
 *   shift definitions (not specified)  -> shifts.definitions is EMPTY: shifts are started ad hoc with a free-text label
 *   bar billing destination (Q28)      -> billing.mode is null ("pending"): bar orders are never posted to a bill or a room folio
 */
const BAR_DEFAULTS = {
  department: 'Bar',                              // Phase 4 stock department that holds bar stock
  liquorCategories: ['Liquor'],                   // inventory categories whose items are poured from bottles (sealed / opened split)
  trackedCategories: ['Liquor', 'Soft drinks'],   // categories included in stock counts and shift opening/closing (liquor + mixers)
  pegMl: 30,                                      // the PDF's smallest serving (30 ml): the unit peg variance is expressed in
  autoOpenBottles: false,                         // false: a bottle must be opened (recorded) before pegs can be served from it
  allowSalesWithoutConsumption: false,            // false: a drink whose stock consumption is not configured cannot be sold (never guessed)
  requireOpenShift: false,                        // true: orders / complimentary issues need the user's own open shift
  happyHour: { rules: [] },
  variance: { toleranceMl: null, tolerancePercent: null, toleranceOther: null, recipients: { roles: [], users: [] } },
  shifts: { definitions: [] },
  wastageReasons: ['Spillage', 'Wrong order', 'Expired / spoiled', 'Returned by guest', 'Tasting / quality check', 'Other'],       // practical defaults, extendable here - not an official list
  breakageReasons: ['Bottle dropped', 'Glass broken', 'Damaged in storage', 'Damaged in transit', 'Other'],
  billing: { mode: null, note: '' },
};
const BAR_REPLACE = new Set(['rules', 'definitions', 'recipients', 'roles', 'users']);
const barDeep = (d, s) => { const st = s && typeof s.toObject === 'function' ? s.toObject() : s || {}; const out = { ...d, ...st };
  for (const k of Object.keys(d)) if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && !BAR_REPLACE.has(k)) out[k] = barDeep(d[k], st[k]); return out; };
const merge = (defaults, stored) => {
  const out = { ...defaults, ...(stored && typeof stored.toObject === 'function' ? stored.toObject() : stored || {}) };
  for (const k of Object.keys(defaults)) {
    if (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k])) out[k] = { ...defaults[k], ...((stored && stored[k]) || {}) };
  }
  return out;
};
async function propertySettings() { const p = await Property.findOne(); return p?.settings || {}; }
async function inventorySettings() { return merge(INVENTORY_DEFAULTS, (await propertySettings()).inventory); }
const KITCHEN_MAPS = new Set(['stationMinutes', 'orderTypeMinutes']);   // user-edited maps: stored value replaces the default as a whole
const deepMerge = (d, s) => {
  const st = s && typeof s.toObject === 'function' ? s.toObject() : s || {}; const out = { ...d, ...st };
  for (const k of Object.keys(d)) if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && !KITCHEN_MAPS.has(k)) out[k] = deepMerge(d[k], st[k]);
  return out;
};
async function kitchenSettings() { return deepMerge(KITCHEN_DEFAULTS, (await propertySettings()).kitchen); }
async function barSettings() {
  const b = barDeep(BAR_DEFAULTS, (await propertySettings()).bar);
  b.variance.recipients = { roles: [], users: [], ...(b.variance.recipients || {}) };     // a partly stored object must never lose its other list
  b.happyHour.rules = b.happyHour.rules || []; b.shifts.definitions = b.shifts.definitions || [];
  return b;
}
async function housekeepingSettings() { return merge(HK_DEFAULTS, (await propertySettings()).housekeeping); }
/** Restaurant settings + the effective payment-method list and currency. */
async function restaurantSettings() {
  const ps = await propertySettings(); const s = merge(RESTAURANT_DEFAULTS, ps.restaurant);
  return { ...s, taxes: (s.taxes || []).map((t, i) => ({ code: t.code || `TAX${i + 1}`, name: t.name, ratePercent: Number(t.ratePercent) })),
    effectivePaymentMethods: (Array.isArray(s.paymentMethods) && s.paymentMethods.length ? s.paymentMethods : ps.paymentMethods) || [], currency: ps.currency || 'INR' };
}

module.exports = { BAR_DEFAULTS, barSettings, INVENTORY_DEFAULTS, HK_DEFAULTS, RESTAURANT_DEFAULTS, KITCHEN_DEFAULTS, inventorySettings, housekeepingSettings, restaurantSettings, kitchenSettings, merge };
