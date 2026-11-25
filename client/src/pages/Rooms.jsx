import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Search, Pencil, Lock, Unlock, Wrench, RotateCcw, ChevronLeft, ChevronRight, Trash2, ClipboardCheck } from 'lucide-react';
import { useGet, useAction, useDebounced } from '../hooks/useApi';
import api from '../services/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, RoomStatusBadge, Select, Switch, Table, Tabs, TBC, Textarea, cx } from '../components/ui';
import { ConfirmDialog, Drawer, Modal } from '../components/feedback';
import { ROOM_STATUS, ROOM_STATUS_LIST, RATE_PLAN_TYPES } from '../utils/constants';
import { addDaysISO, dayNum, fmtDay, fmtShort, fullName, money, todayISO, stayRange } from '../utils/format';

/* ---------------- Room tile (grid) ---------------- */
function Tile({ room, onClick }) {
  const s = ROOM_STATUS[room.status] || ROOM_STATUS.Available;
  return (
    <button onClick={onClick} className={cx('flex w-full flex-col rounded-lg border-l-4 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md', s.tile)} aria-label={`Room ${room.roomNumber}, ${room.category?.name}, ${room.status}`}>
      <span className="text-lg font-extrabold leading-none">{room.roomNumber}</span>
      <span className="mt-1 text-xs opacity-80">{room.category?.name}</span>
      <span className="mt-1 text-[11px] font-bold">{s.short}</span>
    </button>
  );
}

const CLEANING_CYCLE = ['Vacant & Dirty', 'Cleaning in Progress', 'Inspection Pending', 'Maintenance Required', 'Vacant & Clean']; // keep in sync with server/services/checklist.js
const LOCKED_NOTE = { Available: 'Room is cleaned and ready. The checklist is locked and resets automatically after the next check-out.', Reserved: 'Room is cleaned and reserved. The checklist is locked and resets automatically after check-out.', Occupied: 'A guest is in the room. The checklist opens again after check-out, when the room becomes Vacant & Dirty.', Blocked: 'Checklist is locked while the room is blocked.', 'Out of Order': 'Checklist is locked while the room is out of order.' };

