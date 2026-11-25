const { RoomCategory, RatePlan } = require('../models');
const { toDate, addDays, DAY } = require('../utils/dates');
const { bad } = require('../utils/ApiError');

const applyAdj = (base, adj) => {
  if (!adj || !adj.value) return base;
  return Math.max(0, adj.type === 'percent' ? base * (1 + adj.value / 100) : base + adj.value);
};
function ruleMatches(rule, ctx) {
  const id = (x) => x && String(x._id || x);
  if (rule.roomCategory && id(rule.roomCategory) !== id(ctx.category._id)) return false;
  if (rule.daysOfWeek?.length && !rule.daysOfWeek.includes(ctx.date.getUTCDay())) return false;
  if (rule.dateFrom && ctx.date < toDate(rule.dateFrom)) return false;
  if (rule.dateTo && ctx.date > toDate(rule.dateTo)) return false;
  if (rule.minNights && ctx.nights < rule.minNights) return false;
  if (rule.maxNights && ctx.nights > rule.maxNights) return false;
  if (rule.minGuests && ctx.guests < rule.minGuests) return false;
  if (rule.maxGuests && ctx.guests > rule.maxGuests) return false;
  if (rule.clientName && (ctx.clientName || '').toLowerCase() !== rule.clientName.toLowerCase()) return false;
  if (rule.bookingSource && (ctx.source || '') !== rule.bookingSource) return false;
  return true;
}

/** quote({ categoryId, ratePlanId, checkIn, checkOut, adults, children, extraBed, clientName, source }) */
async function quote(q) {
  const category = await RoomCategory.findById(q.categoryId);
  if (!category) throw bad('Room category not found');
  const plan = q.ratePlanId ? await RatePlan.findById(q.ratePlanId) : null;
  if (q.ratePlanId && (!plan || !plan.active)) throw bad('Rate plan not found or inactive');
  const ci = toDate(q.checkIn), co = toDate(q.checkOut);
  const nights = Math.round((co - ci) / DAY);
  if (nights < 1) throw bad('Check-out must be after check-in');
  const guests = (q.adults || 1) + (q.children || 0);
  const breakdown = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(ci, i);
    let rate = category.basePrice;
    if (plan) {
      const rule = plan.rules.find((r) => ruleMatches(r, { category, date, nights, guests, clientName: q.clientName, source: q.source }));
      rate = rule ? applyAdj(rule.rate ?? category.basePrice, rule.adjustment) : applyAdj(category.basePrice, plan.defaultAdjustment);
    }
    breakdown.push({ date, rate: Math.round(rate) });
  }
  const roomTotal = breakdown.reduce((s, b) => s + b.rate, 0);
  const extraBedAmount = q.extraBed ? category.extraBedCharge * nights : 0;
  const subtotal = roomTotal + extraBedAmount;
  const { Property } = require('../models');
  const prop = await Property.findOne();
  const taxPct = prop?.settings?.taxRatePercent || 0; // TBC Q14
  const taxAmount = Math.round(subtotal * taxPct) / 100;
  return {
    nights, breakdown, nightlyRate: Math.round(roomTotal / nights), extraBedAmount, subtotal,
    taxPercent: taxPct, taxAmount, total: subtotal + taxAmount, taxTBC: taxPct === 0,
  };
}
module.exports = { quote };
