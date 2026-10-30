import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Receipt, Tag, XCircle } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Badge, Button, Card, Field, Input, Select, Table, TBC } from '../components/ui';
import { ConfirmDialog, Modal } from '../components/feedback';
import { PAY_TONE, RES_TONE } from '../utils/constants';
import { fmtDateTime, fmtHotelDate, fmtShort, fullName, money, toISO } from '../utils/format';

function EditModal({ r, onClose, onSaved }) {
  const [f, setF] = useState({ checkIn: toISO(r.checkIn), checkOut: toISO(r.checkOut), room: r.room?._id || '', adults: r.adults, children: r.children, extraBed: r.extraBed, ratePlan: r.ratePlan?._id || '' });
  const [avail, setAvail] = useState([]); const plans = useGet('/rate-plans'); const [run, busy] = useAction(); const [err, setErr] = useState('');
  useEffect(() => { if (f.checkOut > f.checkIn) api.get('/rooms/availability', { params: { checkIn: f.checkIn, checkOut: f.checkOut, reservation: r._id } }).then((x) => setAvail(x.data.data)).catch(() => {}); }, [f.checkIn, f.checkOut, r._id]);
  const locked = r.status === 'Checked In';
  const save = async () => { setErr(''); try { const res = await run(() => api.put(`/reservations/${r._id}`, { checkIn: f.checkIn, checkOut: f.checkOut, room: f.room || null, adults: Number(f.adults), children: Number(f.children), extraBed: f.extraBed, ratePlan: f.ratePlan || null })); res.data.approvalRequired ? toast.info('Price change sent for approval') : toast.success('Reservation updated'); onSaved(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} title={`Edit ${r.reservationNumber}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save changes</Button></>}>
    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">If these changes alter the booking price, the change is sent for approval and nothing is applied until it is approved.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Check-in"><Input type="date" value={f.checkIn} disabled={locked} onChange={(e) => setF({ ...f, checkIn: e.target.value })} /></Field><Field label="Check-out"><Input type="date" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} /></Field>
      <Field label="Room" className="sm:col-span-2"><Select value={f.room} disabled={locked} onChange={(e) => setF({ ...f, room: e.target.value })}><option value="">Unassigned</option>{r.room && !avail.some((a) => a._id === r.room._id) && <option value={r.room._id}>{r.room.roomNumber} (current)</option>}{avail.map((a) => <option key={a._id} value={a._id}>{a.roomNumber} · {a.category?.name}</option>)}</Select></Field>
      <Field label="Adults"><Input type="number" min="1" value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} /></Field><Field label="Children"><Input type="number" min="0" value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} /></Field>
      <Field label="Rate plan" className="sm:col-span-2"><Select value={f.ratePlan} onChange={(e) => setF({ ...f, ratePlan: e.target.value })}><option value="">Standard (base price)</option>{(plans.data || []).filter((p) => p.active).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select></Field>
    </div>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
function PriceModal({ r, onClose, onSaved }) {
  const [rate, setRate] = useState(r.nightlyRate); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const save = async () => { try { await run(() => api.post(`/reservations/${r._id}/price-change`, { nightlyRate: Number(rate), reason })); toast.success('Price change submitted for approval'); onSaved(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} size="sm" title="Request price change" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!reason.trim() || Number(rate) === r.nightlyRate}>Submit for approval</Button></>}>
    <p className="mb-3 text-sm text-slate-600">Current rate is {money(r.nightlyRate)} per night. The new rate applies only after the General Manager or Owner approves.</p>
    <Field label="New nightly rate (₹)" required><Input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
    <Field label="Reason" className="mt-3" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}

export default function ReservationDetail() {
  const { id } = useParams(); const nav = useNavigate(); const can = useAuth((s) => s.can); const st = useGet(`/reservations/${id}`);
  const [dlg, setDlg] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const cancel = async (reason) => { setErr(''); try { await run(() => api.post(`/reservations/${id}/cancel`, { reason })); toast.success('Cancellation submitted for approval'); setDlg(null); st.reload(); } catch (e) { setErr(e.message); } };
  return <Async state={st} isEmpty={() => false}>{(r) => {
    const open = ['Pending', 'Confirmed'].includes(r.status); const editable = ['Pending', 'Confirmed', 'Checked In'].includes(r.status) && !r.pendingApproval;
    return (<>
      <Link to="/reservations" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-brand-700"><ArrowLeft size={15} />Reservations</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{r.reservationNumber}</h1><div className="mt-1 flex flex-wrap gap-1.5"><Badge tone={RES_TONE[r.status]}>{r.status}</Badge><Badge tone={PAY_TONE[r.paymentStatus]}>{r.paymentStatus}</Badge>{r.pendingApproval && <Badge tone="amber">Approval pending</Badge>}</div></div>
        <div className="flex flex-wrap gap-2">
          {r.status === 'Confirmed' && can('reservations.checkin') && <Button onClick={() => nav(`/check-in?res=${r._id}`)}>Check-in</Button>}
          {r.status === 'Pending' && !r.room && can('reservations.checkin') && <Button onClick={() => nav(`/check-in?res=${r._id}`)}>Assign room</Button>}
          {r.status === 'Checked In' && can('reservations.checkout') && <Button onClick={() => nav(`/check-out?res=${r._id}`)}>Check-out</Button>}
          {r.folio && can('bills.view') && <Button variant="secondary" onClick={() => nav(`/bills/${r.folio._id}`)}><Receipt size={14} />Bill</Button>}
          {editable && can('reservations.edit') && <Button variant="secondary" onClick={() => setDlg('edit')}><Pencil size={14} />Edit</Button>}
          {editable && can('reservations.edit') && <Button variant="secondary" onClick={() => setDlg('price')}><Tag size={14} />Change price</Button>}
          {open && !r.pendingApproval && can('reservations.cancel') && <Button variant="secondary" className="!text-red-600" onClick={() => { setErr(''); setDlg('cancel'); }}><XCircle size={14} />Cancel booking</Button>}
        </div></div>
      {r.pendingApproval && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">A cancellation or price change is waiting for approval. This booking can’t be edited until it is decided.</p>}
      {r.status === 'Cancelled' && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Cancelled {fmtDateTime(r.cancelledAt)}{r.cancellationReason ? ` — ${r.cancellationReason}` : ''}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Stay" className="lg:col-span-2"><dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <div><dt className="label">Guest</dt><dd><Link to={`/guests/${r.guest?._id}`} className="font-semibold text-brand-700">{fullName(r.guest)}</Link></dd></div>
          <div><dt className="label">Room</dt><dd className="font-semibold">{r.room ? `${r.room.roomNumber} · ${r.roomCategory?.name} · Floor ${r.room.floor}` : `Unassigned (${r.roomCategory?.name})`}</dd></div>
          <div><dt className="label">Rate plan</dt><dd className="font-semibold">{r.ratePlan?.name || 'Standard'}</dd></div>
          <div><dt className="label">Check-in</dt><dd className="font-semibold">{fmtHotelDate(r.checkIn)}</dd></div><div><dt className="label">Check-out</dt><dd className="font-semibold">{fmtHotelDate(r.checkOut)}</dd></div><div><dt className="label">Nights</dt><dd className="font-semibold">{r.numberOfNights}</dd></div>
          <div><dt className="label">Guests</dt><dd className="font-semibold">{r.adults} adults, {r.children} children{r.extraBed ? ' · extra bed' : ''}</dd></div><div><dt className="label">Source</dt><dd className="font-semibold">{r.source}</dd></div><div><dt className="label">ID verified</dt><dd className="font-semibold">{r.idVerified ? 'Yes' : 'Not yet'}</dd></div>
          {r.specialRequests && <div className="col-span-full"><dt className="label">Special requests</dt><dd>{r.specialRequests}</dd></div>}
        </dl></Card>
        <Card title="Charges"><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>{r.numberOfNights} × {money(r.nightlyRate)}</dt><dd>{money(r.nightlyRate * r.numberOfNights)}</dd></div>{r.extraBedAmount > 0 && <div className="flex justify-between"><dt>Extra bed</dt><dd>{money(r.extraBedAmount)}</dd></div>}<div className="flex justify-between"><dt>Taxes <TBC /></dt><dd>{money(r.taxAmount)}</dd></div><div className="flex justify-between border-t pt-2 text-base font-extrabold"><dt>Total</dt><dd>{money(r.totalAmount)}</dd></div>
          {r.folio && <><div className="flex justify-between text-green-700"><dt>Paid</dt><dd>{money(r.folio.totalPaid)}</dd></div></>}</dl></Card>
      </div>
      {dlg === 'edit' && <EditModal r={r} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); st.reload(); }} />}
      {dlg === 'price' && <PriceModal r={r} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); st.reload(); }} />}
      {dlg === 'cancel' && <ConfirmDialog open onClose={() => setDlg(null)} danger reason reasonLabel="Cancellation reason" title="Request cancellation" message="Cancellations need approval from the General Manager or Owner. The booking stays active until it is approved." confirmLabel="Submit for approval" busy={busy} error={err} onConfirm={cancel} />}
    </>);
  }}</Async>;
}
