import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Minus, Plus, Search, ShoppingCart, Trash2, UtensilsCrossed, X } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, Select, Textarea, cx } from '../../components/ui';
import { toast } from '../../store/toast';
import { estimateCart, fromMinor } from '../../utils/restaurantMath';
import { OrderBadge, SubNav, TypeBadge, VegDot, idem, rs, useIdemKey } from './shared';

const TYPES = ['Dine-in', 'Takeaway', 'Delivery', 'Room Service'];
const FIELD_LABEL = { contactName: 'Contact name', phone: 'Phone', address: 'Address', landmark: 'Landmark', instructions: 'Instructions' };

export default function Pos() {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const [sp] = useSearchParams();
  const existingId = sp.get('order');
  const menu = useGet('/restaurant/menu'); const tables = useGet('/restaurant/tables'); const settings = useGet('/restaurant/settings');
  const existing = useGet(existingId ? `/restaurant/orders/${existingId}` : null);
  const [type, setType] = useState('Dine-in'); const [tableId, setTableId] = useState(sp.get('table') || ''); const [reservationId] = useState(sp.get('reservation') || '');
  const [covers, setCovers] = useState(''); const [customer, setCustomer] = useState({ name: '', phone: '' }); const [delivery, setDelivery] = useState({ contactName: '', phone: '', address: '', landmark: '', instructions: '' });
  const [guestQ, setGuestQ] = useState(''); const dq = useDebounced(guestQ, 250); const guests = useGet(type === 'Room Service' ? '/restaurant/in-house' : null, { q: dq });
  const [stay, setStay] = useState(null);
  const [cart, setCart] = useState([]); const [notes, setNotes] = useState('');
  const [q, setQ] = useState(''); const [cat, setCat] = useState('all'); const [sheet, setSheet] = useState(false);
  const [run, busy] = useAction(); const [err, setErr] = useState(''); const key = useIdemKey();
  const touch = () => { key.renew(); setErr(''); };           // content changed -> a new submit, a new idempotency key
  useEffect(() => { if (existing.data) setType(existing.data.type); }, [existing.data]);

  const cats = menu.data || [];
  const items = useMemo(() => cats.filter((c) => cat === 'all' || c._id === cat).flatMap((c) => c.items).filter((i) => !q || `${i.name} ${i.code || ''} ${i.description || ''}`.toLowerCase().includes(q.toLowerCase())), [cats, cat, q]);
  const add = (it) => { if (!it.available) return; touch(); setCart((c) => { const i = c.findIndex((x) => x.menuItem === it._id && !x.notes); return i >= 0 ? c.map((x, k) => (k === i ? { ...x, quantity: Math.min(x.quantity + 1, 50) } : x)) : [...c, { menuItem: it._id, name: it.name, price: it.price, taxable: it.taxable, isVeg: it.isVeg, quantity: 1, notes: '' }]; }); };
  const setQty = (i, d) => { touch(); setCart((c) => c.flatMap((x, k) => (k !== i ? [x] : x.quantity + d <= 0 ? [] : [{ ...x, quantity: Math.min(x.quantity + d, 50) }]))); };
  const setNote = (i, v) => { touch(); setCart((c) => c.map((x, k) => (k === i ? { ...x, notes: v } : x))); };
  const est = estimateCart(cart, settings.data?.taxes || []); const count = cart.reduce((s, x) => s + x.quantity, 0);
  const freeTables = (tables.data || []).filter((t) => t.status === 'Available' || (t.status === 'Reserved') || t._id === tableId);
  const selTable = (tables.data || []).find((t) => t._id === tableId);

  const submit = async (send) => {
    setErr('');
    const lines = cart.map((x) => ({ menuItem: x.menuItem, quantity: x.quantity, ...(x.notes.trim() ? { notes: x.notes.trim() } : {}) }));
    try {
      if (existingId) {
        await run(() => api.post(`/restaurant/orders/${existingId}/items`, { items: lines }));
        if (send) await run(() => api.post(`/restaurant/orders/${existingId}/send`));
        toast.success(send ? 'Items sent to the kitchen' : 'Items added to the order'); nav('/restaurant/orders'); return;
      }
      const body = { type, items: lines, notes: notes.trim() || undefined, send };
      if (type === 'Dine-in') { if (!tableId) return setErr('Select a table'); Object.assign(body, { table: tableId, covers: covers ? Number(covers) : undefined, reservation: reservationId && selTable?.nextReservation?._id === reservationId ? reservationId : undefined }); }
      if (type === 'Takeaway') body.customer = customer;
      if (type === 'Delivery') body.delivery = delivery;
      if (type === 'Room Service') { if (!stay) return setErr('Select the guest'); Object.assign(body, { stayReservation: stay.reservationId, roomNumber: stay.roomNumber }); }
      const r = await run(() => api.post('/restaurant/orders', body, idem(key.get())));
      key.renew(); toast.success(`${r.data.data.orderNumber} ${send ? 'sent to the kitchen' : 'saved as draft'}${r.data.replayed ? ' (already placed - not duplicated)' : ''}`);
      setCart([]); setNotes(''); setSheet(false); nav('/restaurant/orders');
    } catch (e) { setErr(e.message); }
  };
  const missingDelivery = type === 'Delivery' ? (settings.data?.deliveryRequiredFields || []).filter((f) => !String(delivery[f] || '').trim()) : [];

  const CartPanel = (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-slate-100 p-4">
        {existing.data ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex items-center gap-2"><b>{existing.data.orderNumber}</b><OrderBadge status={existing.data.status} /><TypeBadge type={existing.data.type} /></div>
            <p className="mt-1 text-xs text-slate-500">Adding another round. Already ordered: {existing.data.items.filter((i) => i.status === 'Active').map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p></div>
        ) : (<>
          <Pills items={TYPES} value={type} onChange={(t) => { setType(t); touch(); }} />
          {type === 'Dine-in' && (<div className="grid grid-cols-3 gap-2">
            <Field label="Table" className="col-span-2" required><Select value={tableId} onChange={(e) => { setTableId(e.target.value); touch(); }}><option value="">Select table…</option>{freeTables.map((t) => <option key={t._id} value={t._id}>{t.number} · seats {t.capacity}{t.status === 'Reserved' ? ' · reserved' : ''}</option>)}</Select></Field>
            <Field label="Guests"><Input type="number" min="1" value={covers} onChange={(e) => setCovers(e.target.value)} /></Field>
            {selTable?.status === 'Reserved' && <p className="col-span-3 rounded bg-amber-50 p-2 text-xs text-amber-800">Reserved for {selTable.nextReservation?.guestName}. Start the order from their reservation (Tables → Reservations).</p>}
          </div>)}
          {type === 'Takeaway' && <div className="grid grid-cols-2 gap-2"><Field label="Customer name"><Input value={customer.name} onChange={(e) => { setCustomer({ ...customer, name: e.target.value }); touch(); }} /></Field><Field label="Phone"><Input inputMode="tel" value={customer.phone} onChange={(e) => { setCustomer({ ...customer, phone: e.target.value }); touch(); }} /></Field></div>}
          {type === 'Delivery' && <div className="grid grid-cols-2 gap-2">{['contactName', 'phone', 'address', 'landmark', 'instructions'].map((f) => (
            <Field key={f} label={FIELD_LABEL[f]} required={settings.data?.deliveryRequiredFields?.includes(f)} className={f === 'address' || f === 'instructions' ? 'col-span-2' : ''}><Input value={delivery[f]} onChange={(e) => { setDelivery({ ...delivery, [f]: e.target.value }); touch(); }} /></Field>))}</div>}
          {type === 'Room Service' && (<div>
            {stay ? <div className="flex items-center justify-between rounded-lg bg-teal-50 p-3 text-sm"><span><b>Room {stay.roomNumber}</b> · {stay.guestName}<br /><span className="text-xs text-slate-500">{stay.reservationNumber} · charged to the room bill</span></span><button className="text-slate-400 hover:text-slate-700" onClick={() => { setStay(null); touch(); }} aria-label="Change guest"><X size={16} /></button></div> : (<>
              <Field label="Find in-house guest (room or name)" required><Input value={guestQ} onChange={(e) => setGuestQ(e.target.value)} placeholder="e.g. 303 or Rohan" /></Field>
              <ul className="mt-2 max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">{(guests.data || []).map((g) => <li key={g.reservationId}><button className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setStay(g); touch(); }}><span>{g.guestName}</span><Badge tone="teal">Room {g.roomNumber}</Badge></button></li>)}
                {guests.data?.length === 0 && <li className="px-3 py-3 text-xs text-slate-500">No checked-in guest matches.</li>}</ul></>)}
          </div>)}
        </>)}
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {!cart.length ? <EmptyState icon={ShoppingCart} title="No items yet" text="Tap items in the menu to add them." /> : (
          <ul className="space-y-3">{cart.map((x, i) => (
            <li key={`${x.menuItem}-${i}`} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><VegDot veg={x.isVeg} />{x.name}</span><span className="text-sm font-semibold">{rs(fromMinor(Math.round(x.price * 100) * x.quantity))}</span></div>
              <div className="mt-2 flex items-center gap-2">
                <button className="btn btn-secondary btn-sm !px-2" onClick={() => setQty(i, -1)} aria-label={`Fewer ${x.name}`}><Minus size={14} /></button><span className="w-7 text-center text-sm font-bold">{x.quantity}</span>
                <button className="btn btn-secondary btn-sm !px-2" onClick={() => setQty(i, 1)} aria-label={`More ${x.name}`}><Plus size={14} /></button>
                <Input className="!min-h-0 flex-1 !py-1 text-xs" placeholder="Special instructions" value={x.notes} onChange={(e) => setNote(i, e.target.value)} maxLength={200} aria-label={`Instructions for ${x.name}`} />
                <button className="text-slate-400 hover:text-red-600" onClick={() => setQty(i, -x.quantity)} aria-label={`Remove ${x.name}`}><Trash2 size={15} /></button>
              </div></li>))}</ul>)}
        {!existingId && cart.length > 0 && <Field label="Order notes" className="mt-3"><Textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="e.g. birthday, allergies, serve together" /></Field>}
      </div>
      <div className="space-y-2 border-t border-slate-100 p-4" style={{ paddingBottom: 'max(1rem, var(--safe-bottom))' }}>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Items ({count})</span><span>{rs(fromMinor(est.grossMinor))}</span></div>
        {(settings.data?.taxes || []).length > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Tax (estimate)</span><span>{rs(fromMinor(est.taxMinor))}</span></div>}
        <div className="flex justify-between text-base font-extrabold"><span>Estimated total</span><span>{rs(fromMinor(est.totalMinor))}</span></div>
        <p className="text-[11px] text-slate-400">The bill is calculated by the server{(settings.data?.taxes || []).length ? '' : '; no tax is configured yet'}.</p>
        {missingDelivery.length > 0 && <p className="text-xs text-amber-700">Still needed: {missingDelivery.map((f) => FIELD_LABEL[f]).join(', ')}</p>}
        {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{err}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={!cart.length || busy} onClick={() => submit(false)}>{existingId ? 'Add only' : 'Save draft'}</Button>
          <Button disabled={!cart.length || missingDelivery.length > 0} loading={busy} onClick={() => submit(true)}>Send to kitchen</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Point of sale" subtitle="Take dine-in, takeaway, delivery and room-service orders" />
      <SubNav can={can} />
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="pl-9" placeholder="Search menu or code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search menu" /></div>
          </div>
          <Pills className="mb-3" items={[{ key: 'all', label: 'All' }, ...cats.map((c) => ({ key: c._id, label: c.name }))]} value={cat} onChange={setCat} />
          <Async state={menu} isEmpty={(d) => !d.length} empty={<Card><EmptyState icon={UtensilsCrossed} title="The menu is empty" text="Add menu items under Menu first." /></Card>}>{() => (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {items.map((it) => (
                <button key={it._id} disabled={!it.available} onClick={() => add(it)} className={cx('card flex min-h-[88px] flex-col justify-between p-3 text-left transition', it.available ? 'hover:border-brand-400 hover:shadow-md active:scale-[.98]' : 'cursor-not-allowed opacity-50')} aria-label={`Add ${it.name}`}>
                  <span className="flex items-start gap-1.5 text-sm font-semibold leading-snug"><VegDot veg={it.isVeg} /><span>{it.name}</span></span>
                  <span className="mt-2 flex items-center justify-between text-sm"><b>{rs(it.price)}</b>{!it.available && <Badge tone="red">Unavailable</Badge>}</span>
                </button>))}
              {!items.length && <p className="col-span-full py-8 text-center text-sm text-slate-500">No items match.</p>}
            </div>)}</Async>
        </div>
        <aside className="card hidden h-[calc(100vh-11rem)] min-h-[28rem] overflow-hidden lg:sticky lg:top-24 lg:block">{CartPanel}</aside>
      </div>
      <button onClick={() => setSheet(true)} className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-xl bg-brand-700 px-4 py-3.5 font-bold text-white shadow-pop lg:hidden" style={{ marginBottom: 'var(--safe-bottom)' }}>
        <span className="flex items-center gap-2"><ShoppingCart size={18} />{count} item{count === 1 ? '' : 's'}</span><span>{rs(fromMinor(est.totalMinor))} · View order</span></button>
      {sheet && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-slate-900/50" onClick={() => setSheet(false)} /><div className="absolute inset-x-0 bottom-0 top-12 overflow-hidden rounded-t-2xl bg-white"><button onClick={() => setSheet(false)} className="absolute right-3 top-3 z-10 rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close order"><X size={18} /></button>{CartPanel}</div></div>}
    </div>
  );
}