/* ---------------- Housekeeping checklist (everyone with rooms.view sees it; rooms.status can tick / add) ---------------- */
function Checklist({ room, onChanged }) {
  const can = useAuth((s) => s.can); const open = CLEANING_CYCLE.includes(room.status); const managed = !!room.housekeepingTask; const editable = can('rooms.status') && open && !managed; // locked once the room is ready (Available / Reserved / Occupied) or on hold
  const [items, setItems] = useState(room.checklist || []); const [label, setLabel] = useState(''); const [run, busy] = useAction();
  useEffect(() => { setItems(room.checklist || []); }, [room.checklist]);
  const done = items.filter((i) => i.done).length; const all = items.length > 0 && done === items.length;
  const call = async (fn, okMsg) => { try { const r = await run(fn); setItems(r.data.data); onChanged(); if (okMsg) toast.success(okMsg); return true; } catch (e) { toast.error(e.message); return false; } };
  const toggle = (it) => call(() => api.patch(`/rooms/${room._id}/checklist/${it._id}`, { done: !it.done }));
  const add = async () => { const l = label.trim(); if (!l) return; if (await call(() => api.post(`/rooms/${room._id}/checklist`, { label: l }), 'Item added')) setLabel(''); };
  const remove = (it) => call(() => api.delete(`/rooms/${room._id}/checklist/${it._id}`), 'Item removed');
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-2 flex items-center justify-between"><p className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><ClipboardCheck size={14} />Housekeeping checklist</p><span className={cx('flex items-center gap-1 text-xs font-bold', all ? 'text-green-600' : 'text-slate-500')}>{!open && <Lock size={11} />}{done}/{items.length} done</span></div>
      <ul className={cx('space-y-1.5', !open && 'opacity-70')}>{items.map((it) => (
        <li key={it._id || it.label} className="flex items-start gap-2 text-sm">
          <label className={cx('flex flex-1 items-start gap-2', editable ? 'cursor-pointer' : 'cursor-default')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" checked={!!it.done} disabled={!editable || busy || !it._id} onChange={() => toggle(it)} />
            <span className={cx(it.done && 'text-slate-400 line-through')}>{it.label}{it.custom && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 no-underline">Custom</span>}
              {it.done && it.doneByName && <span className="block text-[11px] text-slate-400 no-underline">{it.doneByName}{it.doneAt ? ` · ${new Date(it.doneAt).toLocaleString('en-IN')}` : ''}</span>}</span>
          </label>
          {editable && it.custom && it._id && <button type="button" onClick={() => remove(it)} disabled={busy} className="text-slate-400 hover:text-red-600" aria-label={`Remove ${it.label}`}><Trash2 size={14} /></button>}
        </li>))}</ul>
      {editable && <div className="mt-3 flex gap-2"><Input value={label} maxLength={100} placeholder="Add a custom item (optional)" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button size="sm" variant="secondary" onClick={add} disabled={!label.trim()} loading={busy}><Plus size={14} />Add</Button></div>}
      {managed && <p className="mt-2 rounded-lg bg-violet-50 p-2 text-[11px] text-violet-800">This checklist is managed by housekeeping task <Link className="font-bold underline" to={`/housekeeping/tasks/${room.housekeepingTask._id}`}>{room.housekeepingTask.taskNumber}</Link>. Tick items there.</p>}
      <p className="mt-2 text-[11px] text-slate-400">{!open ? (LOCKED_NOTE[room.status] || 'Checklist is locked.') : all ? 'All items done. The room can be marked Available.' : 'Every item must be ticked before a room is marked Available.'}</p>
    </div>
  );
}

/* ---------------- Room detail drawer ---------------- */
function RoomDrawer({ id, onClose, onChanged, cats }) {
  const can = useAuth((s) => s.can);
  const st = useGet(id ? `/rooms/${id}` : null, null, [id]);
  const [dlg, setDlg] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [edit, setEdit] = useState(false); const navigate = useNavigate();
  const room = st.data;
  const doStatus = async (status, reason) => { setErr(''); try { const resp = await run(() => api.patch(`/rooms/${id}/status`, { status, reason })); toast.success(resp?.data?.message || `Room ${room.roomNumber} updated`); setDlg(null); st.reload(); onChanged(); } catch (e) { setErr(e.message); if (!dlg) toast.error(e.message); } };
  const holdKinds = { block: ['Blocked', 'Block room', 'Blocked rooms cannot be booked until released.'], ooo: ['Out of Order', 'Mark out of order', 'Out-of-order rooms cannot be booked until restored.'] };
  return (
    <>
      <Drawer open={!!id} onClose={onClose} title={room ? `Room ${room.roomNumber}` : 'Room'} subtitle={room && `${room.category?.name} · Floor ${room.floor}`} width="max-w-lg">
        <Async state={st} isEmpty={() => false}>{(r) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><RoomStatusBadge status={r.status} />{r.statusReason && <span className="text-xs text-slate-500">Reason: {r.statusReason}</span>}</div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="label">Capacity</dt><dd className="font-semibold">{r.capacity} guests</dd></div>
              <div><dt className="label">Extra-bed charge</dt><dd className="font-semibold">{money(r.extraBedCharge)}</dd></div>
              <div><dt className="label">Base rate</dt><dd className="font-semibold">{money(r.category?.basePrice)} / night</dd></div>
              <div><dt className="label">Floor</dt><dd className="font-semibold">{r.floor}</dd></div>
            </dl>
            <div><p className="label">Amenities</p><div className="flex flex-wrap gap-1.5">{r.amenities?.length ? r.amenities.map((a) => <Badge key={a}>{a}</Badge>) : <span className="text-sm text-slate-400">None listed</span>}</div></div>
            <div><p className="label">Photos</p>{r.photos?.length ? <div className="flex gap-2 overflow-x-auto">{r.photos.map((p) => <img key={p} src={p} alt="" className="h-20 w-28 rounded-lg object-cover" />)}</div> : <p className="text-sm text-slate-400">No photos added yet. Add image links when editing the room.</p>}</div>
            <div><p className="label">Current booking</p>{r.currentReservation ? <button onClick={() => navigate(`/reservations/${r.currentReservation._id}`)} className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-left text-sm"><b>{fullName(r.currentReservation.guest)}</b><br /><span className="text-slate-600">{r.currentReservation.reservationNumber} · {stayRange(r.currentReservation.checkIn, r.currentReservation.checkOut)}</span></button> : <p className="text-sm text-slate-400">No guest in the room.</p>}</div>
            {r.upcoming?.length > 0 && <div><p className="label">Upcoming</p><ul className="space-y-1 text-sm">{r.upcoming.map((u) => <li key={u._id} className="flex justify-between"><span>{fullName(u.guest)}</span><span className="text-slate-500">{stayRange(u.checkIn, u.checkOut)}</span></li>)}</ul></div>}
            {r.housekeepingTask && <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm"><p className="font-bold text-violet-900">Housekeeping task {r.housekeepingTask.taskNumber}</p><p className="mt-0.5 text-xs text-violet-800">{r.housekeepingTask.type} clean · {r.housekeepingTask.status}. The room becomes Vacant &amp; Clean only after a supervisor inspects and approves it.</p>{(can('housekeeping.view') || can('housekeeping.work')) && <Link className="mt-2 inline-block text-xs font-bold text-brand-700 underline" to={`/housekeeping/tasks/${r.housekeepingTask._id}`}>Open task</Link>}</div>}
            <Checklist room={r} onChanged={onChanged} />
            <div><p className="label">Room history</p>
              <ul className="space-y-2 border-l-2 border-slate-100 pl-4">{[...(r.history || [])].reverse().slice(0, 12).map((h, i) => <li key={i} className="text-xs"><span className="font-semibold text-slate-700">{h.action}</span>{h.from && <span className="text-slate-500"> · {h.from} → {h.to}</span>}{h.reason && <span className="text-slate-500"> · {h.reason}</span>}<br /><span className="text-slate-400">{h.byName || 'System'} · {new Date(h.at).toLocaleString('en-IN')}</span></li>)}{!(r.history || []).length && <li className="text-sm text-slate-400">No changes recorded yet.</li>}</ul>
              {r.stayHistory?.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-500">{r.stayHistory.map((s) => <li key={s._id}>{fullName(s.guest)} · {stayRange(s.checkIn, s.checkOut)}</li>)}</ul>}</div>
            {can('rooms.status') && <div className="rounded-xl bg-slate-50 p-4"><p className="mb-2 text-xs font-bold text-slate-600">Status controls</p>
              <div className="flex flex-wrap gap-2">
                {!['Blocked', 'Out of Order'].includes(r.status) && <><Button size="sm" variant="secondary" disabled={r.status === 'Occupied'} onClick={() => { setErr(''); setDlg('block'); }}><Lock size={14} />Block</Button><Button size="sm" variant="secondary" disabled={r.status === 'Occupied'} onClick={() => { setErr(''); setDlg('ooo'); }}><Wrench size={14} />Out of order</Button></>}
                {r.status === 'Blocked' && <Button size="sm" onClick={() => doStatus('Vacant & Clean')} loading={busy}><Unlock size={14} />Unblock</Button>}
                {r.status === 'Out of Order' && <Button size="sm" onClick={() => doStatus('Vacant & Clean')} loading={busy}><RotateCcw size={14} />Restore</Button>}
              </div>
              {!['Blocked', 'Out of Order', 'Occupied'].includes(r.status) && !(r.housekeepingTask && ['Vacant & Dirty', 'Cleaning in Progress', 'Inspection Pending'].includes(r.status)) && <Field label="Change status" className="mt-3"><Select value="" onChange={(e) => e.target.value && doStatus(e.target.value)}><option value="">Select status…</option>{ROOM_STATUS_LIST.filter((s) => !['Blocked', 'Out of Order', 'Occupied', r.status].includes(s)).map((s) => <option key={s}>{s}</option>)}</Select></Field>}
              {r.status === 'Occupied' && <p className="mt-2 text-xs text-slate-500">Occupied rooms change status through check-out.</p>}
              <p className="mt-2 text-[11px] text-slate-400">Rooms in the cleaning cycle are moved by Housekeeping tasks and supervisor inspection; manual changes are refused while a task is open.</p></div>}
            {can('rooms.edit') && <Button variant="secondary" onClick={() => setEdit(true)}><Pencil size={14} />Edit room</Button>}
          </div>)}</Async>
      </Drawer>
      {dlg && <ConfirmDialog open onClose={() => setDlg(null)} title={holdKinds[dlg][1]} message={holdKinds[dlg][2]} reason confirmLabel={holdKinds[dlg][1]} busy={busy} error={err} onConfirm={(reason) => doStatus(holdKinds[dlg][0], reason)} />}
      {edit && room && <RoomForm room={room} cats={cats} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); st.reload(); onChanged(); }} />}
    </>
  );
}

