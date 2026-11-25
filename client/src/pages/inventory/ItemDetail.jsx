import { useState } from 'react';
import { Pencil, Power } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, EmptyState, Field, Input, Select, Table, Tabs } from '../../components/ui';
import { ConfirmDialog, Drawer, Modal } from '../../components/feedback';
import { MOVEMENT_TONE } from '../../utils/constants';
import { fmtDateTime } from '../../utils/format';
import { StockBadges, dateOnly, qtyFmt, rupee, unitOptions, useInvScope, useUnits } from './shared';

function Ledger({ id, baseUnit, departments }) {
  const [dept, setDept] = useState(''); const [page, setPage] = useState(1);
  const st = useGet(`/inventory/items/${id}/ledger`, { department: dept || undefined, page });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Select aria-label="Department" className="w-48" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }}><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</Select><span className="text-xs text-slate-400">Pick a department to see its running balance</span></div>
      <Async state={st} empty={<EmptyState title="No movements yet" text="Every stock change for this item will appear here." />}>{(rows) => (
        <>
          <Table dense rows={rows} columns={[
            { header: 'When', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.at)}</span> },
            { header: 'Movement', render: (r) => <span><span className="font-mono text-xs">{r.movementNumber}</span> <Badge tone={MOVEMENT_TONE[r.type]}>{r.type}</Badge></span> },
            { header: 'Dept', render: (r) => <span className="text-sm">{r.department}{r.counterpartDepartment ? <span className="text-xs text-slate-400"> {r.side === 'out' ? '→' : '←'} {r.counterpartDepartment}</span> : null}</span> },
            { header: 'Change', className: 'text-right', render: (r) => <b className={r.delta < 0 ? 'text-red-600' : 'text-green-700'}>{r.delta > 0 ? '+' : ''}{qtyFmt(r.delta)} {baseUnit}</b> },
            { header: 'Balance', className: 'text-right', render: (r) => (r.balanceAfter != null ? qtyFmt(r.balanceAfter) : <span className="text-slate-300">—</span>) },
            { header: 'Batch / expiry', render: (r) => <span className="text-xs">{r.lotNo || ''}{r.expiryDate ? ` · ${dateOnly(r.expiryDate)}` : ''}{!r.lotNo && !r.expiryDate ? '—' : ''}</span> },
            { header: 'By', render: (r) => <span className="text-xs">{r.performedByName}{r.reason ? <span className="block text-slate-400">{r.reason}</span> : null}</span> },
          ]} />
          {(st.raw?.pages || 1) > 1 && <div className="flex items-center justify-between text-xs text-slate-500"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {st.raw.pages}</span><Button size="sm" variant="secondary" disabled={page >= st.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
        </>
      )}</Async>
    </div>
  );
}

