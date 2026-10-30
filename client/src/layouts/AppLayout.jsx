import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BedDouble, CalendarCheck, ClipboardList, LayoutDashboard, LogOut, Menu, MessageSquareWarning, ReceiptText, ScrollText, Search, Settings, ShieldCheck, Users, UserCog, KeyRound, Building2, X, ArrowLeftRight, Boxes, Package, Warehouse, ArrowRightLeft, ClipboardCheck, Siren, SprayCan, ListChecks, BadgeCheck, Droplets, FileWarning, Gauge, SlidersHorizontal } from 'lucide-react';
import { UtensilsCrossed, Armchair, BookOpen, ShoppingCart, Receipt, FileCheck2, ChefHat } from 'lucide-react';
import { useAuth } from '../store/auth';
import api from '../services/api';
import { Avatar, Badge, cx } from '../components/ui';
import { SEVERITY_TONE } from '../utils/constants';
import { fmtDateTime } from '../utils/format';

const NAV = [
  { group: null, items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: ['dashboard.owner', 'dashboard.frontoffice'] }] },
  { group: 'Front Office', items: [
    { to: '/rooms', label: 'Rooms', icon: BedDouble, perm: ['rooms.view'] },
    { to: '/reservations', label: 'Reservations', icon: CalendarCheck, perm: ['reservations.view'] },
    { to: '/guests', label: 'Guests', icon: Users, perm: ['guests.view'] },
    { to: '/check-in', label: 'Check-in / out', icon: ArrowLeftRight, perm: ['reservations.checkin', 'reservations.checkout'], match: ['/check-in', '/check-out'] },
    { to: '/bills', label: 'Guest bills', icon: ReceiptText, perm: ['bills.view'] },
    { to: '/complaints', label: 'Complaints', icon: MessageSquareWarning, perm: ['complaints.view'] },
  ] },
  { group: 'Housekeeping', items: [
    { to: '/housekeeping/my-tasks', label: 'My tasks', icon: ListChecks, perm: ['housekeeping.work'] },
    { to: '/housekeeping', label: 'Task board', icon: SprayCan, perm: ['housekeeping.view'], exact: true },
    { to: '/housekeeping/inspections', label: 'Inspections', icon: BadgeCheck, perm: ['housekeeping.inspect', 'housekeeping.view'] },
    { to: '/housekeeping/supplies', label: 'Linen & supplies', icon: Droplets, perm: ['housekeeping.work', 'housekeeping.stock', 'housekeeping.view'] },
    { to: '/housekeeping/reports', label: 'Damage & lost-found', icon: FileWarning, perm: ['housekeeping.work', 'housekeeping.view'] },
    { to: '/housekeeping/performance', label: 'Staff performance', icon: Gauge, perm: ['housekeeping.performance', 'housekeeping.work'] },
    { to: '/housekeeping/settings', label: 'HK settings', icon: SlidersHorizontal, perm: ['housekeeping.configure'] },
  ] },
  { group: 'Inventory & Stores', items: [
    { to: '/inventory', label: 'Overview', icon: Warehouse, perm: ['inventory.view'], exact: true },
    { to: '/inventory/items', label: 'Items', icon: Package, perm: ['inventory.view'] },
    { to: '/inventory/stock', label: 'Department stock', icon: Boxes, perm: ['inventory.view'] },
    { to: '/inventory/movements', label: 'Stock movements', icon: ArrowRightLeft, perm: ['inventory.view'] },
    { to: '/inventory/stocktakes', label: 'Stock count', icon: ClipboardCheck, perm: ['inventory.stocktake', 'inventory.view'] },
    { to: '/inventory/alerts', label: 'Alerts & expiry', icon: Siren, perm: ['inventory.view'] },
    { to: '/inventory/setup', label: 'Units & categories', icon: SlidersHorizontal, perm: ['inventory.view'] },
  ] },
  { group: 'Restaurant', items: [
    { to: '/restaurant', label: 'Overview', icon: UtensilsCrossed, perm: ['restaurant.view'], exact: true },
    { to: '/restaurant/pos', label: 'POS / new order', icon: ShoppingCart, perm: ['restaurant.orders'] },
    { to: '/restaurant/orders', label: 'Orders & kitchen', icon: ChefHat, perm: ['restaurant.view'] },
    { to: '/restaurant/floor', label: 'Tables & reservations', icon: Armchair, perm: ['restaurant.view'] },
    { to: '/restaurant/menu', label: 'Menu', icon: BookOpen, perm: ['restaurant.view'] },
    { to: '/restaurant/bills', label: 'Restaurant bills', icon: Receipt, perm: ['restaurant.view'] },
    { to: '/restaurant/approvals', label: 'Discount approvals', icon: ShieldCheck, perm: ['restaurant.view'] },
    { to: '/restaurant/closing', label: 'Daily closing', icon: FileCheck2, perm: ['restaurant.close'] },
    { to: '/restaurant/settings', label: 'Restaurant settings', icon: SlidersHorizontal, perm: ['restaurant.configure'] },
  ] },
  { group: 'Management', items: [
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck, perm: ['approvals.view'], badge: 'approvals' },
    { to: '/audit-log', label: 'Audit log', icon: ScrollText, perm: ['audit.view'] },
  ] },
  { group: 'Settings', items: [
    { to: '/settings/users', label: 'Users', icon: UserCog, perm: ['users.view'] },
    { to: '/settings/roles', label: 'Roles & permissions', icon: KeyRound, perm: ['roles.view'] },
    { to: '/settings/property', label: 'Property & rules', icon: Building2, perm: ['property.view', 'property.edit'] },
  ] },
];

