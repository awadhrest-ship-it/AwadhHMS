import { useMemo, useState } from 'react';
import { Minus, Plus, ShoppingCart, Wine } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import { ConfirmDialog } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Notice, ORDER_TONE, Mono, rs, idem, useIdemKey } from './shared';

export default function BarOrders() {
  const can = useAuth((s) => s.can); const take = can('bar.orders'); const [tab, setTab] = useState(take ? 'new' : 'list');
  return (
    <div><SubNav can={can} />
      <PageHeader title="Drink orders" subtitle="Take an order, serve it - stock is deducted once, when the drink is served"
        actions={<div className="flex gap-1.5">{take && <Button size="sm" variant={tab === 'new' ? 'primary' : 'secondary'} onClick={() => setTab('new')}>New order</Button>}<Button size="sm" variant={tab === 'list' ? 'primary' : 'secondary'} onClick={() => setTab('list')}>Orders</Button></div>} />
      {tab === 'new' ? <NewOrder onDone={() => setTab('list')} /> : <OrderList take={take} />}
    </div>
  );
}
function NewOrder({ onDone }) {
  const menu = useGet('/bar/menu'); const shG = useGet('/bar/shifts/current'); const sh = { raw: shG.raw, data: shG.raw ? shG.raw.data : null }; const [cart, setCart] = useState([]); const [label, setLabel] = useState(''); const [room, setRoom] = useState(''); const [run, busy] = useAction(); const key = useIdemKey(); const [err, setErr] = useState('');
  const items = (menu.data || []).filter((m) => m.active && m.available);
  const total = useMemo(() => cart.reduce((s, l) => s + l.price * l.quantity, 0), [cart]);
  const add = (m, s) => setCart((c) => { const i = c.findIndex((l) => l.menuItem === m._id && l.serving === s._id); if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l)); return [...c, { menuItem: m._id, serving: s._id, name: m.name, measure: s.measure, price: s.currentPrice, hh: s.happyHourActive, quantity: 1, blocked: m.consumptionStatus === 'Incomplete' }]; });
  const chg = (i, d) => setCart((c) => c.map((l, j) => (j === i ? { ...l, quantity: Math.max(0, l.quantity + d) } : l)).filter((l) => l.quantity > 0));
  const submit = async (serve) => { setErr(''); const body = { lines: cart.map((l) => ({ menuItem: l.menuItem, serving: l.serving, quantity: l.quantity })), customerLabel: label || undefined, roomNumber: room || undefined, serve };
    try { const r = await run(() => api.post('/bar/orders', body, idem(key.get()))); key.renew(); toast.success(`${r.data.data.orderNumber} ${r.data.data.status === 'Served' ? 'served' : 'saved'}`); setCart([]); setLabel(''); setRoom(''); onDone(); } catch (e) { setErr(e.message); } };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div>
        {!sh.data && sh.raw && <Notice tone="blue" title="You have no open shift">Orders are still recorded, but they will not appear in a shift closing report. Start a shift in Bar &gt; Shifts.</Notice>}
        <Async state={menu} empty={<Card><EmptyState icon={Wine} title="No drinks on the menu" text="Ask the bar manager to set up the bar menu." /></Card>}>{() => (
          <div className="grid gap-3 sm:grid-cols-2">{items.map((m) => (
            <Card key={m._id}><p className="font-semibold">{m.name}</p><p className="mb-2 text-xs text-slate-500">{m.category}</p>
              {m.consumptionStatus === 'Incomplete' && <p className="mb-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">Cannot be sold yet: {m.consumptionProblems.join('; ')}</p>}
              <div className="flex flex-wrap gap-2">{m.servings.filter((s) => s.active !== false).map((s) => <button key={s._id} disabled={m.consumptionStatus === 'Incomplete'} onClick={() => add(m, s)} className="min-h-[44px] rounded-xl bg-brand-50 px-3 py-1.5 text-left text-sm font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40">{s.measure}<span className="block text-xs font-normal">{rs(s.currentPrice)}{s.happyHourActive && <span className="ml-1 font-bold text-green-700">happy hour</span>}</span></button>)}</div></Card>))}</div>)}</Async>
      </div>
      <Card title="Order" className="h-fit lg:sticky lg:top-20">
        {!cart.length ? <p className="py-6 text-center text-sm text-slate-500">Tap a serving to add it.</p> : <ul className="divide-y divide-slate-100">{cart.map((l, i) => <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0"><span className="block truncate font-semibold">{l.name}</span><span className="text-xs text-slate-500">{l.measure} · {rs(l.price)}{l.hh && ' · happy hour'}</span></span>
          <span className="flex items-center gap-1"><Button size="sm" variant="secondary" aria-label="Fewer" onClick={() => chg(i, -1)}><Minus size={13} /></Button><b className="w-6 text-center">{l.quantity}</b><Button size="sm" variant="secondary" aria-label="More" onClick={() => chg(i, 1)}><Plus size={13} /></Button></span></li>)}</ul>}
        <div className="mt-3 grid grid-cols-2 gap-2"><Input placeholder="Guest / table (optional)" value={label} onChange={(e) => setLabel(e.target.value)} /><Input placeholder="Room (info only)" value={room} onChange={(e) => setRoom(e.target.value)} /></div>
        <p className="mt-1 text-[11px] text-slate-500">The room number is only a note: bar sales are not posted to a room bill (billing rule not confirmed).</p>
        <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-base font-bold"><span>Total</span><span>{rs(total)}</span></div>
        <p className="text-[11px] text-slate-500">Shown for guidance - the server calculates the final price.</p>
        {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" disabled={!cart.length} loading={busy} onClick={() => submit(false)}>Save order</Button><Button disabled={!cart.length} loading={busy} onClick={() => submit(true)}><ShoppingCart size={15} />Serve now</Button></div>
      </Card>
    </div>
  );
}
function OrderList({ take }) {
  const [status, setStatus] = useState(''); const g = useGet('/bar/orders', { status: status || undefined, limit: 100 }); const [run, busy] = useAction(); const [cancel, setCancel] = useState(null);
  const serve = async (o) => { try { await run(() => api.post(`/bar/orders/${o._id}/serve`)); toast.success(`${o.orderNumber} served`); g.reload(); } catch (e) { toast.error(e.message); g.reload(); } };
  return (<>
    <div className="mb-3 flex gap-2"><Select className="!w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All orders</option><option>Open</option><option>Served</option><option>Cancelled</option></Select></div>
    <Card pad={false}><Async state={g} empty={<EmptyState icon={ShoppingCart} title="No drink orders" text="Orders you create appear here." />}>{(rows) => <Table rows={rows} columns={[
      { header: 'Order', render: (o) => <span><Mono>{o.orderNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(o.createdAt)} · {o.createdByName}</span></span> },
      { header: 'Drinks', render: (o) => <span className="text-sm">{o.lines.map((l) => `${l.quantity} × ${l.name} (${l.measure})${l.happyHour?.applied ? ' ★' : ''}`).join(', ')}{o.stockError && o.status === 'Open' && <span className="block text-xs font-semibold text-red-700">{o.stockError}</span>}</span> },
      { header: 'Total', className: 'text-right', render: (o) => <b>{rs(o.total)}</b> }, { header: 'Billing', render: (o) => <Badge tone="amber" className="whitespace-normal">Pending decision</Badge> },
      { header: 'Status', render: (o) => <Badge tone={ORDER_TONE[o.status]}>{o.status}</Badge> },
      { header: '', render: (o) => take && o.status === 'Open' && <div className="flex gap-1"><Button size="sm" loading={busy} onClick={() => serve(o)}>Serve</Button><Button size="sm" variant="ghost" onClick={() => setCancel(o)}>Cancel</Button></div> }]} />}</Async></Card>
    <p className="mt-2 text-xs text-slate-500">★ = happy-hour price applied. Bar billing (separate bill / room bill / both) is still to be confirmed, so nothing here has been billed or posted to a guest folio.</p>
    <ConfirmDialog open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${cancel?.orderNumber}?`} message="Nothing was deducted from stock for an order that has not been served." reason danger confirmLabel="Cancel order" busy={busy}
      onConfirm={async (reason) => { try { await run(() => api.post(`/bar/orders/${cancel._id}/cancel`, { reason })); setCancel(null); g.reload(); } catch (e) { toast.error(e.message); } }} />
  </>);
}