/* ---------------- Room create / edit ---------------- */
function RoomForm({ room, cats, onClose, onSaved }) {
  const [f, setF] = useState({ roomNumber: room?.roomNumber || '', floor: room?.floor ?? 1, category: room?.category?._id || room?.category || cats[0]?._id || '', capacity: room?.capacity || 2, extraBedCharge: room?.extraBedCharge ?? 0, amenities: (room?.amenities || []).join(', '), photos: (room?.photos || []).join('\n') });
  const [run, busy] = useAction(); const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { setErr({});
    const body = { roomNumber: f.roomNumber.trim(), floor: Number(f.floor), category: f.category, capacity: Number(f.capacity), extraBedCharge: Number(f.extraBedCharge), amenities: f.amenities.split(',').map((x) => x.trim()).filter(Boolean), photos: f.photos.split('\n').map((x) => x.trim()).filter(Boolean) };
    try { room ? await run(() => api.put(`/rooms/${room._id}`, body)) : await run(() => api.post('/rooms', body)); toast.success(room ? 'Room updated' : 'Room created'); onSaved(); } catch (e) { setErr(e.fields?.length ? e.fields : { _: e.message, ...e.fields }); } };
  return (
    <Modal open onClose={onClose} title={room ? `Edit room ${room.roomNumber}` : 'Add room'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.roomNumber || !f.category}>{room ? 'Save changes' : 'Create room'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Room number" required error={err.roomNumber}><Input value={f.roomNumber} onChange={set('roomNumber')} error={err.roomNumber} /></Field>
        <Field label="Floor" required><Input type="number" value={f.floor} onChange={set('floor')} /></Field>
        <Field label="Category" required><Select value={f.category} onChange={(e) => { const c = cats.find((x) => x._id === e.target.value); setF({ ...f, category: e.target.value, capacity: room ? f.capacity : c?.capacity, extraBedCharge: room ? f.extraBedCharge : c?.extraBedCharge, amenities: room ? f.amenities : (c?.amenities || []).join(', ') }); }}>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
        <Field label="Capacity (guests)"><Input type="number" min="1" value={f.capacity} onChange={set('capacity')} /></Field>
        <Field label="Extra-bed charge (₹ / night)"><Input type="number" min="0" value={f.extraBedCharge} onChange={set('extraBedCharge')} /></Field>
        <Field label="Amenities" hint="Comma separated" className="sm:col-span-2"><Input value={f.amenities} onChange={set('amenities')} /></Field>
        <Field label="Photo links" hint="One image URL per line" className="sm:col-span-2"><Textarea value={f.photos} onChange={set('photos')} /></Field>
      </div>
      {err._ && <p className="mt-3 text-sm text-red-600" role="alert">{err._}</p>}
    </Modal>
  );
}
function CategoryForm({ cat, onClose, onSaved }) {
  const [f, setF] = useState({ name: cat?.name || '', description: cat?.description || '', capacity: cat?.capacity || 2, basePrice: cat?.basePrice ?? 2000, extraBedCharge: cat?.extraBedCharge ?? 500, amenities: (cat?.amenities || []).join(', '), active: cat?.active ?? true });
  const [run, busy] = useAction(); const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { const body = { ...f, capacity: Number(f.capacity), basePrice: Number(f.basePrice), extraBedCharge: Number(f.extraBedCharge), amenities: f.amenities.split(',').map((x) => x.trim()).filter(Boolean) };
    try { cat ? await run(() => api.put(`/room-categories/${cat._id}`, body)) : await run(() => api.post('/room-categories', body)); toast.success(cat ? 'Category updated' : 'Category created'); onSaved(); } catch (e) { setErr(e.message + (e.details?.map?.((d) => ` ${d.field}: ${d.message}`).join(';') || '')); } };
  return (
    <Modal open onClose={onClose} title={cat ? `Edit ${cat.name}` : 'New room category'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name}>Save category</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required><Input value={f.name} onChange={set('name')} /></Field><Field label="Capacity"><Input type="number" min="1" value={f.capacity} onChange={set('capacity')} /></Field>
        <Field label="Base price (₹ / night)"><Input type="number" min="0" value={f.basePrice} onChange={set('basePrice')} /></Field><Field label="Extra-bed charge (₹)"><Input type="number" min="0" value={f.extraBedCharge} onChange={set('extraBedCharge')} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={set('description')} /></Field>
        <Field label="Amenities" hint="Comma separated" className="sm:col-span-2"><Input value={f.amenities} onChange={set('amenities')} /></Field>
        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active (can be sold)" /></div>
      </div>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}
    </Modal>
  );
}