const TITLES = [['/restaurant/pos', 'Point of sale'], ['/restaurant/orders', 'Orders & kitchen'], ['/restaurant/floor', 'Tables & reservations'], ['/restaurant/menu', 'Menu'], ['/restaurant/bills', 'Restaurant bills'], ['/restaurant/approvals', 'Discount approvals'], ['/restaurant/closing', 'Daily closing'], ['/restaurant/settings', 'Restaurant settings'], ['/restaurant', 'Restaurant'], ['/dashboard', 'Dashboard'], ['/rooms', 'Rooms'], ['/reservations/new', 'New reservation'], ['/reservations', 'Reservations'], ['/guests', 'Guests'], ['/check-in', 'Check-in / out'], ['/check-out', 'Check-in / out'], ['/bills', 'Guest bills'], ['/complaints', 'Complaints'], ['/approvals', 'Approvals'], ['/audit-log', 'Audit log'], ['/settings/users', 'Users'], ['/settings/roles', 'Roles & permissions'], ['/settings/property', 'Property & rules'], ['/housekeeping/my-tasks', 'My tasks'], ['/housekeeping/tasks', 'Housekeeping task'], ['/housekeeping/inspections', 'Inspections'], ['/housekeeping/supplies', 'Linen & supplies'], ['/housekeeping/reports', 'Damage & lost-found'], ['/housekeeping/performance', 'Staff performance'], ['/housekeeping/settings', 'Housekeeping settings'], ['/housekeeping', 'Housekeeping board'], ['/inventory/items', 'Inventory items'], ['/inventory/stock', 'Department stock'], ['/inventory/movements', 'Stock movements'], ['/inventory/stocktakes', 'Stock count'], ['/inventory/alerts', 'Alerts & expiry'], ['/inventory/setup', 'Units & categories'], ['/inventory', 'Inventory & Stores']];

