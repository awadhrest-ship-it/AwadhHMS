import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Package, Plus, Search } from 'lucide-react';
import { useDebounced, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { Async, Badge, Button, Card, EmptyState, Input, PageHeader, Pills, Select, Table } from '../../components/ui';
import { DeptSelect, StockBadges, qtyFmt, rupee, useInvScope } from './shared';
import ItemDetail from './ItemDetail';
import ItemForm from './ItemForm';

const STATUS = [{ key: '', label: 'All' }, { key: 'in', label: 'In stock' }, { key: 'low', label: 'Low' }, { key: 'out', label: 'Out of stock' }, { key: 'expiring', label: 'Expiring' }, { key: 'expired', label: 'Expired' }];

export default function Items() {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const { id } = useParams(); const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [page, setPage] = useState(1);
  const status = sp.get('status') || ''; const category = sp.get('category') || ''; const department = sp.get('department') || ''; const active = sp.get('active') || '';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(1); };
  const { departments, ownOnly } = useInvScope(); const cats = useGet('/inventory/categories');
  const st = useGet('/inventory/items', { q: dq || undefined, status: status || undefined, category: category || undefined, department: department || undefined, active: active || undefined, page, limit: 50 });
  const [form, setForm] = useState({ open: false, item: null });
  useEffect(() => { if (sp.get('new') === '1' && can('inventory.create')) { setForm({ open: true, item: null }); const n = new URLSearchParams(sp); n.delete('new'); setSp(n, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [detailKey, setDetailKey] = useState(0);
  const saved = (item) => { setForm({ open: false, item: null }); st.reload(); setDetailKey((k) => k + 1); if (!id && item?._id) nav(`/inventory/items/${item._id}`); };
  return (
    <>
      <PageHeader title="Inventory items" subtitle="Everything the hotel stocks, with units, minimum levels and current stock" actions={can('inventory.create') && <Button onClick={() => setForm({ open: true, item: null })}><Plus size={16} />New item</Button>} />
      <Card pad={false}>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><Input className="pl-9" aria-label="Search items" placeholder="Search name, code, description" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
            <Select aria-label="Category" value={category} onChange={(e) => set('category', e.target.value)}><option value="">All categories</option>{(cats.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select>
            {!ownOnly && <DeptSelect value={department} onChange={(v) => set('department', v)} departments={departments} all="All departments" />}
            <Select aria-label="Active" value={active} onChange={(e) => set('active', e.target.value)}><option value="">Active items</option><option value="false">Inactive only</option><option value="all">Active and inactive</option></Select>
          </div>
          <Pills items={STATUS} value={status} onChange={(v) => set('status', v)} />
        </div>
        <Async state={st} empty={<EmptyState icon={Package} title="No items found" text="Try a different search or filter." action={can('inventory.create') && <Button onClick={() => setForm({ open: true, item: null })}>Create the first item</Button>} />}>{(rows) => (
          <>
            <Table rows={rows} onRow={(r) => nav(`/inventory/items/${r._id}`)} columns={[
              { header: 'Item', render: (r) => <span className="font-semibold text-slate-900">{r.name}{r.isDemo && <span className="ml-1.5 align-middle"><Badge tone="amber">Demo</Badge></span>}<span className="block text-xs font-normal text-slate-400">{r.sku} · {r.category?.name}</span></span> },
              { header: 'On hand', className: 'text-right', render: (r) => <b>{qtyFmt(r.stock.total)} <span className="font-normal text-slate-500">{r.baseUnit}</span></b> },
              { header: 'Where', render: (r) => <span className="text-xs text-slate-500">{Object.entries(r.stock.byDepartment).map(([d, v]) => `${d} ${qtyFmt(v)}`).join(' · ') || '—'}</span> },
              { header: 'Value', className: 'text-right', render: (r) => rupee(r.stock.value) },
              { header: 'Status', render: (r) => <div className="flex flex-wrap gap-1">{!r.active && <Badge>Inactive</Badge>}<StockBadges stock={r.stock} />{r.active && !r.stock.out && !r.stock.low && !r.stock.expired && !r.stock.expiringSoon && <Badge tone="green">OK</Badge>}</div> },
            ]} />
            {(st.raw?.pages || 1) > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {st.raw.pages} · {st.raw.total} items</span><Button size="sm" variant="secondary" disabled={page >= st.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
          </>
        )}</Async>
      </Card>
      <ItemDetail key={detailKey} id={id} onClose={() => nav('/inventory/items')} onEdit={(it) => setForm({ open: true, item: it })} onChanged={st.reload} />
      <ItemForm open={form.open} item={form.item} onClose={() => setForm({ open: false, item: null })} onSaved={saved} />
      <p className="mt-3 text-xs text-slate-400">Need to receive or issue stock? <Link className="font-semibold text-brand-700" to="/inventory/movements?new=1">Record a movement</Link>.</p>
    </>
  );
}
