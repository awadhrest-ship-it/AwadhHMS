import { useEffect, useState } from 'react';
import { Plus, Wine } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Switch, Table } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { SubNav, Notice, MEASURES, CONSUMPTION_TONE, rs, num } from './shared';

export default function BarMenu() {
  const can = useAuth((s) => s.can); const manage = can('bar.menu.manage'); const g = useGet('/bar/menu'); const [edit, setEdit] = useState(null); const [cap, setCap] = useState(false); const [run] = useAction();
  const toggle = async (m) => { try { await run(() => api.post(`/bar/menu/${m._id}/available`, { available: !m.available })); g.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div><SubNav can={can} />
      <PageHeader title="Bar menu" subtitle="Drinks, the measures they are sold in (30 ml, 60 ml, full bottle) and the stock each serving uses" actions={manage && <><Button variant="secondary" onClick={() => setCap(true)}>Bottle sizes</Button><Button onClick={() => setEdit({})}><Plus size={15} />New drink</Button></>} />
      <Async state={g} empty={<Card><EmptyState icon={Wine} title="The bar menu is empty" text={manage ? 'Add your first drink and link it to a liquor item from Inventory.' : 'The bar manager has not set up the menu yet.'} /></Card>}>{(rows) => (
        <Card pad={false}><Table rows={rows} columns={[
          { header: 'Drink', render: (m) => <span className="font-semibold">{m.name}<span className="block text-xs font-normal text-slate-500">{m.category} · {m.stockItemName || 'no stock item linked'}{m.bottleCapacityMl ? ` · ${m.bottleCapacityMl} ml bottle` : ''}</span></span> },
          { header: 'Servings & price', render: (m) => <div className="flex flex-wrap gap-1.5">{m.servings.filter((s) => s.active !== false).map((s) => <span key={s._id} className="rounded-lg bg-slate-100 px-2 py-1 text-xs"><b>{s.measure}</b> {rs(s.currentPrice)}{s.happyHourActive && <Badge tone="green" className="ml-1">Happy hour</Badge>}</span>)}</div> },
          { header: 'Stock setup', render: (m) => <span><Badge tone={CONSUMPTION_TONE[m.consumptionStatus]}>{m.consumptionStatus}</Badge>{m.consumptionProblems.length > 0 && <span className="mt-1 block max-w-[16rem] text-xs text-red-700">{m.consumptionProblems.join('; ')}</span>}</span> },
          { header: 'Available', render: (m) => manage ? <Switch checked={m.available} onChange={() => toggle(m)} label={`${m.name} available`} /> : <Badge tone={m.available ? 'green' : 'slate'}>{m.available ? 'Yes' : 'No'}</Badge> },
          { header: '', render: (m) => manage && <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Edit</Button> }]} /></Card>)}</Async>
      <Editor item={edit} onClose={() => setEdit(null)} onDone={g.reload} />
      <CapacityModal open={cap} onClose={() => setCap(false)} onDone={g.reload} />
    </div>
  );
}
const blank = () => ({ name: '', category: 'Spirits', kind: 'spirit', trackStock: true, stockItem: '', servings: MEASURES.map((m) => ({ measure: m, ml: m === '30 ml' ? 30 : m === '60 ml' ? 60 : undefined, price: '', happyHourPrice: '', active: m !== 'Full bottle' || false, on: false })), mixers: [], notes: '' });
function Editor({ item, onClose, onDone }) {
  const [f, setF] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState(''); const items = useGet(item ? '/bar/liquor-items' : null); const isNew = item && !item._id;
  useEffect(() => { if (!item) return; setErr('');
    if (!item._id) { setF(blank()); return; }
    setF({ ...blank(), ...item, stockItem: item.stockItem || '', servings: MEASURES.map((m) => { const s = item.servings.find((x) => x.measure === m); return s ? { ...s, happyHourPrice: s.happyHourPrice ?? '', on: true } : { measure: m, price: '', happyHourPrice: '', on: false, ml: m === '30 ml' ? 30 : m === '60 ml' ? 60 : undefined }; }), mixers: (item.mixers || []).map((x) => ({ ...x })) }); }, [item]);
  if (!item || !f) return null; const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const setS = (i, k, v) => set('servings', f.servings.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const sel = (items.data || []).find((x) => x._id === f.stockItem);
  const save = async () => { setErr('');
    const servings = f.servings.filter((s) => s.on || s._id).filter((s) => s.on).map((s) => ({ ...(s._id ? { _id: s._id } : {}), measure: s.measure, ...(s.measure !== 'Full bottle' && f.kind === 'spirit' ? { ml: Number(s.ml) } : {}), price: Number(s.price), ...(s.happyHourPrice !== '' && s.happyHourPrice != null ? { happyHourPrice: Number(s.happyHourPrice) } : { happyHourPrice: null }), active: true }));
    if (!servings.length) return setErr('Choose at least one serving'); if (servings.some((s) => !(s.price >= 0) || Number.isNaN(s.price))) return setErr('Enter a price for every serving you sell');
    const body = { name: f.name, category: f.category, kind: f.kind, trackStock: f.trackStock, stockItem: f.stockItem || null, servings, mixers: f.mixers.filter((m) => m.item).map((m) => ({ item: m.item, quantity: Number(m.quantity), unit: m.unit, measures: m.measures })), notes: f.notes || undefined };
    try { await run(() => (isNew ? api.post('/bar/menu', body) : api.put(`/bar/menu/${item._id}`, body))); toast.success(isNew ? 'Drink added' : 'Drink updated'); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? 'New drink' : `Edit ${item.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">{err && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{err}</div>}
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Drink name" required><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field><Field label="Category"><Input value={f.category} onChange={(e) => set('category', e.target.value)} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="How it is sold"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="spirit">Poured from bottles (30 ml / 60 ml / full bottle)</option><option value="packaged">Counted units (beer, soft drink)</option></Select></Field>
          <Field label="Stock tracking"><Select value={f.trackStock ? 'yes' : 'no'} onChange={(e) => set('trackStock', e.target.value === 'yes')}><option value="yes">Deduct stock when sold</option><option value="no">Not stock-tracked (no deduction)</option></Select></Field></div>
        {f.trackStock && <Field label="Inventory item" required hint={sel ? (f.kind === 'spirit' ? (sel.bottleCapacityMl ? `Bottle capacity: ${sel.bottleCapacityMl} ml` : 'This item has no bottle capacity yet - set it under "Bottle sizes".') : '') : 'Link the item whose stock this drink uses (Inventory & Stores).'}><Select value={f.stockItem} onChange={(e) => set('stockItem', e.target.value)}><option value="">Choose…</option>{(items.data || []).map((x) => <option key={x._id} value={x._id}>{x.name} ({x.category})</option>)}</Select></Field>}
        <div><p className="mb-1.5 text-sm font-semibold text-slate-700">Servings &amp; prices</p><div className="space-y-2">{f.servings.map((s, i) => (
          <div key={s.measure} className={`grid items-end gap-2 rounded-xl p-2 ring-1 sm:grid-cols-[8rem_1fr_1fr_1fr] ${s.on ? 'bg-white ring-slate-300' : 'bg-slate-50 ring-slate-200'}`}>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!s.on} onChange={(e) => setS(i, 'on', e.target.checked)} />{s.measure}</label>
            <Field label="Price" className="!mb-0"><Input type="number" min="0" step="any" disabled={!s.on} value={s.price} onChange={(e) => setS(i, 'price', e.target.value)} /></Field>
            <Field label="Happy-hour price" className="!mb-0"><Input type="number" min="0" step="any" disabled={!s.on} value={s.happyHourPrice} onChange={(e) => setS(i, 'happyHourPrice', e.target.value)} placeholder="optional" /></Field>
            {f.kind === 'spirit' && s.measure !== 'Full bottle' ? <Field label="Measure (ml)" className="!mb-0"><Input type="number" min="1" disabled={!s.on} value={s.ml ?? ''} onChange={(e) => setS(i, 'ml', e.target.value)} /></Field> : <p className="pb-2 text-xs text-slate-500">{f.kind === 'spirit' ? 'Uses the bottle size' : '1 unit'}</p>}</div>))}</div>
          <p className="mt-1 text-xs text-slate-500">A happy-hour price is only used when a happy-hour rule is configured and running (Bar &gt; Settings).</p></div>
        <div><div className="mb-1.5 flex items-center justify-between"><p className="text-sm font-semibold text-slate-700">Mixers used per serving</p><Button size="sm" variant="secondary" onClick={() => set('mixers', [...f.mixers, { item: '', quantity: '', unit: 'pcs', measures: MEASURES }])}><Plus size={13} />Add mixer</Button></div>
          {!f.mixers.length && <p className="text-xs text-slate-500">None. Mixer quantities are never guessed - add one only if this drink really uses it.</p>}
          {f.mixers.map((m, i) => <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]"><Select value={m.item} onChange={(e) => set('mixers', f.mixers.map((x, j) => j === i ? { ...x, item: e.target.value, unit: (items.data || []).find((y) => y._id === e.target.value)?.usageUnit || x.unit } : x))}><option value="">Mixer item…</option>{(items.data || []).filter((x) => !x.isLiquor).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
            <Input type="number" min="0" step="any" placeholder="Qty" value={m.quantity} onChange={(e) => set('mixers', f.mixers.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /><Input placeholder="Unit" value={m.unit} onChange={(e) => set('mixers', f.mixers.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
            <Button size="sm" variant="ghost" onClick={() => set('mixers', f.mixers.filter((_, j) => j !== i))}>Remove</Button></div>)}</div>
      </div>
    </Modal>
  );
}
function CapacityModal({ open, onClose, onDone }) {
  const g = useGet(open ? '/bar/liquor-items' : null); const [vals, setVals] = useState({}); const [run, busy] = useAction();
  const liquor = (g.data || []).filter((x) => x.isLiquor);
  const save = async (it) => { try { await run(() => api.put(`/bar/liquor-items/${it._id}/capacity`, { capacityMl: Number(vals[it._id]) })); toast.success(`${it.name}: bottle size saved`); setVals((v) => ({ ...v, [it._id]: undefined })); g.reload(); onDone(); } catch (e) { toast.error(e.message); } };
  return <Modal open={open} onClose={onClose} title="Bottle sizes" size="lg" footer={<Button onClick={onClose}>Done</Button>}>
    <Notice tone="blue" title="Every liquor item has its own bottle size">A full-bottle sale and every peg are measured against it. Liquor must be stored in ml in Inventory.</Notice>
    <Async state={g} empty={<p className="text-sm text-slate-500">No liquor items yet. Create them in Inventory &amp; Stores (category Liquor, stock unit ml).</p>}>{() => !liquor.length ? <p className="text-sm text-slate-500">No liquor items yet. Create them in Inventory &amp; Stores (category Liquor, stock unit ml).</p> : (
      <ul className="divide-y divide-slate-100">{liquor.map((it) => <li key={it._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span className="font-semibold">{it.name}<span className="block text-xs font-normal text-slate-500">{it.baseUnit !== 'ml' ? <span className="text-red-700">Stock unit is {it.baseUnit} - must be ml</span> : it.bottleCapacityMl ? `${num(it.bottleCapacityMl, 0)} ml per bottle` : 'No bottle size set'}</span></span>
        {it.baseUnit === 'ml' && <span className="flex items-center gap-2"><Input className="!w-28" type="number" min="10" placeholder="ml" value={vals[it._id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [it._id]: e.target.value }))} /><Button size="sm" loading={busy} disabled={!vals[it._id]} onClick={() => save(it)}>Save</Button></span>}</li>)}</ul>)}</Async></Modal>;
}
