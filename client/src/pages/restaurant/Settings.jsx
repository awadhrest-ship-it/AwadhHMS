import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Button, Card, Field, Input, PageHeader, Switch } from '../../components/ui';
import { toast } from '../../store/toast';
import { SubNav } from './shared';

const DELIVERY = [['contactName', 'Contact name'], ['phone', 'Phone'], ['address', 'Address'], ['landmark', 'Landmark'], ['instructions', 'Instructions']];

export default function RestaurantSettings() {
  const can = useAuth((s) => s.can); const s = useGet('/restaurant/settings'); const [f, setF] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  if (s.data && !f) setF({ taxes: s.data.taxes.map((t) => ({ ...t })), methods: [...s.data.effectivePaymentMethods], ownMethods: Array.isArray(s.data.paymentMethods), dur: s.data.reservationDurationMinutes, hold: s.data.reservationHoldMinutes, delivery: [...s.data.deliveryRequiredFields], maxQty: s.data.maxQuantityPerLine });
  const save = async () => { setErr(''); try {
    const body = { taxes: f.taxes.map((t) => ({ code: t.code || undefined, name: t.name, ratePercent: Number(t.ratePercent) })), paymentMethods: f.ownMethods ? f.methods.filter(Boolean) : null, reservationDurationMinutes: Number(f.dur), reservationHoldMinutes: Number(f.hold), deliveryRequiredFields: f.delivery, maxQuantityPerLine: Number(f.maxQty) };
    await run(() => api.put('/restaurant/settings', body)); toast.success('Restaurant settings saved'); s.reload(); setF(null); } catch (e) { setErr(e.message); } };
  return (
    <div><PageHeader title="Restaurant settings" subtitle="Taxes, payment methods and rules the hotel still has to confirm" actions={<Button loading={busy} onClick={save} disabled={!f}>Save changes</Button>} /><SubNav can={can} />
      <Async state={s}>{() => f && (<div className="grid gap-4 lg:grid-cols-2">
        <Card title="Taxes" className="lg:col-span-2">
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The applicable restaurant taxes have <b>not been confirmed</b> by the hotel, so none is charged by default. Add the confirmed tax(es) here. Rates apply to the taxable amount after discounts, prices are treated as tax-exclusive, and every finalised bill keeps the rates that were in force when it was finalised.</p>
          <div className="space-y-2">{f.taxes.map((t, i) => <div key={i} className="grid grid-cols-[1fr_6rem_8rem_2.5rem] items-end gap-2"><Field label={i === 0 ? 'Name on bill' : undefined}><Input value={t.name} onChange={(e) => setF({ ...f, taxes: f.taxes.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} placeholder="e.g. GST" /></Field><Field label={i === 0 ? 'Rate %' : undefined}><Input type="number" min="0" max="100" step="0.01" value={t.ratePercent} onChange={(e) => setF({ ...f, taxes: f.taxes.map((x, k) => (k === i ? { ...x, ratePercent: e.target.value } : x)) })} /></Field><Field label={i === 0 ? 'Code' : undefined}><Input value={t.code || ''} onChange={(e) => setF({ ...f, taxes: f.taxes.map((x, k) => (k === i ? { ...x, code: e.target.value } : x)) })} placeholder="auto" /></Field><button className="mb-1 rounded p-2 text-slate-400 hover:text-red-600" onClick={() => setF({ ...f, taxes: f.taxes.filter((_, k) => k !== i) })} aria-label="Remove tax"><Trash2 size={16} /></button></div>)}</div>
          {f.taxes.length === 0 && <p className="text-sm text-slate-500">No tax configured - bills carry no tax.</p>}<Button variant="secondary" size="sm" className="mt-3" onClick={() => setF({ ...f, taxes: [...f.taxes, { name: '', ratePercent: 0 }] })} disabled={f.taxes.length >= 6}><Plus size={14} />Add tax</Button></Card>
        <Card title="Payment methods"><Switch checked={f.ownMethods} onChange={(v) => setF({ ...f, ownMethods: v })} label="Use a restaurant-specific list (otherwise the hotel-wide list is used)" />
          <div className="mt-3 space-y-2">{f.methods.map((m, i) => <div key={i} className="flex gap-2"><Input disabled={!f.ownMethods} value={m} onChange={(e) => setF({ ...f, methods: f.methods.map((x, k) => (k === i ? e.target.value : x)) })} aria-label={`Method ${i + 1}`} />{f.ownMethods && <button className="p-2 text-slate-400 hover:text-red-600" onClick={() => setF({ ...f, methods: f.methods.filter((_, k) => k !== i) })} aria-label="Remove method"><Trash2 size={16} /></button>}</div>)}</div>
          {f.ownMethods && <Button variant="secondary" size="sm" className="mt-3" onClick={() => setF({ ...f, methods: [...f.methods, ''] })}><Plus size={14} />Add method</Button>}<p className="mt-3 text-xs text-slate-400">The methods shown are demo defaults - the hotel has not confirmed which it accepts.</p></Card>
        <Card title="Reservations & orders"><div className="grid grid-cols-2 gap-3"><Field label="Default reservation length (min)"><Input type="number" min="15" max="480" value={f.dur} onChange={(e) => setF({ ...f, dur: e.target.value })} /></Field><Field label="Hold table before booking (min)" hint="Walk-ins can't take a table reserved within this time"><Input type="number" min="0" max="240" value={f.hold} onChange={(e) => setF({ ...f, hold: e.target.value })} /></Field><Field label="Max quantity per line"><Input type="number" min="1" value={f.maxQty} onChange={(e) => setF({ ...f, maxQty: e.target.value })} /></Field></div>
          <p className="mb-2 mt-4 text-sm font-semibold">Delivery orders must include <span className="text-xs font-normal text-amber-700">(minimum set - to be confirmed)</span></p><div className="grid grid-cols-2 gap-2">{DELIVERY.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.delivery.includes(k)} onChange={(e) => setF({ ...f, delivery: e.target.checked ? [...f.delivery, k] : f.delivery.filter((x) => x !== k) })} />{l}</label>)}</div></Card>
        {err && <p className="rounded bg-red-50 p-3 text-sm text-red-700 lg:col-span-2" role="alert">{err}</p>}</div>)}</Async></div>);
}