function Sidebar({ onNavigate, pending }) {
  const user = useAuth((s) => s.user);
  const visible = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.perm.some((p) => user.permissions.includes(p))) })).filter((g) => g.items.length);
  return (
    <nav className="flex h-full flex-col bg-navy-900 text-slate-300" aria-label="Main">
      <div className="px-5 pb-4 pt-6" style={{ paddingTop: 'max(1.5rem, var(--safe-top))' }}>
        <p className="text-base font-extrabold tracking-wide text-white">AWADH PALACE</p>
        <p className="text-xs text-slate-400">Hotel Management</p>
      </div>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {visible.map((g, gi) => (
          <div key={gi}>
            {g.group && <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.group}</p>}
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.exact} onClick={onNavigate}
                className={({ isActive }) => cx('mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition', (isActive || it.match?.some((m) => location.pathname.startsWith(m))) ? 'bg-brand-600 text-white shadow' : 'hover:bg-white/5 hover:text-white')}>
                <it.icon size={17} /><span className="flex-1">{it.label}</span>
                {it.badge === 'approvals' && pending > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-navy-900">{pending}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <p className="px-5 py-3 text-[10px] text-slate-500" style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}>Phases 1–6 · Core, Rooms, Front Desk, Inventory, Housekeeping, Restaurant</p>
    </nav>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false); const [data, setData] = useState({ data: [], unread: 0 }); const nav = useNavigate(); const ref = useRef();
  const load = async () => { try { const { data: d } = await api.get('/notifications'); setData(d); } catch { /* ignore */ } };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const click = async (n) => { setOpen(false); if (!n.read) { await api.post(`/notifications/${n._id}/read`); load(); } if (n.link) nav(n.link); };
  const readAll = async () => { await api.post('/notifications/read-all'); load(); };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen(!open); if (!open) load(); }} aria-label={`Notifications, ${data.unread} unread`} className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100">
        <Bell size={19} />{data.unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="anim-fade fixed inset-x-3 top-16 z-40 rounded-xl border border-slate-200 bg-white shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><p className="text-sm font-bold">Notifications</p>{data.unread > 0 && <button onClick={readAll} className="text-xs font-semibold text-brand-700">Mark all read</button>}</div>
          <ul className="scroll-thin max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {data.data.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</li>}
            {data.data.map((n) => (
              <li key={n._id}><button onClick={() => click(n)} className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.read && 'bg-brand-50/50')}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-600')} />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-800">{n.title}</span><Badge tone={SEVERITY_TONE[n.severity]}>{n.severity}</Badge></span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{n.message}</span><span className="text-[10px] text-slate-400">{fmtDateTime(n.createdAt)}</span></span>
              </button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState(''); const nav = useNavigate(); const can = useAuth((s) => s.can);
  const go = (e) => { e.preventDefault(); if (!q.trim()) return; const t = q.trim();
    if (/^\d{3}$/.test(t) && can('rooms.view')) nav(`/rooms?q=${t}`);
    else if (/^RES-/i.test(t) && can('reservations.view')) nav(`/reservations?q=${t}`);
    else if (can('guests.view')) nav(`/guests?q=${encodeURIComponent(t)}`);
    else if (can('rooms.view')) nav(`/rooms?q=${encodeURIComponent(t)}`);
    setQ(''); };
  return <form onSubmit={go} className="relative hidden w-full max-w-sm sm:block" role="search"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !rounded-full !bg-slate-100 !pl-9" placeholder="Search guest, phone, room, booking #…" aria-label="Global search" /></form>;
}

export default function AppLayout() {
  const user = useAuth((s) => s.user); const logout = useAuth((s) => s.logout); const nav = useNavigate(); const loc = useLocation();
  const [drawer, setDrawer] = useState(false); const [menu, setMenu] = useState(false); const [pending, setPending] = useState(0); const mref = useRef();
  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { if (!user.permissions.includes('approvals.view')) return undefined; const f = () => api.get('/approvals', { params: { status: 'Pending' } }).then((r) => setPending(r.data.data.length)).catch(() => {}); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, [user, loc.pathname]);
  useEffect(() => { const h = (e) => mref.current && !mref.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const title = (TITLES.find(([p]) => loc.pathname.startsWith(p)) || ['', 'Awadh Palace'])[1];
  return (
    <div className="flex h-full bg-surface">
      <aside className="hidden w-60 shrink-0 lg:block"><div className="fixed inset-y-0 w-60"><Sidebar pending={pending} /></div></aside>
      {drawer && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-slate-900/50 anim-fade" onClick={() => setDrawer(false)} /><div className="anim-slide absolute inset-y-0 left-0 w-72"><Sidebar pending={pending} onNavigate={() => setDrawer(false)} /><button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-4 text-slate-400"><X size={20} /></button></div></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6" style={{ paddingTop: 'var(--safe-top)', minHeight: 'calc(3.75rem + var(--safe-top))' }}>
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu"><Menu size={20} /></button>
          <h2 className="hidden shrink-0 text-base font-bold text-slate-900 sm:block lg:hidden xl:block">{title}</h2>
          <div className="flex flex-1 justify-center sm:justify-start sm:pl-4"><SearchBox /><span className="text-base font-bold sm:hidden">{title}</span></div>
          <Notifications />
          <div className="relative" ref={mref}>
            <button onClick={() => setMenu(!menu)} className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100" aria-haspopup="menu">
              <Avatar name={user.name} size={32} />
              <span className="hidden text-left leading-tight md:block"><span className="block text-sm font-semibold text-slate-800">{user.name}</span><span className="block text-[11px] text-slate-500">{user.role.name}</span></span>
            </button>
            {menu && <div className="anim-fade absolute right-0 top-11 z-40 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop" role="menu">
              <div className="border-b border-slate-100 px-3 py-2"><p className="text-sm font-semibold">{user.name}</p><p className="text-xs text-slate-500">{user.role.name} · {user.department}</p><p className="truncate text-[11px] text-slate-400">{user.email}</p></div>
              <button role="menuitem" onClick={async () => { await logout(); nav('/login'); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"><LogOut size={15} />Sign out</button>
            </div>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6" style={{ paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}><Outlet /></main>
      </div>
    </div>
  );
}
