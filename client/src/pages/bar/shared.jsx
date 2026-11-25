import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Badge, Input } from '../../components/ui';
import { newKey, idem, rs, Mono, useIdemKey } from '../restaurant/shared';
import { todayISO } from '../../utils/format';

export { newKey, idem, rs, Mono, useIdemKey };
export const MEASURES = ['30 ml', '60 ml', 'Full bottle'];
export const ORDER_TONE = { Open: 'amber', Served: 'green', Cancelled: 'slate' };
export const COMP_TONE = { 'Pending Approval': 'amber', Approved: 'blue', Rejected: 'red', Issuing: 'blue', Issued: 'green', Cancelled: 'slate' };
export const CONSUMPTION_TONE = { Configured: 'green', Incomplete: 'red', 'Not stock-tracked': 'slate' };
export const SHIFT_TONE = { Open: 'green', Closing: 'amber', Closed: 'slate' };
export const num = (n, d = 2) => (n == null || Number.isNaN(Number(n)) ? '-' : String(Math.round(Number(n) * 10 ** d) / 10 ** d));
export const signed = (n, d = 2) => (n == null ? '-' : `${Number(n) > 0 ? '+' : ''}${num(n, d)}`);
export const ml = (n) => `${num(n)} ml`;
export const tone = (v) => (!v ? 'text-slate-500' : v > 0 ? 'text-blue-700' : 'text-red-700');

export const BarTabs = [
  { to: '/bar', label: 'Overview', perm: 'bar.view', exact: true }, { to: '/bar/orders', label: 'Drink orders', perm: 'bar.view' }, { to: '/bar/menu', label: 'Bar menu', perm: 'bar.view' },
  { to: '/bar/inventory', label: 'Bottle & peg stock', perm: 'bar.view' }, { to: '/bar/variance', label: 'Stock count & variance', perm: ['bar.variance.view', 'bar.variance.record'] },
  { to: '/bar/complimentary', label: 'Complimentary', perm: ['bar.comp.view', 'bar.comp.request', 'bar.comp.issue'] }, { to: '/bar/losses', label: 'Wastage & breakage', perm: ['bar.loss.view', 'bar.loss.record'] },
  { to: '/bar/shifts', label: 'Shifts', perm: ['bar.shift.work', 'bar.shift.manage'] }, { to: '/bar/reports', label: 'Reports', perm: ['bar.reports', 'bar.shift.work'] }, { to: '/bar/settings', label: 'Settings', perm: 'bar.view' },
];
export function SubNav({ can }) {
  const { pathname } = useLocation(); const ok = (p) => [].concat(p).some((x) => can(x));
  return (
    <nav className="scroll-thin -mx-1 mb-5 flex gap-1 overflow-x-auto px-1" aria-label="Bar sections">
      {BarTabs.filter((t) => ok(t.perm)).map((t) => { const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
        return <Link key={t.to} to={t.to} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${active ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{t.label}</Link>; })}
    </nav>
  );
}
/** A clear "this is not configured / TBC" banner. */
export function Notice({ tone: t = 'amber', title, children }) {
  const c = { amber: 'bg-amber-50 text-amber-900 ring-amber-200', red: 'bg-red-50 text-red-800 ring-red-200', blue: 'bg-blue-50 text-blue-900 ring-blue-200' }[t];
  return <div className={`mb-4 flex gap-2.5 rounded-xl p-3 text-sm ring-1 ${c}`} role="note"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><div className="min-w-0"><p className="font-semibold">{title}</p>{children && <div className="mt-0.5 text-[13px] opacity-90">{children}</div>}</div></div>;
}
export function Filters({ from, to, setFrom, setTo, children }) {
  return <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
    <label className="text-xs font-semibold text-slate-600">From<Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
    <label className="text-xs font-semibold text-slate-600">To<Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>{children}</div>;
}
export const today = todayISO;
export const monthStart = () => `${todayISO().slice(0, 8)}01`;
export const VarBadge = ({ line }) => (!line.hasVariance ? <Badge tone="green">Matches</Badge> : line.exceedsTolerance ? <Badge tone="red">Variance</Badge> : <Badge tone="amber">Within tolerance</Badge>);
