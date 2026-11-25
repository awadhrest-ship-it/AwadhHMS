import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui';
import { useGet } from '../../hooks/useApi';
import { newKey, idem, rs, TYPE_TONE, Mono } from '../restaurant/shared';

export { newKey, idem, rs, TYPE_TONE, Mono };
export const STATIONS = ['Main kitchen', 'Indian', 'Chinese', 'Tandoor'];
export const STATION_TONE = { 'Main kitchen': 'slate', Indian: 'orange', Chinese: 'red', Tandoor: 'amber', Unassigned: 'violet' };
export const STATUS_TONE = { Queued: 'blue', Preparing: 'amber', Ready: 'green', Served: 'indigo', Cancelled: 'red' };
export const CONSUMPTION_TONE = { Pending: 'amber', Posted: 'green', 'No Recipe': 'slate', Failed: 'red', Waived: 'violet' };
export const StationBadge = ({ station }) => station ? <Badge tone={STATION_TONE[station] || 'slate'}>{station}</Badge> : <Badge tone="slate">No station</Badge>;
export const pct = (v) => (v == null ? '-' : `${v}%`);
export const todayStr = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);   // IST business date, like the server

export const KitchenTabs = [
  { to: '/kitchen', label: 'Overview', perm: 'kitchen.view', exact: true }, { to: '/kitchen/display', label: 'Kitchen display', perm: 'kitchen.view' },
  { to: '/kitchen/recipes', label: 'Recipes', perm: 'kitchen.recipes.view' }, { to: '/kitchen/consumption', label: 'Consumption', perm: 'kitchen.consumption.view' },
  { to: '/kitchen/wastage', label: 'Wastage', perm: ['kitchen.wastage.record', 'kitchen.wastage.view'] }, { to: '/kitchen/prep', label: 'Preparation list', perm: ['kitchen.prep.work', 'kitchen.prep.manage'] },
  { to: '/kitchen/performance', label: 'Chef performance', perm: 'kitchen.performance.view' }, { to: '/kitchen/settings', label: 'Settings', perm: 'kitchen.view' },
];
export function SubNav({ can }) {
  const loc = typeof location !== 'undefined' ? location.pathname : '';
  const ok = (p) => [].concat(p).some((x) => can(x));
  return (
    <nav className="scroll-thin -mx-1 mb-5 flex gap-1 overflow-x-auto px-1" aria-label="Kitchen sections">
      {KitchenTabs.filter((t) => ok(t.perm)).map((t) => {
        const active = t.exact ? loc === t.to : loc.startsWith(t.to);
        return <Link key={t.to} to={t.to} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${active ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{t.label}</Link>;
      })}
    </nav>
  );
}
/**
 * GET that refreshes itself. Real-time delivery for the kitchen display is safe polling (the app has no socket layer and none was added):
 * it pauses while the tab is hidden, refreshes immediately when the tab becomes visible again, and cleans up its timers.
 */
export function usePollGet(url, params, ms = 5000) {
  const g = useGet(url, params); const { reload } = g;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, ms);
    const vis = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', vis); window.addEventListener('online', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', vis); };
  }, [ms, reload]);
  return g;
}
