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
const merge = (defaults, stored) => {
  const out = { ...defaults, ...(stored && typeof stored.toObject === 'function' ? stored.toObject() : stored || {}) };
  for (const k of Object.keys(defaults)) {
    if (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k])) out[k] = { ...defaults[k], ...((stored && stored[k]) || {}) };
  }
  return out;
};
async function propertySettings() { const p = await Property.findOne(); return p?.settings || {}; }
async function inventorySettings() { return merge(INVENTORY_DEFAULTS, (await propertySettings()).inventory); }
async function housekeepingSettings() { return merge(HK_DEFAULTS, (await propertySettings()).housekeeping); }
/** Restaurant settings + the effective payment-method list and currency. */
async function restaurantSettings() {
  const ps = await propertySettings(); const s = merge(RESTAURANT_DEFAULTS, ps.restaurant);
  return { ...s, taxes: (s.taxes || []).map((t, i) => ({ code: t.code || `TAX${i + 1}`, name: t.name, ratePercent: Number(t.ratePercent) })),
    effectivePaymentMethods: (Array.isArray(s.paymentMethods) && s.paymentMethods.length ? s.paymentMethods : ps.paymentMethods) || [], currency: ps.currency || 'INR' };
}

module.exports = { INVENTORY_DEFAULTS, HK_DEFAULTS, RESTAURANT_DEFAULTS, inventorySettings, housekeepingSettings, restaurantSettings, merge };