/* ---------------- Availability calendar ---------------- */
const CAL = { Available: 'bg-green-100 text-green-700', Reserved: 'bg-blue-200 text-blue-800', Occupied: 'bg-indigo-300 text-indigo-900', Blocked: 'bg-slate-300 text-slate-700', 'Out of Order': 'bg-red-200 text-red-800' };
function Calendar({ onRoom }) {
  const [from, setFrom] = useState(todayISO()); const nav = useNavigate();
  const st = useGet('/rooms/availability', { from, days: 7 });
  return (
    <Card pad={false} title="Availability — 7 days" action={<div className="flex items-center gap-1"><Button size="sm" variant="secondary" onClick={() => setFrom(addDaysISO(from, -7))} aria-label="Previous week"><ChevronLeft size={14} /></Button><Button size="sm" variant="secondary" onClick={() => setFrom(todayISO())}>Today</Button><Button size="sm" variant="secondary" onClick={() => setFrom(addDaysISO(from, 7))} aria-label="Next week"><ChevronRight size={14} /></Button></div>}>
      <Async state={st} isEmpty={() => false}>{(d) => (
        <div className="scroll-thin overflow-x-auto"><table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead><tr><th className="th sticky left-0 z-10 min-w-[110px]">Room</th>{d.dates.map((x, i) => <th key={i} className="th text-center"><span className="block">{fmtDay(x)}</span><span className="text-sm text-slate-800">{dayNum(x)}</span></th>)}</tr>
            <tr><td className="sticky left-0 z-10 bg-white px-4 py-2 font-semibold text-slate-500">Free rooms</td>{d.summary.map((s, i) => <td key={i} className="px-1 py-2 text-center"><span className="inline-block min-w-[36px] rounded-md bg-brand-100 py-1 font-bold text-brand-800">{s.available}</span></td>)}</tr></thead>
          <tbody>{d.rooms.map((r) => <tr key={r.roomId}><td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-4 py-1.5"><button onClick={() => onRoom(r.roomId)} className="font-bold text-slate-900 hover:text-brand-700">{r.roomNumber}</button> <span className="text-slate-400">{r.category}</span></td>
            {r.days.map((c, i) => <td key={i} className="border-t border-slate-100 px-1 py-1">{c.reservationId ? <button onClick={() => nav(`/reservations/${c.reservationId}`)} title={`${c.reservationNumber} ${c.guest || ''}`} className={cx('block w-full truncate rounded-md px-1.5 py-1 text-center font-semibold', CAL[c.state])}>{(c.guest || c.state).split(' ')[0]}</button> : <div className={cx('rounded-md px-1.5 py-1 text-center font-semibold', CAL[c.state])}>{c.state === 'Available' ? '·' : c.state}</div>}</td>)}</tr>)}</tbody>
        </table></div>)}</Async>
      <div className="flex flex-wrap gap-3 border-t border-slate-100 px-5 py-3 text-xs">{Object.entries(CAL).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className={cx('h-3 w-3 rounded', v.split(' ')[0])} />{k}</span>)}</div>
    </Card>
  );
}

