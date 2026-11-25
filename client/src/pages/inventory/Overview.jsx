import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRightLeft, Package, Warehouse } from 'lucide-react';
import { useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { Async, Badge, Card, EmptyState, Kpi, PageHeader, Table } from '../../components/ui';
import { MOVEMENT_STATUS_TONE, MOVEMENT_TONE } from '../../utils/constants';
import { fmtDateTime } from '../../utils/format';
import { qtyFmt, rupee } from './shared';

export default function Overview() {
  const can = useAuth((s) => s.can);
  const st = useGet('/inventory/summary');
  return (
    <>
      <PageHeader title="Inventory & Stores" subtitle={st.data?.scope && st.data.scope !== 'all' ? `Showing ${st.data.scope} stock` : 'All departments'}
        actions={<>{can('inventory.move') && <Link to="/inventory/movements?new=1" className="btn btn-primary"><ArrowRightLeft size={16} />Record movement</Link>}{can('inventory.create') && <Link to="/inventory/items?new=1" className="btn btn-secondary"><Package size={16} />New item</Link>}</>} />
      <Async state={st} isEmpty={() => false}>{(d) => (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Active items" value={d.items} sub={`${d.itemsInStock} in stock`} to="/inventory/items" />
            <Kpi label="Stock value" value={rupee(d.stockValue)} sub="at purchase cost" />
            <Kpi label="Low stock" value={d.lowStock} tone={d.lowStock ? 'red' : 'green'} sub={d.lowStock ? 'below minimum level' : 'all above minimum'} to="/inventory/alerts" />
            <Kpi label="Expiring soon" value={d.expiringSoon} tone={d.expiringSoon ? 'amber' : 'green'} sub={`within ${d.expiryWarningDays} days`} to="/inventory/alerts" />
            <Kpi label="Expired batches" value={d.expired} tone={d.expired ? 'red' : 'green'} to="/inventory/alerts" />
            <Kpi label="Awaiting approval" value={d.pendingAdjustments} tone={d.pendingAdjustments ? 'amber' : 'slate'} sub="stock adjustments" to={d.pendingAdjustments ? '/approvals' : undefined} />
          </div>
          {d.outOfStock > 0 && <p className="flex items-center gap-2 text-sm text-slate-600"><AlertTriangle size={15} className="text-amber-600" />{d.outOfStock} active item{d.outOfStock === 1 ? ' has' : 's have'} no stock at all.</p>}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Value by department" pad={false}>
              <Table dense rows={d.byDepartment} rowKey="department" empty={<EmptyState icon={Warehouse} title="No stock recorded yet" text="Add an item with opening stock, or record a Stock In." />}
                columns={[{ header: 'Department', render: (r) => <Link className="font-semibold text-brand-700" to={`/inventory/stock?department=${encodeURIComponent(r.department)}`}>{r.department}</Link> }, { header: 'Items', key: 'items', className: 'text-right' }, { header: 'Value', className: 'text-right', render: (r) => rupee(r.value) }]} />
            </Card>
            <Card title="Value by category" pad={false}>
              <Table dense rows={d.byCategory} rowKey="category" empty={<EmptyState title="Nothing to show yet" />}
                columns={[{ header: 'Category', key: 'category' }, { header: 'Items', key: 'items', className: 'text-right' }, { header: 'Value', className: 'text-right', render: (r) => rupee(r.value) }]} />
            </Card>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Losses, last 30 days" className="lg:col-span-1">
              <dl className="space-y-2 text-sm">{Object.entries(d.lossLast30Days).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="font-bold">{v} record{v === 1 ? '' : 's'}</dd></div>)}</dl>
              {can('inventory.reports') && <Link to="/inventory/movements?type=Wastage,Breakage,Damaged" className="mt-3 inline-block text-sm font-semibold text-brand-700">View loss movements →</Link>}
            </Card>
            <Card title="Recent movements" className="lg:col-span-2" pad={false} action={<Link to="/inventory/movements" className="text-xs font-semibold text-brand-700">All movements</Link>}>
              <Table dense rows={d.recentMovements} empty={<EmptyState title="No movements yet" />}
                columns={[{ header: 'Ref', render: (r) => <span className="font-mono text-xs">{r.movementNumber}</span> }, { header: 'Type', render: (r) => <Badge tone={MOVEMENT_TONE[r.type]}>{r.type}</Badge> },
                  { header: 'Items', render: (r) => <span className="text-sm">{r.lines.slice(0, 2).map((l) => `${l.itemName} ${qtyFmt(l.quantity)} ${l.unit}`).join(', ')}{r.lines.length > 2 ? ` +${r.lines.length - 2}` : ''}</span> },
                  { header: 'Status', render: (r) => <Badge tone={MOVEMENT_STATUS_TONE[r.status]}>{r.status}</Badge> }, { header: 'When', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span> }]} />
            </Card>
          </div>
          {!can('inventory.move') && <p className="text-xs text-slate-400">You have view-only access to inventory.</p>}
        </div>
      )}</Async>
    </>
  );
}
