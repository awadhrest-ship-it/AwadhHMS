import { Link } from 'react-router-dom';
import { Armchair, ClipboardList, Receipt, ShieldCheck, ShoppingCart } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useGet } from '../../hooks/useApi';
import { Async, Button, Card, Kpi, PageHeader } from '../../components/ui';
import { SubNav, TABLE_TONE, rs } from './shared';
import { Badge } from '../../components/ui';

export default function RestaurantOverview() {
  const can = useAuth((s) => s.can); const o = useGet('/restaurant/overview');
  return (
    <div><PageHeader title="Restaurant" subtitle="Tables, orders, kitchen queue and billing at a glance" actions={can('restaurant.orders') && <Link to="/restaurant/pos"><Button><ShoppingCart size={16} />New order</Button></Link>} /><SubNav can={can} />
      <Async state={o}>{(d) => (<div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Active orders" value={d.activeOrders} to="/restaurant/orders" sub={Object.entries(d.ordersByStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'None open'} /><Kpi label="Kitchen queue" value={d.kitchenQueue} tone={d.kitchenQueue ? 'amber' : 'slate'} sub="tickets queued or preparing" to="/restaurant/orders" />
          <Kpi label="Awaiting approval" value={d.pendingApprovals} tone={d.pendingApprovals ? 'amber' : 'slate'} sub="discount / complimentary" to="/restaurant/approvals" />{d.todaySales ? <Kpi label="Billed today" value={rs(d.todaySales.total)} tone="blue" sub={`Collected ${rs(d.collectedToday)}`} to="/restaurant/closing" /> : <Kpi label="Tables" value={d.tableTotal} sub={`${d.tables.Available || 0} available`} to="/restaurant/floor" />}</div>
        <Card title="Tables" action={<Link className="text-xs font-semibold text-brand-700" to="/restaurant/floor">Open floor →</Link>}><div className="flex flex-wrap gap-2">{Object.entries(d.tables).map(([k, v]) => <Badge key={k} tone={TABLE_TONE[k]}>{k}: {v}</Badge>)}{!d.tableTotal && <p className="text-sm text-slate-500">No tables set up yet.</p>}</div></Card>
        {d.closingExceptions > 0 && !d.closedToday && can('restaurant.close') && <Link to="/restaurant/closing" className="block rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Today has {d.closingExceptions} closing exception(s) to review →</Link>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[[ClipboardList, 'Orders', '/restaurant/orders'], [Armchair, 'Tables & reservations', '/restaurant/floor'], [Receipt, 'Bills', '/restaurant/bills'], [ShieldCheck, 'Approvals', '/restaurant/approvals']].map(([I, l, to]) => <Link key={to} to={to} className="card flex items-center gap-3 p-4 text-sm font-semibold hover:border-brand-300"><I size={18} className="text-brand-700" />{l}</Link>)}</div>
      </div>)}</Async></div>);
}
