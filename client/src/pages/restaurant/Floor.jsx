import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Armchair, CalendarClock, Plus, Users } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Switch, Tabs, Table, Textarea, cx } from '../../components/ui';
import { ConfirmDialog, Drawer, Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { Mono, OrderBadge, SubNav, TABLE_TONE, rs } from './shared';

const TILE = { Available: 'border-green-300 bg-green-50', Occupied: 'border-red-300 bg-red-50', Reserved: 'border-amber-300 bg-amber-50', 'Out of Service': 'border-slate-300 bg-slate-100 opacity-70', Inactive: 'border-slate-200 bg-slate-50 opacity-50' };
const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const RES_TONE = { Booked: 'blue', Seated: 'green', Completed: 'slate', Cancelled: 'red', 'No-show': 'orange' };

export default function Floor() {
  const can = useAuth((s) => s.can); const [tab, setTab] = useState('tables');
  const tables = useGet('/restaurant/tables', { includeInactive: can('restaurant.tables') ? 'true' : undefined });
  return (
    <div><PageHeader title="Tables & reservations" subtitle="Live floor status, table reservations and table transfers" /><SubNav can={can} />
      <Tabs items={[{ key: 'tables', label: 'Floor' }, { key: 'reservations', label: 'Reservations' }]} value={tab} onChange={setTab} />
      <div className="pt-4">{tab === 'tables' ? <TablesView tables={tables} /> : <ReservationsView tables={tables.data || []} onChanged={tables.reload} />}</div></div>);
}

function TablesView({ tables }) {
  const can = useAuth((s) => s.can); const [sel, setSel] = useState(null); const [edit, setEdit] = useState(null); const sections = [...new Set((tables.data || []).map((t) => t.section))];
  const counts = (tables.data || []).filter((t) => t.active).reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
  return (<>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">{['Available', 'Occupied', 'Reserved', 'Out of Service'].map((s) => <Badge key={s} tone={TABLE_TONE[s]}>{s}: {counts[s] || 0}</Badge>)}</div>{can('restaurant.tables') && <Button onClick={() => setEdit({})}><Plus size={16} />Add table</Button>}</div>
    <Async state={tables} empty={<Card><EmptyState icon={Armchair} title="No tables yet" text="Add your restaurant tables to start taking dine-in orders." /></Card>}>{(rows) => sections.map((sec) => (
      <div key={sec} className="mb-5"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{sec}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{rows.filter((t) => t.section === sec).map((t) => (
          <button key={t._id} onClick={() => setSel(t._id)} className={cx('rounded-xl border-2 p-3 text-left transition hover:shadow-md', TILE[t.status])} aria-label={`Table ${t.number}, ${t.status}`}>
            <div className="flex items-start justify-between"><span className="text-lg font-extrabold">{t.number}</span><span className="flex items-center gap-1 text-xs text-slate-500"><Users size={12} />{t.capacity}</span></div>
            <Badge tone={TABLE_TONE[t.status]} className="mt-1">{t.status}</Badge>
            <p className="mt-1.5 min-h-[2rem] text-[11px] leading-tight text-slate-600">{t.order ? `${t.order.orderNumber} · ${t.order.itemCount} items` : t.seatedReservation ? `Seated: ${t.seatedReservation.guestName}` : t.nextReservation ? `Next: ${t.nextReservation.guestName} ${new Date(t.nextReservation.startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : t.outOfServiceReason || ''}</p></button>))}</div></div>))}</Async>
    <TableDrawer id={sel} onClose={() => setSel(null)} onEdit={(t) => { setSel(null); setEdit(t); }} onChanged={tables.reload} />
    <TableForm table={edit} onClose={() => setEdit(null)} onDone={tables.reload} />
  </>);
}

function TableDrawer({ id, onClose, onEdit, onChanged }) {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const t = useGet(id ? `/restaurant/tables/${id}` : null); const d = t.data;
  return <Drawer open={!!id} onClose={onClose} title={d ? `Table ${d.number}` : 'Table'} subtitle={d && `${d.section} · seats ${d.capacity}`}><Async state={t}>{() => d && (
    <div className="space-y-4"><Badge tone={TABLE_TONE[d.status]}>{d.status}</Badge>{d.outOfServiceReason && <p className="text-sm text-slate-500">{d.outOfServiceReason}</p>}
      {d.order && <div className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex items-center gap-2"><Mono>{d.order.orderNumber}</Mono><OrderBadge status={d.order.status} /></div><p className="mt-1 text-slate-500">{d.order.itemCount} items · {rs(d.order.subtotal)} (menu prices){d.order.covers ? ` · ${d.order.covers} guests` : ''}</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => nav('/restaurant/orders')}>Open in Orders</Button></div>}
      {d.status === 'Available' && can('restaurant.orders') && <Button onClick={() => nav(`/restaurant/pos?table=${d._id}`)}>Start order</Button>}
      {d.seatedReservation && can('restaurant.orders') && !d.order && <Button onClick={() => nav(`/restaurant/pos?table=${d._id}&reservation=${d.seatedReservation._id}`)}>Start order for {d.seatedReservation.guestName}</Button>}
      <div><h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Upcoming reservations</h4>{d.upcomingReservations.length ? <ul className="divide-y divide-slate-100 text-sm">{d.upcomingReservations.map((r) => <li key={r._id} className="flex justify-between py-1.5"><span>{r.guestName} · {r.partySize}</span><span className="text-slate-500">{fmtDateTime(r.startsAt)}</span></li>)}</ul> : <p className="text-sm text-slate-400">None.</p>}</div>
      {can('restaurant.tables') && <Button variant="secondary" onClick={() => onEdit(d)}>Edit table</Button>}</div>)}</Async></Drawer>;
}

function TableForm({ table, onClose, onDone }) {
  const [f, setF] = useState({}); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [seen, setSeen] = useState(null);
  if (table && seen !== table) { setSeen(table); setF({ number: table.number || '', section: table.section || 'Main hall', capacity: table.capacity || 2, notes: table.notes || '', active: table.active !== false, outOfService: !!table.outOfService, outOfServiceReason: table.outOfServiceReason || '' }); setErr(''); }
  const isNew = table && !table._id; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => { setErr(''); try { const body = { number: f.number, section: f.section, capacity: Number(f.capacity), notes: f.notes }; if (isNew) await run(() => api.post('/restaurant/tables', body)); else await run(() => api.put(`/restaurant/tables/${table._id}`, { ...body, active: f.active, outOfService: f.outOfService, outOfServiceReason: f.outOfService ? f.outOfServiceReason : undefined })); toast.success('Table saved'); onClose(); onDone(); setSeen(null); } catch (e) { setErr(e.message); } };
  return <Modal open={!!table} onClose={() => { onClose(); setSeen(null); }} title={isNew ? 'Add table' : `Edit table ${table?.number}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.number || !f.capacity} onClick={go}>Save</Button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Table number" required><Input value={f.number || ''} onChange={set('number')} maxLength={12} /></Field><Field label="Seats" required><Input type="number" min="1" max="50" value={f.capacity || ''} onChange={set('capacity')} /></Field><Field label="Section" className="col-span-2"><Input value={f.section || ''} onChange={set('section')} list="sections" /></Field></div>
    {!isNew && <div className="mt-4 space-y-3"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active (shown on the floor)" /><Switch checked={f.outOfService} onChange={(v) => setF({ ...f, outOfService: v })} label="Out of service" />{f.outOfService && <Field label="Reason"><Input value={f.outOfServiceReason} onChange={set('outOfServiceReason')} /></Field>}<p className="text-xs text-slate-400">Occupied / reserved is worked out from real orders and reservations - it cannot be set by hand.</p></div>}
    {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}

function ReservationsView({ tables, onChanged }) {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today); const [status, setStatus] = useState('Booked,Seated'); const [q, setQ] = useState(''); const [edit, setEdit] = useState(null); const [cancel, setCancel] = useState(null); const [run, busy] = useAction();
  const list = useGet('/restaurant/reservations', { from, status: status || undefined, q: q || undefined });
  const act = async (fn, msg) => { try { await run(fn); toast.success(msg); list.reload(); onChanged(); } catch (e) { toast.error(e.message); } };
  const manage = can('restaurant.reservations');
  return (<Card pad={false}>
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap items-center gap-2"><Input type="date" className="!w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><Select className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="Booked,Seated">Upcoming & seated</option><option value="">All</option>{['Booked', 'Seated', 'Completed', 'Cancelled', 'No-show'].map((s) => <option key={s}>{s}</option>)}</Select><Input className="!w-48" placeholder="Name, phone, number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>{manage && <Button onClick={() => setEdit({})}><Plus size={16} />New reservation</Button>}</div>
    <Async state={list} empty={<EmptyState icon={CalendarClock} title="No reservations" text="Nothing matches these filters." />}>{(rows) => (
      <Table columns={[{ header: 'Time', render: (r) => <div><b>{fmtDateTime(r.startsAt)}</b><div className="text-[11px] text-slate-400">{r.durationMinutes} min</div></div> }, { header: 'Guest', render: (r) => <div>{r.guestName}<div className="text-[11px] text-slate-400">{r.phone}</div></div> }, { header: 'Party', render: (r) => r.partySize }, { header: 'Table', render: (r) => r.tableNumber },
        { header: 'Ref', render: (r) => <Mono>{r.reservationNumber}</Mono> }, { header: 'Status', render: (r) => <Badge tone={RES_TONE[r.status]}>{r.status}</Badge> },
        { header: '', render: (r) => manage && <div className="flex flex-wrap justify-end gap-1.5">
          {r.status === 'Booked' && <Button size="sm" variant="secondary" loading={busy} onClick={() => act(() => api.post(`/restaurant/reservations/${r._id}/seat`), 'Party seated')}>Seat</Button>}
          {['Booked', 'Seated'].includes(r.status) && can('restaurant.orders') && <Button size="sm" onClick={() => nav(`/restaurant/pos?table=${r.table?._id || r.table}&reservation=${r._id}`)}>Start order</Button>}
          {r.status === 'Booked' && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>}
          {r.status === 'Booked' && <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/restaurant/reservations/${r._id}/no-show`), 'Marked as no-show')}>No-show</Button>}
          {r.status === 'Seated' && <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/restaurant/reservations/${r._id}/complete`), 'Reservation completed')}>Complete</Button>}
          {r.status === 'Booked' && <Button size="sm" variant="ghost" className="!text-red-600" onClick={() => setCancel(r)}>Cancel</Button>}</div> }]} rows={rows} />)}</Async>
    <ReservationForm item={edit} tables={tables} onClose={() => setEdit(null)} onDone={() => { list.reload(); onChanged(); }} />
    <ConfirmDialog open={!!cancel} onClose={() => setCancel(null)} danger reason reasonLabel="Reason for cancelling" title={`Cancel reservation ${cancel?.reservationNumber}?`} confirmLabel="Cancel reservation" busy={busy} onConfirm={(reason) => act(() => api.post(`/restaurant/reservations/${cancel._id}/cancel`, { reason }), 'Reservation cancelled').then(() => setCancel(null))} />
  </Card>);
}

function ReservationForm({ item, tables, onClose, onDone }) {
  const [f, setF] = useState({}); const [seen, setSeen] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  if (item && seen !== item) { setSeen(item); setErr(''); setF({ guestName: item.guestName || '', phone: item.phone || '', partySize: item.partySize || 2, table: item.table?._id || item.table || '', startsAt: toLocalInput(item.startsAt || Date.now() + 3600e3), durationMinutes: item.durationMinutes || 90, notes: item.notes || '' }); }
  const t = tables.find((x) => x._id === f.table); const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => { setErr(''); try { const body = { guestName: f.guestName, phone: f.phone || undefined, partySize: Number(f.partySize), table: f.table, startsAt: new Date(f.startsAt).toISOString(), durationMinutes: Number(f.durationMinutes), notes: f.notes || undefined }; if (item._id) await run(() => api.put(`/restaurant/reservations/${item._id}`, body)); else await run(() => api.post('/restaurant/reservations', body)); toast.success('Reservation saved'); onClose(); setSeen(null); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal open={!!item} onClose={() => { onClose(); setSeen(null); }} title={item?._id ? `Edit ${item.reservationNumber}` : 'New table reservation'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.guestName || !f.table} onClick={go}>Save reservation</Button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Guest name" required className="col-span-2"><Input value={f.guestName || ''} onChange={set('guestName')} /></Field><Field label="Phone"><Input inputMode="tel" value={f.phone || ''} onChange={set('phone')} /></Field><Field label="Party size" required hint={t ? `Table ${t.number} seats ${t.capacity}` : undefined} error={t && Number(f.partySize) > t.capacity ? `More than the ${t.capacity} seats` : undefined}><Input type="number" min="1" value={f.partySize || ''} onChange={set('partySize')} /></Field>
      <Field label="Table" required><Select value={f.table || ''} onChange={set('table')}><option value="">Select…</option>{tables.filter((x) => x.active && !x.outOfService).map((x) => <option key={x._id} value={x._id}>{x.number} · seats {x.capacity}</option>)}</Select></Field><Field label="Date & time" required><Input type="datetime-local" value={f.startsAt || ''} onChange={set('startsAt')} /></Field><Field label="Duration (min)"><Input type="number" min="15" step="15" value={f.durationMinutes || ''} onChange={set('durationMinutes')} /></Field><Field label="Notes" className="col-span-2"><Textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field></div>
    {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
