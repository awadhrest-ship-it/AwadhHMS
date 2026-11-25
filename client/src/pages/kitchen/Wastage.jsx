import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, Select, Table, Tabs, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, STATIONS, StationBadge, rs, todayStr, newKey } from './shared';

const WTONE = { Posted: 'green', Failed: 'red', Pending: 'amber' };
export default function Wastage() {
  const can = useAuth((s) => s.can); const mayRecord = can('kitchen.wastage.record'); const mayView = can('kitchen.wastage.view'); const [tab, setTab] = useState('history'); const [form, setForm] = useState(false);
  const [from, setFrom] = useState(todayStr().slice(0, 8) + '01'); const [to, setTo] = useState(todayStr()); const [station, setStation] = useState('all'); const [reason, setReason] = useState('all'); const [page, setPage] = useState(1);
  const params = { from, to, station: station === 'all' ? undefined : station, reason: reason === 'all' ? undefined : reason };
  const hist = useGet('/kitchen/wastage', { ...params, page }); const rep = useGet(mayView && tab === 'report' ? '/kitchen/wastage/report' : null, params); const settings = useGet('/kitchen/settings'); const reasons = settings.data?.wastageReasons || [];
  return (
    <div><SubNav can={can} />
      <PageHeader title="Kitchen wastage" subtitle="Food and ingredients thrown away - deducted from Kitchen stock through the inventory engine" actions={mayRecord && <Button onClick={() => setForm(true)}><Trash2 size={15} />Record wastage</Button>} />
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <label className="text-xs font-semibold text-slate-600">From<Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label><label className="text-xs font-semibold text-slate-600">To<Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        <label className="text-xs font-semibold text-slate-600">Station<Select value={station} onChange={(e) => setStation(e.target.value)}><option value="all">All</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select></label>
        <label className="text-xs font-semibold text-slate-600">Reason<Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="all">All</option>{reasons.map((s) => <option key={s}>{s}</option>)}</Select></label></div>
      <Tabs items={[{ key: 'history', label: 'History', count: hist.raw?.total }, ...(mayView ? [{ key: 'report', label: 'Wastage report' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'history' && <Card pad={false} className="mt-4"><Async state={hist} empty={<EmptyState icon={Trash2} title="No wastage recorded" text="Nothing matches this range and filter." />}>{(rows) => (<>
        <Table rows={rows} columns={[{ header: 'When', render: (w) => fmtDateTime(w.occurredAt) }, { header: 'Wasted', render: (w) => <span className="font-semibold">{w.kind === 'dish' ? w.menuItemName : w.itemName}<span className="block text-xs font-normal text-slate-500">{w.quantity} {w.unit}{w.kind === 'dish' ? ' (dish - recipe ingredients written off)' : ''}</span></span> },
          { header: 'Station', render: (w) => w.station ? <StationBadge station={w.station} /> : '-' }, { header: 'Reason', render: (w) => <span>{w.reason}{w.notes && <span className="block max-w-[16rem] truncate text-xs text-slate-500" title={w.notes}>{w.notes}</span>}</span> },
          { header: 'Cost', className: 'text-right', render: (w) => w.status === 'Posted' ? <span>{rs(w.cost)}{!w.costComplete && <span className="text-amber-700" title="No recorded cost for some stock"> *</span>}</span> : '-' },
          { header: 'By', render: (w) => w.recordedByName }, { header: 'Status', render: (w) => <><Badge tone={WTONE[w.status]}>{w.status}</Badge><span className="ml-1 font-mono text-[11px] text-slate-400">{w.movementNumber}</span></> }]} />
        {hist.raw?.pages > 1 && <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {hist.raw.pages}</span><Button size="sm" variant="secondary" disabled={page >= hist.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div>}</>)}</Async></Card>}
      {tab === 'report' && <div className="mt-4"><Async state={rep}>{(d) => (<div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Card><p className="text-[11px] font-semibold uppercase text-slate-500">Records</p><p className="text-2xl font-extrabold">{d.totals.records}</p></Card><Card><p className="text-[11px] font-semibold uppercase text-slate-500">Estimated cost</p><p className="text-2xl font-extrabold">{rs(d.totals.cost)}</p>{!d.totals.costComplete && <p className="text-xs font-semibold text-amber-700">incomplete - some stock has no recorded cost</p>}</Card></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Group title="Daily" rows={d.daily} /><Group title="By reason" rows={d.byReason} /><Group title="By station" rows={d.byStation} /><Group title="By person" rows={d.byPerson} /><Group title="By ingredient" rows={d.byIngredient} qty className="lg:col-span-2" /></div>
        <p className="text-xs text-slate-500">{d.note}</p></div>)}</Async></div>}
      <RecordModal open={form} onClose={() => setForm(false)} reasons={reasons} onDone={() => { hist.reload(); rep.reload(); }} />
    </div>
  );
}
const Group = ({ title, rows, qty, className }) => <Card title={title} pad={false} className={className}><Table dense rowKey="key" rows={rows} empty={<p className="p-4 text-sm text-slate-500">Nothing recorded.</p>} columns={[{ header: title.replace('By ', ''), render: (r) => <b>{r.key}</b> }, { header: 'Records', className: 'text-right', render: (r) => r.count }, ...(qty ? [{ header: 'Quantity', render: (r) => Object.entries(r.quantity).map(([u, q]) => `${q} ${u}`).join(', ') }] : []), { header: 'Cost', className: 'text-right', render: (r) => <span>{rs(r.cost)}{!r.costComplete && <span className="text-amber-700"> *</span>}</span> }]} /></Card>;

function RecordModal({ open, onClose, reasons, onDone }) {
  const blank = { kind: 'ingredient', item: null, menuItem: '', quantity: '', unit: '', station: '', reason: '', notes: '' };
  const [f, setF] = useState(blank); const [iq, setIq] = useState(''); const diq = useDebounced(iq, 250); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [key, setKey] = useState(newKey());
  const picker = useGet(open && f.kind === 'ingredient' && iq && !f.item ? '/kitchen/ingredients' : null, { q: diq }); const menu = useGet(open && f.kind === 'dish' ? '/kitchen/menu' : null);
  useEffect(() => { if (open) { setF(blank); setIq(''); setErr(''); setKey(newKey()); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setErr(''); if (f.kind === 'ingredient' && !f.item) return setErr('Choose the ingredient'); if (f.kind === 'dish' && !f.menuItem) return setErr('Choose the dish'); if (!(Number(f.quantity) > 0)) return setErr('Enter a quantity above zero'); if (!f.reason) return setErr('Choose a reason');
    const body = { kind: f.kind, quantity: Number(f.quantity), reason: f.reason, notes: f.notes || undefined, station: f.station || undefined, ...(f.kind === 'ingredient' ? { item: f.item._id, unit: f.unit } : { menuItem: f.menuItem }) };
    try { const r = await run(() => api.post('/kitchen/wastage', body, { headers: { 'Idempotency-Key': key } })); toast.success(r.data.replayed ? 'Already recorded' : `Recorded ${r.data.data.wastageNumber}`); onDone(); onClose(); } catch (e) { setErr(e.message); }   // the same key is reused on retry, so a double tap can never deduct twice
  };
  return (
    <Modal open={open} onClose={onClose} title="Record wastage" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Record & deduct from stock</Button></>}>
      <div className="space-y-3">{err && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{err}</div>}
        <Pills items={[{ key: 'ingredient', label: 'An ingredient' }, { key: 'dish', label: 'Prepared dish (portions)' }]} value={f.kind} onChange={(k) => setF({ ...blank, kind: k })} />
        {f.kind === 'ingredient' ? <Field label="Ingredient" required>{f.item ? <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><b>{f.item.name}</b><Button size="sm" variant="ghost" onClick={() => { set('item', null); set('unit', ''); }}>Change</Button></div> : <div className="relative"><Input placeholder="Search inventory…" value={iq} onChange={(e) => setIq(e.target.value)} />{iq && <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-lg border bg-white shadow-pop">{(picker.data || []).map((it) => <button key={it._id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { set('item', it); set('unit', it.usageUnit || it.baseUnit); }}>{it.name} <span className="font-mono text-xs text-slate-400">{it.sku}</span></button>)}</div>}</div>}</Field>
          : <Field label="Dish" required hint="Its recipe ingredients are written off (dishes only consume stock when sold)"><Select value={f.menuItem} onChange={(e) => set('menuItem', e.target.value)}><option value="">Choose…</option>{(menu.data || []).filter((m) => m.hasRecipe).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</Select></Field>}
        <div className="grid gap-3 sm:grid-cols-3"><Field label={f.kind === 'dish' ? 'Portions' : 'Quantity'} required><Input type="number" min="0" step="any" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
          {f.kind === 'ingredient' && <Field label="Unit"><Select value={f.unit} onChange={(e) => set('unit', e.target.value)}>{(f.item?.units || [f.unit]).filter(Boolean).map((u) => <option key={u}>{u}</option>)}</Select></Field>}
          <Field label="Station"><Select value={f.station} onChange={(e) => set('station', e.target.value)}><option value="">Not specified</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select></Field></div>
        <Field label="Reason" required><Select value={f.reason} onChange={(e) => set('reason', e.target.value)}><option value="">Choose…</option>{reasons.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Notes" required={f.reason === 'Other'}><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
    </Modal>
  );
}
