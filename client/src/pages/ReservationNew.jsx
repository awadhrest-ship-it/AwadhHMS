import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ArrowLeft, ArrowRight } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { toast } from '../store/toast';
import { Badge, Button, Card, Field, Input, PageHeader, RoomStatusBadge, Select, Spinner, TBC, Textarea, cx } from '../components/ui';
import GuestPicker from '../components/GuestPicker';
import { ROOM_STATUS } from '../utils/constants';
import { addDaysISO, fmtHotelDate, fullName, money, todayISO } from '../utils/format';

const STEPS = ['Guest', 'Dates', 'Room', 'Rate', 'Guests', 'Confirm'];

export default function ReservationNew() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const prop = useGet('/property'); const plans = useGet('/rate-plans');
  const [step, setStep] = useState(0);
  const [guest, setGuest] = useState(null); const [checkIn, setCheckIn] = useState(todayISO()); const [checkOut, setCheckOut] = useState(addDaysISO(todayISO(), 1));
  const [catFilter, setCatFilter] = useState(''); const [room, setRoom] = useState(null); const [ratePlan, setRatePlan] = useState(''); const [adults, setAdults] = useState(2); const [children, setChildren] = useState(0); const [extraBed, setExtraBed] = useState(false);
  const [source, setSource] = useState('Walk-in'); const [requests, setRequests] = useState(''); const [advance, setAdvance] = useState(''); const [method, setMethod] = useState('Cash');
  const [avail, setAvail] = useState({ loading: false, rows: [], error: '' }); const [quote, setQuote] = useState(null); const [err, setErr] = useState(''); const [run, busy] = useAction();
  const cats = useGet('/room-categories');

  useEffect(() => { const g = sp.get('guest'); if (g) api.get(`/guests/${g}`).then((r) => setGuest(r.data.data)).catch(() => {}); }, [sp]);
  const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 864e5);
  const datesOk = checkIn && checkOut && nights >= 1;
  useEffect(() => { if (step < 2 || !datesOk) return; setAvail((a) => ({ ...a, loading: true, error: '' }));
    api.get('/rooms/availability', { params: { checkIn, checkOut, category: catFilter || undefined } }).then((r) => setAvail({ loading: false, rows: r.data.data, error: '' })).catch((e) => setAvail({ loading: false, rows: [], error: e.response?.data?.message || 'Could not load rooms' })); }, [step, checkIn, checkOut, catFilter, datesOk]);
  const catId = room?.category?._id || room?.category;
  useEffect(() => { if (step < 3 || !room || !datesOk) return; api.post('/rate-plans/quote', { categoryId: catId, ratePlanId: ratePlan || null, checkIn, checkOut, adults: Number(adults), children: Number(children), extraBed, clientName: guest?.corporate?.name || guest?.travelAgent?.name, source }).then((r) => setQuote(r.data.data)).catch((e) => setErr(e.response?.data?.message || 'Could not price this stay')); }, [step, room, ratePlan, adults, children, extraBed, checkIn, checkOut, source]); // eslint-disable-line
  const capacity = room?.capacity || room?.category?.capacity || 2;
  const methods = prop.data?.settings?.paymentMethods || []; const sources = prop.data?.settings?.bookingSources || ['Walk-in'];
  const can = [!!guest && !guest.blacklist, datesOk, !!room, true, adults >= 1 && Number(adults) + Number(children) <= capacity + (extraBed ? 1 : 0), true];
  const confirm = async () => { setErr('');
    try { const r = await run(() => api.post('/reservations', { guest: guest._id, room: room._id, checkIn, checkOut, adults: Number(adults), children: Number(children), extraBed, ratePlan: ratePlan || null, source, specialRequests: requests, advanceAmount: Number(advance) || 0, advanceMethod: Number(advance) > 0 ? method : undefined }));
      toast.success('Booking created'); nav(`/reservations/${r.data.data._id}`);
    } catch (e) { setErr(e.message); if (e.status === 409) setStep(2); } };
  const planName = plans.data?.find((p) => p._id === ratePlan)?.name || 'Standard (base price)';
  const byFloor = useMemo(() => avail.rows.reduce((a, r) => ((a[r.floor] = [...(a[r.floor] || []), r]), a), {}), [avail.rows]);
  return (<>
    <PageHeader title="New reservation" subtitle="Cancellation and price changes after booking need approval" />
    <ol className="mb-6 flex items-center" aria-label="Progress">{STEPS.map((s, i) => (
      <li key={s} className="flex flex-1 items-center last:flex-none"><button onClick={() => i < step && setStep(i)} disabled={i > step} className="flex flex-col items-center gap-1" aria-current={i === step ? 'step' : undefined}>
        <span className={cx('flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold', i < step ? 'bg-brand-700 text-white' : i === step ? 'bg-brand-700 text-white ring-4 ring-brand-100' : 'bg-slate-200 text-slate-500')}>{i < step ? <Check size={16} /> : i + 1}</span><span className={cx('text-[11px] font-semibold', i <= step ? 'text-slate-900' : 'text-slate-400')}>{s}</span></button>
        {i < STEPS.length - 1 && <span className={cx('mx-2 mb-5 h-0.5 flex-1', i < step ? 'bg-brand-700' : 'bg-slate-200')} />}</li>))}</ol>
    <div className="mx-auto max-w-3xl">
      <Card>
        {step === 0 && <><h2 className="mb-1 text-lg font-bold">Who is staying?</h2><p className="mb-4 text-sm text-slate-500">Search an existing guest, or add a new one.</p><GuestPicker value={guest} onChange={setGuest} />{guest?.blacklist && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">This guest is blacklisted and cannot be booked.</p>}</>}
        {step === 1 && <><h2 className="mb-4 text-lg font-bold">Check-in and check-out</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="Check-in" required><Input type="date" min={todayISO()} value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDaysISO(e.target.value, 1)); setRoom(null); }} /></Field><Field label="Check-out" required error={!datesOk ? 'Check-out must be after check-in' : ''}><Input type="date" min={addDaysISO(checkIn, 1)} value={checkOut} onChange={(e) => { setCheckOut(e.target.value); setRoom(null); }} /></Field></div>{datesOk && <p className="mt-4 rounded-lg bg-brand-50 p-3 text-sm font-semibold text-brand-800">{fmtHotelDate(checkIn)} → {fmtHotelDate(checkOut)} · {nights} night{nights > 1 ? 's' : ''}</p>}</>}
        {step === 2 && <><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Choose a room</h2><p className="text-sm text-slate-500">Only rooms free for these dates are shown.</p></div><Field label="Type" className="w-40"><Select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setRoom(null); }}><option value="">All types</option>{(cats.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field></div>
          {avail.loading ? <div className="flex justify-center py-10"><Spinner /></div> : avail.error ? <p className="text-sm text-red-600" role="alert">{avail.error}</p> : !avail.rows.length ? <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">No rooms are free for these dates. Try different dates or another room type.</p> :
            Object.entries(byFloor).map(([fl, list]) => <div key={fl} className="mb-4"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Floor {fl}</p><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{list.map((r) => { const s = ROOM_STATUS[r.status] || ROOM_STATUS.Available; const sel = room?._id === r._id;
              return <button key={r._id} onClick={() => setRoom(r)} aria-pressed={sel} className={cx('rounded-lg border-l-4 px-3 py-2 text-left transition', s.tile, sel && 'ring-2 ring-brand-700 ring-offset-1')}><span className="block text-lg font-extrabold leading-none">{r.roomNumber}</span><span className="block text-xs">{r.category?.name}</span><span className="block text-[11px] font-bold">{money(r.category?.basePrice)}</span></button>; })}</div></div>)}</>}
        {step === 3 && <><h2 className="mb-1 text-lg font-bold">Rate plan</h2><p className="mb-4 text-sm text-slate-500">Rates are configured under Rooms → Pricing.</p>
          <div className="grid gap-2.5"><button onClick={() => setRatePlan('')} className={cx('flex items-center justify-between rounded-xl border p-3 text-left', !ratePlan ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}><span className="font-semibold">Standard (base price)</span><span className="text-sm text-slate-500">{money(room?.category?.basePrice)} / night</span></button>
            {(plans.data || []).filter((p) => p.active).map((p) => <button key={p._id} onClick={() => setRatePlan(p._id)} className={cx('flex items-center justify-between rounded-xl border p-3 text-left', ratePlan === p._id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}><span><span className="font-semibold">{p.name}</span><span className="block text-xs text-slate-500">{p.type}{p.mealPlan && p.mealPlan !== 'None' ? ` · ${p.mealPlan}` : ''}</span></span>{ratePlan === p._id && quote && <span className="font-bold">{money(quote.nightlyRate)} / night</span>}</button>)}</div></>}
        {step === 4 && <><h2 className="mb-4 text-lg font-bold">Guests</h2><div className="grid gap-4 sm:grid-cols-3"><Field label="Adults" required><Input type="number" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} /></Field><Field label="Children"><Input type="number" min="0" value={children} onChange={(e) => setChildren(e.target.value)} /></Field><Field label="Extra bed" hint={`${money(room?.extraBedCharge)} / night`}><Select value={extraBed ? 'yes' : 'no'} onChange={(e) => setExtraBed(e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes</option></Select></Field>
          <Field label="Booking source" hint="Source list is configurable (TBC)"><Select value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</Select></Field><Field label="Special requests" className="sm:col-span-2"><Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} /></Field></div>
          {Number(adults) + Number(children) > capacity + (extraBed ? 1 : 0) && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">This room sleeps {capacity}. Add an extra bed or choose a larger room.</p>}</>}
        {step === 5 && <><h2 className="mb-4 text-lg font-bold">Confirm booking</h2>
          <div className="rounded-xl bg-brand-50 p-4 text-sm"><dl className="grid grid-cols-[120px_1fr] gap-y-1.5"><dt className="text-slate-500">Guest</dt><dd className="font-semibold">{fullName(guest)}</dd><dt className="text-slate-500">Room</dt><dd className="font-semibold">{room?.category?.name} · Room {room?.roomNumber} · Floor {room?.floor}</dd><dt className="text-slate-500">Dates</dt><dd className="font-semibold">{fmtHotelDate(checkIn)} → {fmtHotelDate(checkOut)} ({nights} nights)</dd><dt className="text-slate-500">Guests</dt><dd className="font-semibold">{adults} adults, {children} children{extraBed ? ', extra bed' : ''}</dd><dt className="text-slate-500">Rate plan</dt><dd className="font-semibold">{planName}</dd></dl>
            <hr className="my-3 border-brand-100" />{quote ? <dl className="space-y-1.5"><div className="flex justify-between"><dt>{nights} nights × {money(quote.nightlyRate)}</dt><dd className="font-bold">{money(quote.nightlyRate * nights)}</dd></div>{quote.extraBedAmount > 0 && <div className="flex justify-between"><dt>Extra bed</dt><dd>{money(quote.extraBedAmount)}</dd></div>}<div className="flex justify-between"><dt>Subtotal</dt><dd>{money(quote.subtotal)}</dd></div><div className="flex justify-between"><dt>Taxes {quote.taxTBC && <TBC />}</dt><dd>{money(quote.taxAmount)}</dd></div><div className="flex justify-between border-t border-brand-100 pt-2 text-base"><dt className="font-bold">Total</dt><dd className="font-extrabold">{money(quote.total)}</dd></div></dl> : <Spinner />}</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label={<>Advance payment <TBC /></>} hint="Optional"><Input type="number" min="0" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="0" /></Field>{Number(advance) > 0 && <Field label="Payment method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m}>{m}</option>)}</Select></Field>}</div>
          <Badge tone="amber" className="mt-4">Cancellation & price change → approval</Badge></>}
        {err && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
      </Card>
      <div className="mt-4 flex justify-between gap-3" style={{ paddingBottom: 'var(--safe-bottom)' }}>
        <Button variant="secondary" onClick={() => (step === 0 ? nav('/reservations') : (setErr(''), setStep(step - 1)))}><ArrowLeft size={15} />{step === 0 ? 'Cancel' : 'Back'}</Button>
        {step < 5 ? <Button onClick={() => { setErr(''); setStep(step + 1); }} disabled={!can[step]}>Next<ArrowRight size={15} /></Button> : <Button onClick={confirm} loading={busy} disabled={!quote}>Confirm booking</Button>}
      </div>
    </div>
  </>);
}
