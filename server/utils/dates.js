// Dates are "hotel dates" (no time-of-day), stored as UTC midnight. "Today" is computed in Asia/Kolkata.
const TZ = 'Asia/Kolkata';
const DAY = 86400000;

function todayStr(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now); // YYYY-MM-DD
}
function toDate(v) {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error(`Invalid date: ${v}`), { status: 400 });
  return d;
}
const today = () => toDate(todayStr());
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const nightsBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
const fmt = (d) => toDate(d).toISOString().slice(0, 10);
function startOfIstDay(str = todayStr()) { return new Date(`${str}T00:00:00+05:30`); }
function startOfIstMonth() { return new Date(`${todayStr().slice(0, 7)}-01T00:00:00+05:30`); }

module.exports = { todayStr, toDate, today, addDays, nightsBetween, fmt, startOfIstDay, startOfIstMonth, DAY };
