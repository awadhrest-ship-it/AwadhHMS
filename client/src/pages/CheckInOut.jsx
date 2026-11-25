import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn, LogOut } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, RoomStatusBadge, Select, Spinner, Table, TBC } from '../components/ui';
import { ConfirmDialog } from '../components/feedback';
import { PAY_TONE } from '../utils/constants';
import { fmtHotelDate, fullName, money, stayRange, todayISO } from '../utils/format';

function CheckInPanel({ r, onDone }) {
  const prop = useGet('/property'); const [room, setRoom] = useState(r.room?._id || ''); const [avail, setAvail] = useState([]); const [idOk, setIdOk] = useState(false); const [docType, setDocType] = useState(''); const [docNo, setDocNo] = useState(''); const [catOk, setCatOk] = useState(false);
  const [run, busy] = useAction(); const [err, setErr] = useState('');
  useEffect(() => { api.get('/rooms/availability', { params: { checkIn: r.checkIn.slice(0, 10), checkOut: r.checkOut.slice(0, 10), reservation: r._id } }).then((x) => setAvail(x.data.data.filter((a) => ['Available', 'Reserved', 'Vacant & Clean'].includes(a.status)))); }, [r]);
  const chosen = avail.find((a) => a._id === room); const diffCat = chosen && String(chosen.category?._id) !== String(r.roomCategory?._id);
  const go = async () => { setErr(''); try { await run(async () => { if (r.status === 'Pending') await api.put(`/reservations/${r._id}`, { room, confirm: true }); return api.post(`/reservations/${r._id}/check-in`, { room, idVerified: idOk, allowCategoryChange: catOk, document: docType ? { type: docType, number: docNo } : undefined }); }); toast.success(`Checked in to room ${chosen?.roomNumber || r.room?.roomNumber}`); onDone(); } catch (e) { setErr(e.message); } };
  return (<Card title={`Check-in · ${r.reservationNumber}`} badge={<Badge tone="blue">{r.status}</Badge>}>
    <p className="text-sm"><b>{fullName(r.guest)}</b> · {stayRange(r.checkIn, r.checkOut)} · {r.roomCategory?.name} · {r.adults} adults{r.children ? `, ${r.children} children` : ''}</p>
    <ol className="my-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">{['Verify guest', 'Assign room', 'Check-in'].map((s, i) => <li key={s} className="rounded-full bg-slate-100 px-3 py-1">{i + 1}. {s}</li>)}</ol>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Room" required><Select value={room} onChange={(e) => { setRoom(e.target.value); setCatOk(false); }}><option value="">Select a room…</option>{r.room && !avail.some((a) => a._id === r.room._id) && <option value={r.room._id}>{r.room.roomNumber} (assigned)</option>}{avail.map((a) => <option key={a._id} value={a._id}>{a.roomNumber} · {a.category?.name} · {a.status}</option>)}</Select></Field>
      <div><p className="label">Payment</p><p className="text-sm"><Badge tone={PAY_TONE[r.paymentStatus]}>{r.paymentStatus}</Badge> {r.folio && <span className="ml-1 text-slate-500">Paid {money(r.folio.totalPaid)} of {money(r.totalAmount)}</span>}</p></div>
      <Field label="ID document type" hint="Accepted types TBC"><Select value={docType} onChange={(e) => setDocType(e.target.value)}><option value="">Not recording now</option>{(prop.data?.settings?.identityDocumentTypes || []).map((t) => <option key={t}>{t}</option>)}</Select></Field>
      {docType && <Field label="Document number (or last digits)"><Input value={docNo} onChange={(e) => setDocNo(e.target.value)} /></Field>}
    </div>
    {diffCat && <label className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" className="mt-1" checked={catOk} onChange={(e) => setCatOk(e.target.checked)} />Room {chosen.roomNumber} is {chosen.category?.name}, but the booking is for {r.roomCategory?.name}. Confirm the change (the booking price stays as is).</label>}
    <label className="mt-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={idOk} onChange={(e) => setIdOk(e.target.checked)} />I have verified the guest’s identity and details</label>
    {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
    <div className="mt-4 flex justify-end"><Button onClick={go} loading={busy} disabled={!room || !idOk || (diffCat && !catOk)}><LogIn size={15} />{r.room ? 'Check-in' : 'Assign & check-in'}</Button></div>
  </Card>);
}

function CheckOutPanel({ r, onDone }) {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const bill = useGet(`/bills/${r.folio?._id}`); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [dlg, setDlg] = useState(false);
  const out = async (allowOutstanding) => { setErr(''); try { await run(() => api.post(`/reservations/${r._id}/check-out`, { allowOutstanding })); toast.success('Guest checked out. Room is now Vacant & Dirty'); setDlg(false); onDone(); } catch (e) { setErr(e.message); setDlg(false); } };
  return (<Card title={`Check-out · ${r.reservationNumber}`} badge={<RoomStatusBadge status="Occupied" />}>
    <p className="text-sm"><b>{fullName(r.guest)}</b> · Room {r.room?.roomNumber} · {stayRange(r.checkIn, r.checkOut)}</p>
    <Async state={bill} isEmpty={() => false}>{(b) => (<div className="mt-4">
      <p className="label">Review guest bill</p><div className="overflow-hidden rounded-xl border border-slate-200"><table className="min-w-full text-sm"><tbody className="divide-y divide-slate-100">{b.charges.map((c) => <tr key={c._id}><td className="px-4 py-2">{c.description}</td><td className="px-4 py-2 text-right">{money(c.amount)}</td></tr>)}</tbody>
        <tfoot className="bg-slate-50 font-bold"><tr><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-right">{money(b.totalCharges)}</td></tr><tr><td className="px-4 py-2 text-green-700">Paid</td><td className="px-4 py-2 text-right text-green-700">{money(b.totalPaid)}</td></tr><tr><td className="px-4 py-2">Outstanding</td><td className={`px-4 py-2 text-right ${b.outstanding > 0 ? 'text-red-600' : ''}`}>{money(b.outstanding)}</td></tr></tfoot></table></div>
      {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">{b.outstanding > 0 && can('bills.payment') && <Button variant="secondary" onClick={() => nav(`/bills/${b._id}`)}>Collect payment</Button>}
        <Button onClick={() => (b.outstanding > 0 ? setDlg(true) : out(false))} loading={busy}><LogOut size={15} />Check-out</Button></div>
      <ConfirmDialog open={dlg} onClose={() => setDlg(false)} danger title="Check out with a balance due?" message={`${money(b.outstanding)} is still unpaid. Checking out now records it as the guest’s outstanding balance.`} confirmLabel="Check-out anyway" busy={busy} onConfirm={() => out(true)} />
    </div>)}</Async>
  </Card>);
}

export default function CheckInOut({ mode }) {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const sel = sp.get('res'); const can = useAuth((s) => s.can);
  const isIn = mode === 'in';
  const list = useGet('/reservations', isIn ? { status: 'Pending,Confirmed', to: todayISO(), limit: 100 } : { status: 'Checked In', limit: 100 });
  const one = useGet(sel ? `/reservations/${sel}` : null, null, [sel]);
  const done = () => { setSp({}); list.reload(); };
  return (<>
    <PageHeader title="Check-in / Check-out" subtitle="Reservation → guest verification → room assignment → check-in → stay → check-out" />
    <Pills className="mb-5" value={mode} onChange={(k) => nav(k === 'in' ? '/check-in' : '/check-out')} items={[...(can('reservations.checkin') ? [{ key: 'in', label: 'Arrivals' }] : []), ...(can('reservations.checkout') ? [{ key: 'out', label: 'In-house / departures' }] : [])]} />
    <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
      <Card title={isIn ? 'Ready to check in' : 'Guests in-house'} pad={false}>
        <Async state={list} empty={<EmptyState title={isIn ? 'No arrivals waiting' : 'No guests in-house'} text={isIn ? 'Bookings due today or earlier appear here.' : ''} />}>
          {(rows) => <Table rows={rows} onRow={(r) => setSp({ res: r._id })} columns={[{ header: 'Guest', render: (r) => <span className={`font-semibold ${sel === r._id ? 'text-brand-700' : ''}`}>{fullName(r.guest)}</span> }, { header: 'Room', render: (r) => r.room?.roomNumber || <Badge tone="amber">Assign</Badge> }, { header: isIn ? 'Arrives' : 'Departs', render: (r) => fmtHotelDate(isIn ? r.checkIn : r.checkOut) }, { header: 'Payment', render: (r) => <Badge tone={PAY_TONE[r.paymentStatus]}>{r.paymentStatus}</Badge> }]} />}
        </Async>
      </Card>
      <div>{!sel ? <div className="card"><EmptyState title="Select a reservation" text="Choose a guest from the list to continue." /></div> : <Async state={one} isEmpty={() => false}>{(r) => (isIn ? (r.status === 'Checked In' ? <Card><p className="text-sm">Already checked in. <Link className="font-semibold text-brand-700" to={`/reservations/${r._id}`}>Open reservation</Link></p></Card> : ['Confirmed', 'Pending'].includes(r.status) ? (r.pendingApproval ? <Card><p className="text-sm text-amber-800">An approval is pending on this booking. Check-in is blocked until it is decided.</p></Card> : r.status === 'Pending' && !r.room ? <CheckInPanel r={r} onDone={done} /> : <CheckInPanel r={r} onDone={done} />) : <Card><p className="text-sm">This reservation is {r.status}.</p></Card>) : (r.status === 'Checked In' ? <CheckOutPanel key={r._id} r={r} onDone={done} /> : <Card><p className="text-sm">This guest is {r.status === 'Checked Out' ? 'already checked out' : `not in-house (${r.status})`}.</p></Card>))}</Async>}</div>
    </div>
  </>);
}
