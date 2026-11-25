import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui';
import { useGet } from '../../hooks/useApi';

/** ₹ with paise - bills must show exact amounts (the rest of the app rounds to whole rupees). */
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rs = (n) => inr2.format(Number(n || 0));
export const newKey = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const idem = (key) => ({ headers: { 'Idempotency-Key': key } });
/** One idempotency key per logical submit: kept across retries of the SAME request, replaced once it succeeds. */
export function useIdemKey() { const r = useRef(newKey()); return { get: () => r.current, renew: () => { r.current = newKey(); } }; }

export const TYPE_TONE = { 'Dine-in': 'blue', Takeaway: 'violet', Delivery: 'orange', 'Room Service': 'teal' };
export const ORDER_TONE = { Draft: 'slate', Confirmed: 'blue', Preparing: 'amber', Ready: 'green', Served: 'indigo', Completed: 'green', Cancelled: 'red' };
export const TICKET_TONE = { Queued: 'slate', Preparing: 'amber', Ready: 'green', Served: 'indigo', Cancelled: 'red' };
export const BILL_TONE = { Draft: 'slate', Final: 'blue', Void: 'red' };
export const SETTLE_TONE = { Unsettled: 'amber', 'Part-paid': 'orange', Paid: 'green', 'Posted to Room': 'teal', 'No charge': 'slate' };
export const TABLE_TONE = { Available: 'green', Occupied: 'red', Reserved: 'amber', 'Out of Service': 'slate', Inactive: 'slate' };
export const ADJ_TONE = { Pending: 'amber', Applied: 'green', Rejected: 'red', Superseded: 'slate' };
export const TypeBadge = ({ type }) => <Badge tone={TYPE_TONE[type]}>{type}</Badge>;
export const OrderBadge = ({ status }) => <Badge tone={ORDER_TONE[status]}>{status}</Badge>;
export const VegDot = ({ veg }) => veg == null ? null : <span title={veg ? 'Vegetarian' : 'Non-vegetarian'} className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${veg ? 'border-green-600' : 'border-red-600'}`}><span className={`h-1.5 w-1.5 rounded-full ${veg ? 'bg-green-600' : 'bg-red-600'}`} /></span>;

export function useRestaurantSettings() { return useGet('/restaurant/settings'); }

export const RestaurantTabs = [
  { to: '/restaurant', label: 'Overview', perm: 'restaurant.view', exact: true }, { to: '/restaurant/pos', label: 'POS', perm: 'restaurant.orders' }, { to: '/restaurant/orders', label: 'Orders', perm: 'restaurant.view' },
  { to: '/restaurant/floor', label: 'Tables', perm: 'restaurant.view' }, { to: '/restaurant/menu', label: 'Menu', perm: 'restaurant.view' }, { to: '/restaurant/bills', label: 'Bills', perm: 'restaurant.view' },
  { to: '/restaurant/approvals', label: 'Approvals', perm: 'restaurant.view' }, { to: '/restaurant/closing', label: 'Closing', perm: 'restaurant.close' }, { to: '/restaurant/settings', label: 'Settings', perm: 'restaurant.configure' },
];
/** Interval refresh for live boards (orders / tickets). */
export function usePoll(fn, ms = 20000) { useEffect(() => { const t = setInterval(fn, ms); return () => clearInterval(t); }, [fn, ms]); }
export const Mono = ({ children }) => <span className="font-mono text-xs font-semibold text-slate-700">{children}</span>;
export function SubNav({ can }) {
  const loc = typeof location !== 'undefined' ? location.pathname : '';
  return (
    <nav className="scroll-thin -mx-1 mb-5 flex gap-1 overflow-x-auto px-1" aria-label="Restaurant sections">
      {RestaurantTabs.filter((t) => can(t.perm)).map((t) => {
        const active = t.exact ? loc === t.to : loc.startsWith(t.to);
        return <Link key={t.to} to={t.to} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${active ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{t.label}</Link>;
      })}
    </nav>
  );
}
export const useSettingsState = () => useState(null);
