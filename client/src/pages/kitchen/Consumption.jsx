import { useState } from 'react';
import { PackageX, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Input, PageHeader, Pills, Table, Tabs } from '../../components/ui';
import { ConfirmDialog, Drawer } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, CONSUMPTION_TONE, rs, pct, todayStr } from './shared';

export default function Consumption() {
  const can = useAuth((s) => s.can); const [tab, setTab] = useState('history'); const [status, setStatus] = useState('all'); const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [page, setPage] = useState(1);
  const list = useGet('/kitchen/consumption', { status: status === 'all' ? undefined : status, q: dq || undefined, page }, [tab]); const [open, setOpen] = useState(null); const [waive, setWaive] = useState(null); const [run, busy] = useAction();
  const counts = list.raw?.counts || {}; const mayResolve = can('kitchen.consumption.resolve');
  const retry = async (r) => { try { const x = await run(() => api.post(`/kitchen/consumption/${r._id}/retry`)); toast[x.data.data.consumption.status === 'Posted' ? 'success' : 'error'](x.data.data.consumption.status === 'Posted' ? 'Posted to stock' : `Still failing: ${x.data.data.consumption.failureReason}`); list.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div><SubNav can={can} />
      <PageHeader title="Ingredient consumption" subtitle="Each finalised restaurant bill consumes its recipe ingredients from Kitchen stock - exactly once" />
      <Tabs items={[{ key: 'history', label: 'History', count: list.raw?.total }, { key: 'cost', label: 'Food cost report' }]} value={tab} onChange={setTab} />
      {tab === 'history' && <div className="mt-4 space-y-3">
        {(counts.Failed > 0 || counts.Pending > 0) && <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200"><PackageX size={16} className="mt-0.5 shrink-0" /><span><b>{(counts.Failed || 0) + (counts.Pending || 0)} consumption{(counts.Failed || 0) + (counts.Pending || 0) > 1 ? 's' : ''} need attention.</b> Failed ones were NOT deducted from stock (usually not enough in the Kitchen department). Transfer stock to the Kitchen, then retry - or waive with a reason.</span></div>}
        <Card pad={false}>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><Input className="sm:w-72" placeholder="Search bill, order or movement no." aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <Pills items={[{ key: 'all', label: 'All' }, ...['Posted', 'Failed', 'Pending', 'No Recipe', 'Waived'].map((s) => ({ key: s, label: `${s}${counts[s] ? ` (${counts[s]})` : ''}` }))]} value={status} onChange={(v) => { setStatus(v); setPage(1); }} /></div>
          <Async state={list} empty={<EmptyState icon={PackageX} title="No consumption records" text="Records appear when restaurant bills are finalised (bills from before Phase 7 are never consumed retroactively)." />}>{(rows) => (<>
            <Table rows={rows} onRow={setOpen} columns={[
              { header: 'Bill', render: (r) => <span className="font-semibold">{r.billNumber}<span className="block text-xs font-normal text-slate-400">{r.orderNumber} · {r.orderType}</span></span> }, { header: 'Date', render: (r) => fmtDateTime(r.createdAt) },
              { header: 'Status', render: (r) => <><Badge tone={CONSUMPTION_TONE[r.status]}>{r.status}</Badge>{r.billStatus === 'Void' && <Badge tone="red" className="ml-1">bill void</Badge>}</> },
              { header: 'Stock movement', render: (r) => r.movementNumber ? <span className="font-mono text-xs">{r.movementNumber}</span> : '-' },
              { header: 'Food cost', className: 'text-right', render: (r) => r.status === 'Posted' ? <span>{rs(r.foodCost)}{!r.costComplete && <span className="ml-1 text-amber-700" title="Some stock had no recorded cost">*</span>}</span> : '-' },
              { header: '', render: (r) => mayResolve && ['Failed', 'Pending'].includes(r.status) && <div className="flex gap-1" onClick={(e) => e.stopPropagation()}><Button size="sm" loading={busy} onClick={() => retry(r)}><RefreshCw size={13} />Retry</Button><Button size="sm" variant="secondary" onClick={() => setWaive(r)}>Waive</Button></div> }]} />
            {list.raw?.pages > 1 && <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {list.raw.pages}</span><Button size="sm" variant="secondary" disabled={page >= list.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div>}</>)}</Async>
        </Card></div>}
      {tab === 'cost' && <FoodCost />}
      <Detail id={open?._id} onClose={() => setOpen(null)} />
      <ConfirmDialog open={!!waive} onClose={() => setWaive(null)} title={`Waive consumption for ${waive?.billNumber}?`} message="No stock will be deducted for this bill. Only do this when the stock was already corrected another way (for example a stocktake). It is recorded in the audit trail." confirmLabel="Waive" danger reason reasonLabel="Reason" busy={busy}
        onConfirm={async (reason) => { try { await run(() => api.post(`/kitchen/consumption/${waive._id}/waive`, { reason })); toast.success('Waived'); setWaive(null); list.reload(); } catch (e) { toast.error(e.message); } }} />
    </div>
  );
}
function Detail({ id, onClose }) {
  const g = useGet(id ? `/kitchen/consumption/${id}` : null, undefined, [id]); const r = g.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={r ? `Consumption - ${r.billNumber}` : 'Consumption'} subtitle={r ? `${r.orderNumber} · ${r.orderType} · ${r.businessDate}` : ''} width="max-w-xl">
      <Async state={g}>{(x) => (<div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={CONSUMPTION_TONE[x.status]}>{x.status}</Badge>{x.movementNumber && <span className="font-mono text-xs">{x.movementNumber}</span>}<span className="text-slate-500">Department: {x.department}</span></div>
        {x.failureReason && <p className="rounded-lg bg-red-50 p-3 font-semibold text-red-800">{x.failureReason}</p>}
        <div><h3 className="mb-1 font-bold">Sold (with the recipe version used at the time)</h3><ul className="divide-y divide-slate-100">{x.lines.map((l, i) => <li key={i} className="py-2"><div className="flex justify-between"><b>{l.quantity} × {l.name}</b><Badge tone={l.state === 'Consumed' ? 'green' : 'slate'}>{l.state}</Badge></div>{l.recipeName && <p className="text-xs text-slate-500">{l.recipeName} v{l.recipeVersion} · {l.portions} portion(s) of {l.yieldQuantity}</p>}<ul className="mt-1 text-xs text-slate-600">{l.ingredients.map((g, k) => <li key={k}>{g.baseQty} {g.baseUnit} {g.itemName}</li>)}</ul></li>)}</ul></div>
        {x.requirements.length > 0 && <div><h3 className="mb-1 font-bold">Taken from stock</h3><Table dense rowKey="itemName" rows={x.requirements} columns={[{ header: 'Item', render: (g) => g.itemName }, { header: 'Quantity', render: (g) => `${g.baseQty} ${g.baseUnit}` }, { header: 'Cost', className: 'text-right', render: (g) => g.cost != null ? rs(g.cost) : <span className="text-amber-700">no cost</span> }]} />{x.status === 'Posted' && <p className="mt-1 text-right font-bold">Food cost {rs(x.foodCost)}{!x.costComplete && ' (incomplete)'}</p>}</div>}
        <div><h3 className="mb-1 font-bold">History</h3><ul className="space-y-1 text-xs text-slate-600">{x.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · <b>{h.action}</b> · {h.byName}{h.note ? ` · ${h.note}` : ''}</li>)}</ul></div></div>)}</Async>
    </Drawer>
  );
}
function FoodCost() {
  const [from, setFrom] = useState(todayStr().slice(0, 8) + '01'); const [to, setTo] = useState(todayStr()); const g = useGet('/kitchen/consumption/food-cost', { from, to });
  return (
    <div className="mt-4 space-y-3"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs font-semibold text-slate-600">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      <Card pad={false}><Async state={g} isEmpty={(d) => !d.data.length} empty={<EmptyState title="No posted consumption in this range" />}>{(d) => (<>
        <Table rows={d.data} rowKey="name" columns={[{ header: 'Menu item', render: (r) => <b>{r.name}</b> }, { header: 'Portions', className: 'text-right', render: (r) => r.portions }, { header: 'Menu value', className: 'text-right', render: (r) => rs(r.menuValue) }, { header: 'Food cost', className: 'text-right', render: (r) => rs(r.foodCost) },
          { header: 'Food cost %', className: 'text-right', render: (r) => r.complete ? pct(r.foodCostPercent) : <Badge tone="amber">incomplete</Badge> }]} />
        <div className="border-t border-slate-100 p-4 text-sm"><b>Total:</b> {d.totals.portions} portions · menu value {rs(d.totals.menuValue)} · food cost {rs(d.totals.foodCost)}{!d.totals.complete && <span className="text-amber-700"> (incomplete)</span>}<p className="mt-1 text-xs text-slate-500">{d.note}</p></div></>)}</Async></Card></div>
  );
}