/* ---------------- Pricing tab (rate plans) ---------------- */
function RatePlanForm({ plan, cats, onClose, onSaved }) {
  const blank = { label: '', roomCategory: '', daysOfWeek: [], dateFrom: '', dateTo: '', minNights: '', maxNights: '', minGuests: '', maxGuests: '', clientName: '', bookingSource: '', rate: '', adjType: 'flat', adjValue: 0 };
  const [f, setF] = useState({ name: plan?.name || '', type: plan?.type || 'Room Only', description: plan?.description || '', mealPlan: plan?.mealPlan || 'None', defType: plan?.defaultAdjustment?.type || 'flat', defValue: plan?.defaultAdjustment?.value || 0, active: plan?.active ?? true,
    rules: (plan?.rules || []).map((r) => ({ ...blank, ...r, roomCategory: r.roomCategory?._id || r.roomCategory || '', dateFrom: r.dateFrom?.slice(0, 10) || '', dateTo: r.dateTo?.slice(0, 10) || '', minNights: r.minNights ?? '', maxNights: r.maxNights ?? '', minGuests: r.minGuests ?? '', maxGuests: r.maxGuests ?? '', rate: r.rate ?? '', adjType: r.adjustment?.type || 'flat', adjValue: r.adjustment?.value || 0, clientName: r.clientName || '', bookingSource: r.bookingSource || '' })) });
  const [run, busy] = useAction(); const [err, setErr] = useState('');
  const setRule = (i, k, v) => setF({ ...f, rules: f.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const num = (v) => (v === '' || v == null ? undefined : Number(v));
  const save = async () => {
    const body = { name: f.name, type: f.type, description: f.description, mealPlan: f.mealPlan, active: f.active, defaultAdjustment: { type: f.defType, value: Number(f.defValue) },
      rules: f.rules.map((r) => ({ label: r.label, roomCategory: r.roomCategory || null, daysOfWeek: r.daysOfWeek, dateFrom: r.dateFrom || null, dateTo: r.dateTo || null, minNights: num(r.minNights), maxNights: num(r.maxNights), minGuests: num(r.minGuests), maxGuests: num(r.maxGuests), clientName: r.clientName || null, bookingSource: r.bookingSource || null, rate: num(r.rate), adjustment: { type: r.adjType, value: Number(r.adjValue) } })) };
    try { plan ? await run(() => api.put(`/rate-plans/${plan._id}`, body)) : await run(() => api.post('/rate-plans', body)); toast.success(plan ? 'Rate plan updated' : 'Rate plan created'); onSaved(); } catch (e) { setErr(e.message + (e.details?.map?.((d) => ` — ${d.field}: ${d.message}`).join('') || '')); } };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <Modal open onClose={onClose} size="xl" title={plan ? `Edit ${plan.name}` : 'New rate plan'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name}>Save rate plan</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{RATE_PLAN_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Meal plan"><Input value={f.mealPlan} onChange={(e) => setF({ ...f, mealPlan: e.target.value })} /></Field>
        <Field label="Default adjustment on base price" className="sm:col-span-2" hint="Used when no rule below matches"><div className="flex gap-2"><Select className="!w-32" value={f.defType} onChange={(e) => setF({ ...f, defType: e.target.value })}><option value="flat">₹ flat</option><option value="percent">% percent</option></Select><Input type="number" value={f.defValue} onChange={(e) => setF({ ...f, defValue: e.target.value })} /></div></Field>
        <div className="flex items-end"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /></div>
      </div>
      <div className="mt-5 flex items-center justify-between"><div><p className="text-sm font-bold">Pricing rules <TBC>Priority TBC</TBC></p><p className="text-xs text-slate-500">The first matching rule (top to bottom) is used. Leave a condition empty to ignore it.</p></div>
        <Button size="sm" variant="secondary" onClick={() => setF({ ...f, rules: [...f.rules, { ...blank }] })}><Plus size={14} />Add rule</Button></div>
      <div className="mt-3 space-y-3">{f.rules.map((r, i) => (
        <div key={i} className="rounded-xl border border-slate-200 p-3"><div className="grid gap-3 sm:grid-cols-4">
          <Field label="Rule label"><Input value={r.label} onChange={(e) => setRule(i, 'label', e.target.value)} placeholder="e.g. Weekend" /></Field>
          <Field label="Room category"><Select value={r.roomCategory} onChange={(e) => setRule(i, 'roomCategory', e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
          <Field label="Fixed nightly rate (₹)" hint="Optional"><Input type="number" value={r.rate} onChange={(e) => setRule(i, 'rate', e.target.value)} /></Field>
          <Field label="Then adjust by"><div className="flex gap-1"><Select className="!w-24" value={r.adjType} onChange={(e) => setRule(i, 'adjType', e.target.value)}><option value="flat">₹</option><option value="percent">%</option></Select><Input type="number" value={r.adjValue} onChange={(e) => setRule(i, 'adjValue', e.target.value)} /></div></Field>
          <Field label="Days of week" className="sm:col-span-2"><div className="flex flex-wrap gap-1">{DOW.map((d, di) => <button type="button" key={d} onClick={() => setRule(i, 'daysOfWeek', r.daysOfWeek.includes(di) ? r.daysOfWeek.filter((x) => x !== di) : [...r.daysOfWeek, di])} className={cx('rounded-md px-2 py-1 text-xs font-semibold', r.daysOfWeek.includes(di) ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600')}>{d}</button>)}</div></Field>
          <Field label="Season / festival from"><Input type="date" value={r.dateFrom} onChange={(e) => setRule(i, 'dateFrom', e.target.value)} /></Field><Field label="to"><Input type="date" value={r.dateTo} onChange={(e) => setRule(i, 'dateTo', e.target.value)} /></Field>
          <Field label="Min nights"><Input type="number" value={r.minNights} onChange={(e) => setRule(i, 'minNights', e.target.value)} /></Field><Field label="Max nights"><Input type="number" value={r.maxNights} onChange={(e) => setRule(i, 'maxNights', e.target.value)} /></Field>
          <Field label="Min guests"><Input type="number" value={r.minGuests} onChange={(e) => setRule(i, 'minGuests', e.target.value)} /></Field><Field label="Max guests"><Input type="number" value={r.maxGuests} onChange={(e) => setRule(i, 'maxGuests', e.target.value)} /></Field>
          <Field label="Corporate / agent name"><Input value={r.clientName} onChange={(e) => setRule(i, 'clientName', e.target.value)} /></Field><Field label="Booking source"><Input value={r.bookingSource} onChange={(e) => setRule(i, 'bookingSource', e.target.value)} /></Field>
        </div><div className="mt-2 text-right"><button className="text-xs font-semibold text-red-600" onClick={() => setF({ ...f, rules: f.rules.filter((_, j) => j !== i) })}>Remove rule</button></div></div>))}
        {!f.rules.length && <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">No rules. The default adjustment applies to every night.</p>}</div>
      {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}
    </Modal>
  );
}
function Pricing({ cats, reloadCats }) {
  const can = useAuth((s) => s.can); const plans = useGet('/rate-plans'); const [form, setForm] = useState(null); const [catForm, setCatForm] = useState(null);
  return (<div className="space-y-4">
    <Card title="Room categories" pad={false} action={can('rooms.create') && <Button size="sm" onClick={() => setCatForm({})}><Plus size={14} />Category</Button>}>
      <Table rows={cats} columns={[{ header: 'Category', render: (c) => <span className="font-semibold">{c.name}</span> }, { header: 'Capacity', key: 'capacity' }, { header: 'Base price', render: (c) => money(c.basePrice) }, { header: 'Extra bed', render: (c) => money(c.extraBedCharge) }, { header: 'Amenities', render: (c) => <span className="text-xs text-slate-500">{(c.amenities || []).join(', ')}</span> }, { header: 'Status', render: (c) => <Badge tone={c.active ? 'green' : 'slate'}>{c.active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', render: (c) => can('rooms.edit') && <Button size="sm" variant="ghost" onClick={() => setCatForm(c)}><Pencil size={14} /></Button> }]} />
    </Card>
    <Card title="Rate plans" pad={false} badge={<TBC>Factor priority TBC</TBC>} action={can('rates.create') && <Button size="sm" onClick={() => setForm({})}><Plus size={14} />Rate plan</Button>}>
      <Async state={plans} empty={<EmptyState title="No rate plans yet" text="Create a plan to price rooms for corporate, agent, group or long-stay bookings." />}>{(rows) => <Table rows={rows} columns={[{ header: 'Plan', render: (p) => <span className="font-semibold">{p.name}</span> }, { header: 'Type', key: 'type' }, { header: 'Meal plan', key: 'mealPlan' }, { header: 'Default', render: (p) => p.defaultAdjustment?.value ? `${p.defaultAdjustment.value > 0 ? '+' : ''}${p.defaultAdjustment.value}${p.defaultAdjustment.type === 'percent' ? '%' : ' ₹'}` : 'Base price' }, { header: 'Rules', render: (p) => p.rules?.length || 0 }, { header: 'Status', render: (p) => <Badge tone={p.active ? 'green' : 'slate'}>{p.active ? 'Active' : 'Inactive'}</Badge> }, { header: '', render: (p) => can('rates.edit') && <Button size="sm" variant="ghost" onClick={() => setForm(p)}><Pencil size={14} /></Button> }]} />}</Async>
    </Card>
    {form && <RatePlanForm plan={form._id ? form : null} cats={cats} onClose={() => setForm(null)} onSaved={() => { setForm(null); plans.reload(); }} />}
    {catForm && <CategoryForm cat={catForm._id ? catForm : null} onClose={() => setCatForm(null)} onSaved={() => { setCatForm(null); reloadCats(); }} />}
  </div>);
}

/* ---------------- Page ---------------- */
export default function Rooms() {
  const can = useAuth((s) => s.can); const { id } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState('grid'); const [q, setQ] = useState(sp.get('q') || ''); const dq = useDebounced(q); const [floor, setFloor] = useState(''); const [category, setCategory] = useState(''); const [status, setStatus] = useState('');
  const [add, setAdd] = useState(false);
  const cats = useGet('/room-categories'); const rooms = useGet('/rooms', { q: dq || undefined, floor: floor || undefined, category: category || undefined, status: status || undefined });
  const floors = useMemo(() => [...new Set((rooms.data || []).map((r) => r.floor))].sort(), [rooms.data]);
  useEffect(() => { if (sp.get('q')) setSp({}, { replace: true }); }, []); // eslint-disable-line
  const counts = useMemo(() => (rooms.data || []).reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}), [rooms.data]);
  const tabs = [{ key: 'grid', label: 'Grid' }, { key: 'calendar', label: 'Calendar' }, ...(can('rates.view') ? [{ key: 'pricing', label: 'Pricing' }] : [])];
  return (<>
    <PageHeader title="Rooms" subtitle="Floor-wise room status, availability and pricing" actions={can('rooms.create') && cats.data && <Button onClick={() => setAdd(true)}><Plus size={16} />Add room</Button>} />
    <Tabs items={tabs} value={tab} onChange={setTab} />
    <div className="mt-4">
      {tab === 'grid' && (<>
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <div className="relative min-w-[200px] flex-1"><Search size={15} className="absolute left-3 top-[34px] text-slate-400" /><Field label="Search"><Input className="!pl-9" placeholder="Room number or category, e.g. 204 or Deluxe" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
          <Field label="Floor" className="w-28"><Select value={floor} onChange={(e) => setFloor(e.target.value)}><option value="">All</option>{[1, 2, 3, 4].map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
          <Field label="Room type" className="w-36"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{(cats.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
          <Field label="Status" className="w-48"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{ROOM_STATUS_LIST.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </div>
        <div className="mb-5 flex flex-wrap gap-x-4 gap-y-2" aria-label="Status legend">{ROOM_STATUS_LIST.map((s) => <button key={s} onClick={() => setStatus(status === s ? '' : s)} className={cx('flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-slate-600', status === s && 'bg-slate-200')}><span className={cx('h-3 w-3 rounded-sm', ROOM_STATUS[s].dot)} />{s}{counts[s] ? <b className="text-slate-900">{counts[s]}</b> : null}</button>)}</div>
        <Async state={rooms} empty={<div className="card"><EmptyState title="No rooms match" text="Try clearing the filters or search." action={<Button variant="secondary" onClick={() => { setQ(''); setFloor(''); setCategory(''); setStatus(''); }}>Clear filters</Button>} /></div>}>
          {(list) => [...new Set(list.map((r) => r.floor))].sort().map((fl) => (
            <div key={fl} className="mb-6"><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Floor {fl}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{list.filter((r) => r.floor === fl).map((r) => <Tile key={r._id} room={r} onClick={() => nav(`/rooms/${r._id}`)} />)}</div></div>))}
        </Async>
      </>)}
      {tab === 'calendar' && <Calendar onRoom={(rid) => nav(`/rooms/${rid}`)} />}
      {tab === 'pricing' && cats.data && <Pricing cats={cats.data} reloadCats={cats.reload} />}
    </div>
    <RoomDrawer id={id} onClose={() => nav('/rooms')} onChanged={rooms.reload} cats={cats.data || []} />
    {add && <RoomForm cats={cats.data} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); rooms.reload(); }} />}
  </>);
}