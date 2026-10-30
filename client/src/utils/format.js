const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n) => inr.format(Math.round(n || 0));
export const compactMoney = (n) => {
  const v = Math.abs(n || 0), sign = n < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(1)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(1)} L`;
  return money(n);
};
const dt = (v, o) => (v ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...o }).format(new Date(v)) : '—');
export const fmtDate = (v) => dt(v, { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtShort = (v) => dt(v, { day: '2-digit', month: 'short', timeZone: 'UTC' });   // hotel dates are UTC midnight
export const fmtHotelDate = (v) => dt(v, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDateTime = (v) => dt(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDay = (v) => dt(v, { weekday: 'short', timeZone: 'UTC' });
export const dayNum = (v) => dt(v, { day: '2-digit', timeZone: 'UTC' });
export const stayRange = (a, b) => `${fmtShort(a)} → ${fmtShort(b)}`;
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const addDaysISO = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
export const toISO = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
export const fullName = (g) => (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : '—');
export const initials = (g) => `${(g?.firstName || '?')[0]}${(g?.lastName || '')[0] || ''}`.toUpperCase();
export const maskPhone = (p = '') => (p.length > 5 ? `${p.slice(0, 2)}••• ••${p.slice(-3)}` : p);
export const greeting = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
