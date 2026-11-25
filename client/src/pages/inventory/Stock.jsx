import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes, Download, Search } from 'lucide-react';
import { useDebounced, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { Async, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import { DeptSelect, dateOnly, downloadFile, qtyFmt, rupee, useInvScope } from './shared';

export default function Stock() {
  const can = useAuth((s) => s.can);
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300);
  const department = sp.get('department') || ''; const category = sp.get('category') || ''; const lowOnly = sp.get('low') === '1';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const { departments, ownOnly } = useInvScope();
  const cats = useGet('/inventory/categories');
  const params = { q: dq || undefined, department: department || undefined, category: category || undefined, lowOnly: lowOnly ? 'true' : undefined };
  const st = useGet('/inventory/stock', params);
  const rows = st.data || [];
  const totalValue = rows.reduce((s, r) => s + (r.value || 0), 0);
  return (
    <>
      <PageHeader title="Department stock" subtitle={ownOnly ? `Your department's stock` : 'Stock held by each department'}
        actions={can('inventory.reports') || can('inventory.view') ? <Button variant="secondary" onClick={() => downloadFile('/inventory/stock', { ...params, format: 'csv' }, 'stock.csv')}><Download size={16} />Export CSV</Button> : null} />
      <Card pad={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><Input className="pl-9" aria-label="Search stock" placeholder="Search item name or code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {!ownOnly && <DeptSelect value={department} onChange={(v) => set('department', v)} departments={departments} all="All departments" label="Department" />}
          <Select aria-label="Category" value={category} onChange={(e) => set('category', e.target.value)}><option value="">All categories</option>{(cats.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select>
          <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => set('low', e.target.checked ? '1' : '')} />Low stock only</label>
        </div>
        <Async state={st} empty={<EmptyState icon={Boxes} title="No stock found" text="Nothing matches these filters, or no stock has been recorded yet." />}>{() => (
          <>
            <Table rows={rows.map((r) => ({ ...r, _id: `${r.item._id}|${r.department}` }))} columns={[
              { header: 'Item', render: (r) => <Link to={`/inventory/items/${r.item._id}`} className="font-semibold text-brand-700">{r.item.name}<span className="block text-xs font-normal text-slate-400">{r.item.sku} · {r.item.category}</span></Link> },
              { header: 'Department', key: 'department' },
              { header: 'On hand', className: 'text-right', render: (r) => <span className="font-bold">{qtyFmt(r.qty)} <span className="font-normal text-slate-500">{r.unit}</span></span> },
              { header: 'Minimum', className: 'text-right', render: (r) => (r.minLevel != null ? qtyFmt(r.minLevel) : <span className="text-slate-300">—</span>) },
              { header: 'Value', className: 'text-right', render: (r) => rupee(r.value) },
              { header: 'Next expiry', render: (r) => (r.nextExpiry ? dateOnly(r.nextExpiry) : <span className="text-slate-300">—</span>) },
              { header: 'Status', render: (r) => <div className="flex flex-wrap gap-1">{r.low && <Badge tone="red">Low</Badge>}{r.expired && <Badge tone="red">Expired lot</Badge>}{r.expiringSoon && <Badge tone="amber">Expiring</Badge>}{!r.low && !r.expired && !r.expiringSoon && <Badge tone="green">OK</Badge>}</div> },
            ]} />
            <p className="border-t border-slate-100 px-4 py-3 text-right text-xs text-slate-500">{rows.length} line{rows.length === 1 ? '' : 's'} · total value <b>{rupee(totalValue)}</b></p>
          </>
        )}</Async>
      </Card>
    </>
  );
}
