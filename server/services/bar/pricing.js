/**
 * Bar pricing - runs ONLY on the backend. Normal menu price unless a CONFIGURED, ACTIVE happy-hour rule covers this drink right now.
 * Happy-hour timings/rules are TBC in the PDF (Q29): no rule exists by default and none is invented. Time is evaluated in the hotel's time zone.
 * Rule: { id, name, active, days:[0-6, 0=Sunday], start:'HH:mm', end:'HH:mm' (end < start = past midnight), scope:'all'|'items', menuItems:[ids],
 *         mode:'percent'|'itemPrice', percentOff (percent mode) }.   'itemPrice' uses the serving's own happyHourPrice (drinks without one keep the normal price).
 */
const { bad } = require('../../utils/ApiError');
const TZ = 'Asia/Kolkata';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const rup = (n) => Math.round(Number(n) * 100) / 100;

function hotelClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

/** Is the rule running at this moment? (a rule whose window runs past midnight belongs to the day it STARTED on) */
function ruleActive(rule, now = new Date()) {
  if (!rule || rule.active === false) return false;
  const { day, minutes } = hotelClock(now); const s = toMin(rule.start); const e = toMin(rule.end);
  if (s === e) return false;
  if (s < e) return (rule.days || []).includes(day) && minutes >= s && minutes < e;
  return ((rule.days || []).includes(day) && minutes >= s) || ((rule.days || []).includes((day + 6) % 7) && minutes < e);
}
function validateRules(rules) {
  const ids = new Set();
  return (rules || []).map((r, i) => {
    const n = `Happy-hour rule ${i + 1}`;
    if (!r.name || String(r.name).trim().length < 2) throw bad(`${n}: enter a name`);
    if (!HHMM.test(r.start || '') || !HHMM.test(r.end || '')) throw bad(`${n}: start and end must be times like 17:00`);
    if (r.start === r.end) throw bad(`${n}: start and end cannot be the same time`);
    if (!Array.isArray(r.days) || !r.days.length || r.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad(`${n}: choose at least one day`);
    if (!['percent', 'itemPrice'].includes(r.mode)) throw bad(`${n}: choose how the price changes`);
    if (r.mode === 'percent' && !(Number(r.percentOff) > 0 && Number(r.percentOff) < 100)) throw bad(`${n}: the discount must be between 0 and 100 percent`);
    if (!['all', 'items'].includes(r.scope)) throw bad(`${n}: choose which drinks it applies to`);
    if (r.scope === 'items' && !(r.menuItems || []).length) throw bad(`${n}: choose at least one drink`);
    const id = r.id && !ids.has(r.id) ? r.id : `hh${Date.now().toString(36)}${i}`; ids.add(id);
    return { id, name: String(r.name).trim(), active: r.active !== false, days: [...new Set(r.days)].sort(), start: r.start, end: r.end, scope: r.scope, menuItems: r.scope === 'items' ? r.menuItems.map(String) : [], mode: r.mode, percentOff: r.mode === 'percent' ? Number(r.percentOff) : undefined };
  });
}
/** priceFor(menu, serving, settings, now) -> { basePrice, unitPrice, happyHour:{applied, rule?, ruleId?, mode?}, configured } */
function priceFor(menu, serving, settings, now = new Date()) {
  const base = rup(serving.price); const rules = settings.happyHour?.rules || [];
  const configured = rules.some((r) => r.active !== false);
  let best = { unitPrice: base, happyHour: { applied: false } };
  for (const r of rules) {
    if (!ruleActive(r, now)) continue;
    if (r.scope === 'items' && !r.menuItems.map(String).includes(String(menu._id))) continue;
    let p = null;
    if (r.mode === 'percent') p = rup(base * (1 - r.percentOff / 100));
    else if (r.mode === 'itemPrice' && serving.happyHourPrice != null) p = rup(serving.happyHourPrice);
    if (p != null && p < best.unitPrice) best = { unitPrice: p, happyHour: { applied: true, rule: r.name, ruleId: r.id, mode: r.mode } };
  }
  return { basePrice: base, unitPrice: best.unitPrice, happyHour: best.happyHour, configured };
}
module.exports = { ruleActive, validateRules, priceFor, hotelClock, rup };
