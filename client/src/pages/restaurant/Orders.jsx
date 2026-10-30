import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChefHat, ClipboardList, Plus, Search } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, Select, Table } from '../../components/ui';
import { ConfirmDialog, Drawer, Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { OrderBadge, SETTLE_TONE, SubNav, TICKET_TONE, TypeBadge, Mono, rs, usePoll } from './shared';

const FILTERS = [{ key: 'active', label: 'Active' }, { key: 'Completed', label: 'Completed' }, { key: 'Cancelled', label: 'Cancelled' }, { key: 'all', label: 'All' }];

export default function Orders() {
  const can = useAuth((s) => s.can); const nav = useNavigate();
  const [f, setF] = useState('active'); const [type, setType] = useState(''); const [q, setQ] = useState(''); const [date, setDate] = useState(''); const [open, setOpen] = useState(null); const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const params = { ...(f === 'active' ? { active: 'true' } : f === 'all' ? {} : { status: f }), ...(type ? { type } : {}), ...(dq ? { q: dq } : {}), ...(date ? { date } : {}), page, limit: 30 };
  const list = useGet('/restaurant/orders', params);
  usePoll(useCallback(() => list.reload(), [list.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = list.raw?.data || [];
  const place = (r) => (r.type === 'Dine-in' ? `Table ${r.tableNumber}` : r.type === 'Room Service' ? `Room ${r.stay?.roomNumber} · ${r.stay?.guestName}` : r.customer?.name || '—');
  return (
    <div>
      <PageHeader title="Orders & kitchen tickets" subtitle="Every order, its kitchen status and billing status" actions={can('restaurant.orders') && <Button onClick={() => nav('/restaurant/pos')}><Plus size={16} />New order</Button>} />
      <SubNav can={can} />
      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <Pills items={FILTERS} value={f} onChange={(v) => { setF(v); setPage(1); }} />
          <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
            <div className="relative min-w-[12rem] flex-1 lg:max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="pl-9" placeholder="Order, table, room, guest…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search orders" /></div>
            <Select className="!w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Order type"><option value="">All types</option>{['Dine-in', 'Takeaway', 'Delivery', 'Room Service'].map((t) => <option key={t}>{t}</option>)}</Select>
            <Input type="date" className="!w-auto" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} aria-label="Business date" />
          </div>
        </div>
        <Async state={{ ...list, data: list.data ? rows : null }} empty={<EmptyState icon={ClipboardList} title="No orders found" text="Try another filter, or take a new order from the POS." />}>{() => (
          <Table onRow={(r) => setOpen(r._id)} columns={[
            { header: 'Order', render: (r) => <div><Mono>{r.orderNumber}</Mono><div className="text-[11px] text-slate-400">{fmtDateTime(r.createdAt)}</div></div> },
            { header: 'Type', render: (r) => <TypeBadge type={r.type} /> }, { header: 'For', render: (r) => <span className="text-sm">{place(r)}</span> },
            { header: 'Items', className: 'text-right', render: (r) => r.itemCount }, { header: 'Subtotal', className: 'text-right', render: (r) => rs(r.subtotal) },
            { header: 'Status', render: (r) => <OrderBadge status={r.status} /> },
            { header: 'Kitchen', render: (r) => <div className="flex flex-wrap gap-1">{r.tickets.map((t) => <Badge key={t._id} tone={TICKET_TONE[t.status]}>{t.ticketNumber.replace('KOT-', 'K')}: {t.status}</Badge>)}{!r.tickets.length && <span className="text-xs text-slate-400">—</span>}</div> },
            { header: 'Billing', render: (r) => <Badge tone={SETTLE_TONE[r.billingStatus] || 'slate'}>{r.billingStatus}</Badge> },
          ]} rows={rows} />)}</Async>
        {list.raw?.pages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">Page {page} of {list.raw.pages} · {list.raw.total} orders</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= list.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
      </Card>
      <OrderDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />
    </div>
  );
}

function OrderDrawer({ id, onClose, onChanged }) {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const o = useGet(id ? `/restaurant/orders/${id}` : null); const [run, busy] = useAction();
  const [cancel, setCancel] = useState(false); const [transfer, setTransfer] = useState(false); const [split, setSplit] = useState(false); const [voidItem, setVoidItem] = useState(null); const [err, setErr] = useState('');
  const d = o.data; const done = async (fn, msg) => { setErr(''); try { await run(fn); if (msg) toast.success(msg); o.reload(); onChanged(); } catch (e) { setErr(e.message); } };
  const active = d && ['Draft', 'Confirmed', 'Preparing', 'Ready', 'Served'].includes(d.status);
  const finalBill = d?.bills.some((b) => b.status === 'Final');
  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-xl" title={d ? `${d.orderNumber}` : 'Order'} subtitle={d && `${d.type} · opened ${fmtDateTime(d.createdAt)} by ${d.createdByName}`}>
      <Async state={o}>{() => d && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><OrderBadge status={d.status} /><TypeBadge type={d.type} /><Badge tone={SETTLE_TONE[d.billingStatus] || 'slate'}>{d.billingStatus}</Badge>{d.tableNumber && <Badge tone="blue">Table {d.tableNumber}</Badge>}{d.stay && <Badge tone="teal">Room {d.stay.roomNumber} · {d.stay.guestName}</Badge>}</div>
          {d.delivery?.address && <p className="rounded-lg bg-orange-50 p-3 text-sm">{d.delivery.contactName} · {d.delivery.phone}<br />{d.delivery.address}{d.delivery.landmark ? ` (${d.delivery.landmark})` : ''}{d.delivery.instructions && <><br /><i>{d.delivery.instructions}</i></>}</p>}
          {d.customer?.name && d.type === 'Takeaway' && <p className="text-sm text-slate-600">Customer: {d.customer.name} {d.customer.phone}</p>}
          {d.notes && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>Order note:</b> {d.notes}</p>}
          {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{err}</p>}
          <section><h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Items</h4>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{d.items.map((i) => (
              <li key={i._id} className={`flex items-start justify-between gap-3 px-3 py-2.5 text-sm ${i.status === 'Cancelled' ? 'bg-red-50/50 text-slate-400 line-through' : ''}`}>
                <div><b>{i.quantity}×</b> {i.name}{i.notes && <div className="text-xs italic text-slate-500 no-underline">{i.notes}</div>}
                  <div className="text-[11px] no-underline">{i.status === 'Cancelled' ? <span className="text-red-600">Cancelled: {i.cancelReason}</span> : i.round ? <span className="text-slate-400">Round {i.round}</span> : <Badge tone="amber">Not sent</Badge>}</div></div>
                <div className="text-right"><div>{rs(i.unitPrice * i.quantity)}</div>{active && i.status === 'Active' && !finalBill && (i.round == null ? can('restaurant.orders') : can('restaurant.void')) && <button className="text-[11px] font-semibold text-red-600 hover:underline" onClick={() => (i.round == null ? done(() => api.delete(`/restaurant/orders/${d._id}/items/${i._id}`), 'Item removed') : setVoidItem(i))}>Remove</button>}</div></li>))}
              <li className="flex justify-between bg-slate-50 px-3 py-2 text-sm font-bold"><span>Subtotal (menu prices)</span><span>{rs(d.subtotal)}</span></li></ul></section>
          {d.tickets.length > 0 && <section><h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Kitchen tickets</h4><ul className="space-y-2">{d.tickets.map((t) => (
            <li key={t._id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><ChefHat size={15} /><Mono>{t.ticketNumber}</Mono><Badge tone={TICKET_TONE[t.status]}>{t.status}</Badge></span>
              <span className="flex gap-1.5">{t.status === 'Queued' && can('restaurant.kitchen') && <Button size="sm" variant="secondary" onClick={() => done(() => api.post(`/restaurant/tickets/${t._id}/status`, { status: 'Preparing' }))}>Start preparing</Button>}
                {t.status === 'Preparing' && can('restaurant.kitchen') && <Button size="sm" onClick={() => done(() => api.post(`/restaurant/tickets/${t._id}/status`, { status: 'Ready' }))}>Mark ready</Button>}</span></div>
              <p className="mt-1 text-xs text-slate-500">{t.items.filter((x) => !x.cancelled).map((x) => `${x.quantity}× ${x.name}`).join(', ')} · queued {fmtDateTime(t.queuedAt)}</p></li>))}</ul></section>}
          {d.bills.length > 0 && <section><h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Bills</h4><ul className="space-y-1.5">{d.bills.map((b) => <li key={b._id}><Link to={`/restaurant/bills/${b._id}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><span><Mono>{b.billNumber}</Mono> {b.label !== 'Bill' && <span className="text-slate-500">· {b.label}</span>}</span><span className="flex items-center gap-2"><Badge tone={SETTLE_TONE[b.settlement]}>{b.status === 'Draft' ? 'Draft' : b.settlement}</Badge><b>{rs(b.total)}</b></span></Link></li>)}</ul></section>}
          {d.tableHistory?.length > 0 && <p className="text-xs text-slate-400">Table moves: {d.tableHistory.map((h) => `${h.from} → ${h.to}`).join(', ')}</p>}
          {d.cancelReason && <p className="rounded bg-red-50 p-3 text-sm text-red-800"><b>Cancelled:</b> {d.cancelReason}</p>}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {active && can('restaurant.orders') && d.status !== 'Served' && !finalBill && <Button variant="secondary" onClick={() => nav(`/restaurant/pos?order=${d._id}`)}>Add items</Button>}
            {active && can('restaurant.orders') && d.unsentItems > 0 && <Button onClick={() => done(() => api.post(`/restaurant/orders/${d._id}/send`), 'Sent to the kitchen')} loading={busy}>Send to kitchen</Button>}
            {active && can('restaurant.orders') && d.status === 'Ready' && <Button onClick={() => done(() => api.post(`/restaurant/orders/${d._id}/serve`), 'Marked as served')} loading={busy}>Mark served</Button>}
            {active && can('restaurant.orders') && d.type === 'Dine-in' && <Button variant="secondary" onClick={() => setTransfer(true)}>Transfer table</Button>}
            {['Confirmed', 'Preparing', 'Ready', 'Served'].includes(d.status) && can('restaurant.billing') && d.unsentItems === 0 && !d.bills.length && <><Button onClick={() => done(async () => { const r = await api.post(`/restaurant/orders/${d._id}/bills`, {}); nav(`/restaurant/bills/${r.data.data[0]._id}`); })} loading={busy}>Create bill</Button><Button variant="secondary" onClick={() => setSplit(true)}>Split bill…</Button></>}
            {d.bills.some((b) => b.status === 'Draft') && can('restaurant.billing') && !finalBill && <Button variant="secondary" onClick={() => setSplit(true)}>Re-split bill…</Button>}
            {['Draft', 'Confirmed', 'Preparing', 'Ready'].includes(d.status) && (d.status === 'Draft' ? can('restaurant.orders') : can('restaurant.void')) && <Button variant="danger" onClick={() => setCancel(true)}>Cancel order</Button>}
          </div>
        </div>)}</Async>
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} danger reason reasonLabel="Why is this order cancelled?" title="Cancel this order?" message="The order is kept on record as cancelled; its kitchen tickets are cancelled and the table is freed." confirmLabel="Cancel order" busy={busy}
        onConfirm={(reason) => done(() => api.post(`/restaurant/orders/${d._id}/cancel`, { reason }), 'Order cancelled').then(() => setCancel(false))} />
      <ConfirmDialog open={!!voidItem} onClose={() => setVoidItem(null)} danger reason title={`Cancel ${voidItem?.name}?`} message="This item was already sent to the kitchen. It stays on the order as cancelled and the kitchen ticket is updated." confirmLabel="Cancel item" busy={busy}
        onConfirm={(reason) => done(() => api.delete(`/restaurant/orders/${d._id}/items/${voidItem._id}`, { data: { reason } }), 'Item cancelled').then(() => setVoidItem(null))} />
      {d && <TransferModal open={transfer} onClose={() => setTransfer(false)} order={d} onDone={() => { o.reload(); onChanged(); }} />}
      {d && <SplitModal open={split} onClose={() => setSplit(false)} order={d} />}
    </Drawer>
  );
}

function TransferModal({ open, onClose, order, onDone }) {
  const tables = useGet(open ? '/restaurant/tables' : null); const [to, setTo] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const go = async () => { setErr(''); try { await run(() => api.post(`/restaurant/orders/${order._id}/transfer`, { table: to })); toast.success('Order moved to the new table'); onClose(); onDone(); } catch (e) { setErr(e.message); } };
  const free = (tables.data || []).filter((t) => t.status === 'Available');
  return <Modal open={open} onClose={onClose} title={`Transfer ${order.orderNumber}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!to} loading={busy} onClick={go}>Move order</Button></>}>
    <p className="mb-3 text-sm text-slate-600">Moves the whole order (items, kitchen tickets and bill) from table {order.tableNumber} to a free table.</p>
    <Field label="New table" required><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select a free table…</option>{free.map((t) => <option key={t._id} value={t._id}>{t.number} · seats {t.capacity} · {t.section}</option>)}</Select></Field>{!free.length && <p className="mt-2 text-xs text-amber-700">No free table right now.</p>}
    {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}

/** Assign each ordered quantity to a bill. The server re-validates that every unit is assigned exactly once. */
function SplitModal({ open, onClose, order }) {
  const nav = useNavigate(); const [n, setN] = useState(2); const [qty, setQty] = useState({}); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const items = order.items.filter((i) => i.status === 'Active');
  const get = (iid, p) => qty[`${iid}:${p}`] ?? 0; const set = (iid, p, v) => setQty({ ...qty, [`${iid}:${p}`]: Math.max(0, Math.min(Number(v) || 0, 500)) });
  const left = (i) => i.quantity - Array.from({ length: n }).reduce((s, _, p) => s + get(i._id, p), 0);
  const ok = items.every((i) => left(i) === 0);
  const go = async () => { setErr(''); try {
    const splits = Array.from({ length: n }, (_, p) => ({ label: `Guest ${p + 1}`, lines: items.filter((i) => get(i._id, p) > 0).map((i) => ({ orderItem: i._id, quantity: get(i._id, p) })) })).filter((s) => s.lines.length);
    const r = await run(() => api.post(`/restaurant/orders/${order._id}/bills`, { splits: splits.length > 1 ? splits : undefined })); toast.success(`${r.data.data.length} bill(s) created`); onClose(); nav(`/restaurant/bills/${r.data.data[0]._id}`);
  } catch (e) { setErr(e.message); } };
  return <Modal open={open} onClose={onClose} size="lg" title="Split bill" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={busy} onClick={go}>Create {n} bills</Button></>}>
    <div className="mb-3 flex items-center gap-3"><Field label="Number of bills"><Select value={n} onChange={(e) => { setN(Number(e.target.value)); setQty({}); }} className="!w-24">{[2, 3, 4, 5, 6].map((x) => <option key={x}>{x}</option>)}</Select></Field><p className="text-xs text-slate-500">Assign every ordered quantity to a bill. Tax is shared so the bills add up exactly to the whole bill.</p></div>
    <div className="scroll-thin overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th className="th">Item</th><th className="th text-right">Ordered</th>{Array.from({ length: n }, (_, p) => <th key={p} className="th text-center">Guest {p + 1}</th>)}<th className="th text-right">Left</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{items.map((i) => <tr key={i._id}><td className="td">{i.name}</td><td className="td text-right">{i.quantity}</td>{Array.from({ length: n }, (_, p) => <td key={p} className="td"><Input type="number" min="0" max={i.quantity} className="!w-16 text-center" value={get(i._id, p)} onChange={(e) => set(i._id, p, e.target.value)} aria-label={`${i.name} for guest ${p + 1}`} /></td>)}<td className={`td text-right font-bold ${left(i) === 0 ? 'text-green-600' : 'text-red-600'}`}>{left(i)}</td></tr>)}</tbody></table></div>
    {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
