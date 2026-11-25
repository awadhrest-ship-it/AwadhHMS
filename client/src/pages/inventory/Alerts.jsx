import { Link } from 'react-router-dom';
import { RefreshCw, Siren } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, Card, EmptyState, PageHeader, Table, TBC } from '../../components/ui';
import { dateOnly, qtyFmt } from './shared';

const itemCell = (r) => <Link className="font-semibold text-brand-700" to={`/inventory/items/${r.item._id}`}>{r.item.name}<span className="ml-1 text-xs font-normal text-slate-400">{r.item.sku}</span></Link>;

export default function Alerts() {
  const can = useAuth((s) => s.can); const st = useGet('/inventory/alerts'); const [run, busy] = useAction();
  const refresh = async () => { try { await run(() => api.post('/inventory/alerts/refresh')); toast.success('Alerts re-checked'); st.reload(); } catch (e) { toast.error(e.message); } };
  const d = st.data || {};
  const lowCols = [{ header: 'Item', render: itemCell }, { header: 'Department', render: (r) => (r.department === '*' ? 'All departments' : r.department) },
    { header: 'On hand', render: (r) => <span className="font-semibold text-red-600">{qtyFmt(r.onHand)} {r.item.baseUnit}</span> }, { header: 'Minimum', render: (r) => `${qtyFmt(r.minLevel)} ${r.item.baseUnit}` },
    { header: 'Short by', render: (r) => `${qtyFmt(r.shortBy)} ${r.item.baseUnit}` }];
  const expCols = (tone) => [{ header: 'Item', render: itemCell }, { header: 'Department', key: 'department' }, { header: 'Batch', render: (r) => r.lotNo || '—' }, { header: 'Quantity', render: (r) => `${qtyFmt(r.qty)} ${r.item.baseUnit}` },
    { header: 'Expiry', render: (r) => <span className="flex items-center gap-2">{dateOnly(r.expiryDate)}<Badge tone={tone}>{r.daysLeft < 0 ? `${-r.daysLeft} d ago` : `${r.daysLeft} d left`}</Badge></span> }];
  return (
    <>
      <PageHeader title="Alerts & expiry" subtitle={d.expiryWarningDays != null ? `Batches expiring within ${d.expiryWarningDays} days are listed` : undefined}
        actions={can('inventory.alerts') && <Button variant="secondary" loading={busy} onClick={refresh}><RefreshCw size={16} />Re-check now</Button>} />
      <Async state={st} isEmpty={() => false}>{() => (
        <div className="space-y-5">
          <Card title="Low stock" badge={d.low?.length || 0} pad={false}>
            <Table columns={lowCols} rows={d.low || []} rowKey="_id" empty={<EmptyState icon={Siren} title="Nothing is below its minimum" text="Items fall here when stock drops under the minimum level set for a department." />} />
          </Card>
          <Card title="Expired batches" badge={d.expired?.length || 0} pad={false}>
            <Table columns={expCols('red')} rows={d.expired || []} empty={<EmptyState title="No expired stock" />} />
          </Card>
          <Card title="Expiring soon" badge={d.expiring?.length || 0} pad={false}>
            <Table columns={expCols('amber')} rows={d.expiring || []} empty={<EmptyState title="No batches expiring soon" />} />
          </Card>
          <p className="text-xs text-slate-500">Low-stock alerts notify once each time an item drops under its minimum. Expiry notifications are off until the hotel confirms the rule <TBC>TBC</TBC></p>
        </div>
      )}</Async>
    </>
  );
}
