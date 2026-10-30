import { useState } from 'react';
import { Droplets } from 'lucide-react';
import { useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { Async, Badge, Card, EmptyState, PageHeader, Pills, Table, Tabs } from '../../components/ui';
import { SupplyForm } from '../../components/hkSupply';
import { HK_SUPPLY_KINDS } from '../../utils/constants';
import { fmtDateTime } from '../../utils/format';

export default function Supplies() {
  const can = useAuth((s) => s.can); const canStock = can('housekeeping.stock') || can('housekeeping.view');
  const [tab, setTab] = useState(can('housekeeping.work') ? 'use' : 'stock'); const [kind, setKind] = useState('');
  const stock = useGet(tab === 'stock' && canStock ? '/housekeeping/stock' : null, null, [tab]);
  const hist = useGet(tab === 'history' ? '/housekeeping/supplies' : null, { kind: kind || undefined, limit: 300 }, [tab, kind]);
  const [bump, setBump] = useState(0);
  const items = [...(can('housekeeping.work') ? [{ key: 'use', label: 'Record use' }] : []), ...(canStock ? [{ key: 'stock', label: 'Housekeeping stock' }] : []), { key: 'history', label: 'Usage history' }];
  return (<>
    <PageHeader title="Linen & supplies" subtitle="Everything used here is deducted from the Housekeeping department's stock, exactly once" />
    <Tabs value={tab} onChange={setTab} items={items} />
    <div className="mt-4">
      {tab === 'use' && <div className="max-w-2xl"><Card title="Record linen, toiletries or cleaning supplies used"><SupplyForm key={bump} onDone={() => setBump((b) => b + 1)} />
        <p className="mt-3 text-xs text-slate-400">Stock cannot go below zero. If an item is out of stock the system refuses the entry; ask Stores for a transfer.</p></Card></div>}
      {tab === 'stock' && <div className="card"><Async state={stock} empty={<EmptyState icon={Droplets} title="No housekeeping stock" text="Stores can transfer linen, toiletries and cleaning supplies to Housekeeping." />}>
        {(rows) => <Table rows={rows} rowKey="key" columns={[
          { header: 'Item', render: (r) => <><b>{r.item.name}</b><br /><span className="text-xs text-slate-400">{r.item.sku} · {r.item.category}</span></> },
          { header: 'On hand', render: (r) => <b>{r.qty} {r.unit}</b> }, { header: 'Minimum', render: (r) => (r.minLevel != null ? `${r.minLevel} ${r.unit}` : <span className="text-slate-400">not set</span>) },
          { header: 'Used (7 days)', render: (r) => `${r.used7d || 0} ${r.unit}` },
          { header: 'Status', render: (r) => r.low ? <Badge tone="red">Low stock</Badge> : <Badge tone="green">OK</Badge> },
        ]} />}</Async></div>}
      {tab === 'history' && <><Pills className="mb-3" value={kind} onChange={setKind} items={[{ key: '', label: 'All' }, ...HK_SUPPLY_KINDS.map((k) => ({ key: k, label: k }))]} />
        <div className="card"><Async state={hist} empty={<EmptyState title="Nothing recorded yet" />}>
          {(rows) => <Table rows={rows} columns={[{ header: 'When', render: (r) => fmtDateTime(r.at) }, { header: 'Item', render: (r) => <><b>{r.itemName}</b><br /><span className="text-xs text-slate-400">{r.kind}</span></> },
            { header: 'Quantity', render: (r) => `${r.quantity} ${r.unit}` }, { header: 'Room / task', render: (r) => [r.room && `Room ${r.room.roomNumber}`, r.task?.taskNumber].filter(Boolean).join(' · ') || '—' },
            { header: 'By', render: (r) => r.usedByName }, { header: 'Stock', render: (r) => <Badge tone={r.status === 'Posted' ? 'green' : r.status === 'Failed' ? 'red' : 'amber'}>{r.status}</Badge> }]} />}</Async></div></>}
    </div>
  </>);
}