function Prices({ item }) {
  const can = useAuth((s) => s.can); const { units } = useUnits();
  const st = useGet(`/inventory/items/${item._id}/prices`);
  const [open, setOpen] = useState(false); const [f, setF] = useState({ unitPrice: '', unit: item.purchaseUnit || item.baseUnit, supplier: '', note: '', date: '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const add = async () => { setErr(''); try { await run(() => api.post(`/inventory/items/${item._id}/prices`, { unitPrice: Number(f.unitPrice), unit: f.unit, supplier: f.supplier || undefined, note: f.note || undefined, date: f.date || undefined })); toast.success('Price recorded'); setOpen(false); setF({ ...f, unitPrice: '', supplier: '', note: '', date: '' }); st.reload(); } catch (e) { setErr(e.message); } };
  const stats = st.raw?.stats;
  return (
    <div className="space-y-3">
      {stats && <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">{[['Latest', stats.latest], ['Lowest', stats.lowest], ['Highest', stats.highest], ['Average', stats.average]].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] font-semibold uppercase text-slate-500">{k}</p><p className="font-bold">{rupee(v)}<span className="text-[10px] font-normal text-slate-400"> /{item.baseUnit}</span></p></div>)}</div>}
      {can('inventory.prices') && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record a price</Button>}
      <Async state={st} empty={<EmptyState title="No prices recorded" text="Prices are recorded automatically on Stock In, or you can add one manually." />}>{(rows) => (
        <Table dense rows={rows} columns={[{ header: 'Date', render: (r) => dateOnly(r.date) }, { header: 'Price', render: (r) => <span>{rupee(r.unitPrice)} <span className="text-xs text-slate-400">/ {r.unit}</span></span> }, { header: `Per ${item.baseUnit}`, className: 'text-right', render: (r) => rupee(r.pricePerBase) },
          { header: 'Supplier', render: (r) => r.supplier || '—' }, { header: 'Source', render: (r) => <span className="text-xs">{r.reference?.label || r.note || 'Manual'}</span> }]} />
      )}</Async>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a price" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!(Number(f.unitPrice) >= 0) || f.unitPrice === ''} onClick={add}>Save price</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price (₹)" required><Input type="number" min="0" step="any" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></Field>
          <Field label="Per unit"><Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{unitOptions(item, units).map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</Select></Field>
          <Field label="Supplier"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Note" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}
      </Modal>
    </div>
  );
}

export default function ItemDetail({ id, onClose, onEdit, onChanged }) {
  const can = useAuth((s) => s.can); const { allDepartments } = useInvScope();
  const st = useGet(id ? `/inventory/items/${id}` : null, null, [id]);
  const [tab, setTab] = useState('stock'); const [confirm, setConfirm] = useState(false); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const toggle = async () => {
    setErr('');
    try { await run(() => (st.data.active ? api.delete(`/inventory/items/${id}`) : api.post(`/inventory/items/${id}/reactivate`))); toast.success(st.data.active ? 'Item deactivated' : 'Item reactivated'); setConfirm(false); st.reload(); onChanged(); }
    catch (e) { setErr(e.message); }
  };
  const d = st.data;
  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-2xl" title={d?.name || 'Item'} subtitle={d ? `${d.sku} · ${d.category?.name || ''}` : ''}
      footer={d && <>{can('inventory.delete') && <Button variant="secondary" onClick={() => { setErr(''); setConfirm(true); }}><Power size={15} />{d.active ? 'Deactivate' : 'Reactivate'}</Button>}{can('inventory.edit') && <Button onClick={() => onEdit(d)}><Pencil size={15} />Edit item</Button>}</>}>
      <Async state={st} isEmpty={() => false}>{(it) => (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">{!it.active && <Badge tone="slate">Inactive</Badge>}{it.isDemo && <Badge tone="amber">Demo item</Badge>}<StockBadges stock={it.stock} />{it.trackExpiry && <Badge tone="blue">Expiry tracked</Badge>}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase text-slate-500">On hand</p><p className="text-lg font-extrabold">{qtyFmt(it.stock.total)} <span className="text-xs font-medium text-slate-500">{it.baseUnit}</span></p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase text-slate-500">Stock value</p><p className="text-lg font-extrabold">{rupee(it.stock.value)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase text-slate-500">Last price</p><p className="text-lg font-extrabold">{it.lastPurchase ? rupee(it.lastPurchase.unitPrice) : '—'}</p>{it.lastPurchase && <p className="text-[10px] text-slate-400">per {it.lastPurchase.unit}</p>}</div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase text-slate-500">Next expiry</p><p className="text-lg font-extrabold">{it.stock.nextExpiry ? dateOnly(it.stock.nextExpiry) : '—'}</p></div>
          </div>
          <Tabs value={tab} onChange={setTab} items={[{ key: 'stock', label: 'Stock' }, { key: 'ledger', label: 'Ledger' }, { key: 'prices', label: 'Price history' }, { key: 'units', label: 'Units' }]} />
          {tab === 'stock' && (
            <div className="space-y-4">
              <Table dense rows={allDepartments.filter((x) => it.stock.byDepartment[x] != null || it.minLevelsByDepartment.some((m) => m.department === x)).map((x) => ({ _id: x, department: x, qty: it.stock.byDepartment[x] || 0, min: it.minLevelsByDepartment.find((m) => m.department === x)?.minLevel }))} empty={<EmptyState title="No stock in any department" />}
                columns={[{ header: 'Department', key: 'department' }, { header: 'On hand', className: 'text-right', render: (r) => `${qtyFmt(r.qty)} ${it.baseUnit}` }, { header: 'Minimum', className: 'text-right', render: (r) => (r.min != null ? qtyFmt(r.min) : '—') }, { header: '', render: (r) => (r.min > 0 && r.qty < r.min ? <Badge tone="red">Low</Badge> : null) }]} />
              {it.lots.length > 0 && <div><p className="mb-1 text-xs font-bold uppercase text-slate-500">Batches</p>
                <Table dense rows={it.lots} columns={[{ header: 'Dept', key: 'department' }, { header: 'Batch', render: (r) => r.lotNo || '—' }, { header: 'Expiry', render: (r) => (r.expiryDate ? <span>{dateOnly(r.expiryDate)} {r.expired ? <Badge tone="red">Expired</Badge> : r.daysLeft != null && r.daysLeft <= 30 ? <Badge tone="amber">{r.daysLeft}d</Badge> : null}</span> : '—') }, { header: 'Qty', className: 'text-right', render: (r) => qtyFmt(r.qty) }, { header: 'Cost/unit', className: 'text-right', render: (r) => rupee(r.unitCost) }]} /></div>}
              {it.openingStock.length > 0 && <p className="text-xs text-slate-500">Opening stock: {it.openingStock.map((o) => `${qtyFmt(o.quantity)} ${it.baseUnit} in ${o.department}`).join('; ')}</p>}
              {it.description && <p className="rounded-lg bg-slate-50 p-3 text-sm">{it.description}</p>}
            </div>
          )}
          {tab === 'ledger' && <Ledger id={id} baseUnit={it.baseUnit} departments={allDepartments} />}
          {tab === 'prices' && (can('inventory.reports') || can('inventory.prices') ? <Prices item={it} /> : <EmptyState title="Price history is restricted" text="Ask a manager with price access." />)}
          {tab === 'units' && (
            <div className="space-y-3 text-sm">
              <p>Stock unit: <b>{it.baseUnit}</b>{it.purchaseUnit && <> · buys in <b>{it.purchaseUnit}</b></>}{it.usageUnit && <> · uses <b>{it.usageUnit}</b></>}</p>
              {it.conversions?.length > 0 ? <ul className="list-disc pl-5">{it.conversions.map((c) => <li key={c.unit}>1 {c.unit} = {qtyFmt(c.factor)} {it.baseUnit}</li>)}</ul> : <p className="text-slate-500">No package conversions. Standard units of the same measure convert automatically.</p>}
              <div><p className="mb-1 text-xs font-bold uppercase text-slate-500">Current stock in each unit</p><div className="flex flex-wrap gap-2">{Object.entries(it.stockInUnits || {}).map(([u, v]) => <Badge key={u}>{qtyFmt(v)} {u}</Badge>)}</div></div>
            </div>
          )}
        </div>
      )}</Async>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={toggle} busy={busy} error={err} danger={d?.active} title={d?.active ? 'Deactivate item?' : 'Reactivate item?'} confirmLabel={d?.active ? 'Deactivate' : 'Reactivate'}
        message={d?.active ? 'The item will no longer be offered for new movements. Its history is kept. Items that still have stock cannot be deactivated.' : 'The item will be available for movements again.'} />
    </Drawer>
  );
}
