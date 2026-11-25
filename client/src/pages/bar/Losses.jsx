import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Tabs, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Filters, Mono, MEASURES, idem, useIdemKey, today, monthStart, num } from './shared';

export default function Losses() {
  const can = useAuth((s) => s.can); const rec = can('bar.loss.record'); const [kind, setKind] = useState('Wastage'); const [form, setForm] = useState(false); const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today());
  const g = useGet(kind === 'Wastage' ? '/bar/wastage' : '/bar/breakage', { from, to, limit: 200 });
  return (
    <div><SubNav can={can} />
      <PageHeader title="Wastage & breakage" subtitle="Drinks and bottles lost - each is a separate record that leaves stock through the inventory engine" actions={rec && <Button onClick={() => setForm(true)}><Trash2 size={15} />Record {kind.toLowerCase()}</Button>} />
      <Tabs items={[{ key: 'Wastage', label: 'Wastage' }, { key: 'Breakage', label: 'Breakage' }]} value={kind} onChange={setKind} />
      <div className="mt-4"><Filters from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
      <Card pad={false}><Async state={g} empty={<EmptyState icon={Trash2} title={`No ${kind.toLowerCase()} recorded`} text="Nothing matches this date range." />}>{(rows) => <Table rows={rows} columns={[
        { header: 'Record', render: (r) => <span><Mono>{r.lossNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(r.occurredAt)} · {r.recordedByName}</span></span> },
        { header: kind === 'Wastage' ? 'Wasted' : 'Broken', render: (r) => <span className="font-semibold">{r.itemName}<span className="block text-xs font-normal text-slate-500">{num(r.quantity)} {r.unit}{r.stockState !== 'unit' ? ` · ${r.stockState} bottle` : ''}</span></span> },
        { header: 'Reason', render: (r) => <span>{r.reason}{r.notes && <span className="block max-w-[16rem] truncate text-xs text-slate-500" title={r.notes}>{r.notes}</span>}{r.supportingRef && <span className="block text-xs text-slate-400">Ref {r.supportingRef}</span>}</span> },
        { header: 'Stock taken out', render: (r) => <span className="text-xs">{(r.consumption || []).map((c) => `${num(c.baseQty)} ${c.unit} ${c.itemName}`).join(', ')}</span> }, { header: 'Status', render: (r) => <Badge tone={r.status === 'Posted' ? 'green' : 'amber'}>{r.status}</Badge> }]} />}</Async></Card>
      <p className="mt-2 text-xs text-slate-500">Records cannot be edited or deleted. A mistake is corrected with a stock adjustment (needs approval) so the history stays intact.</p>
      <LossModal open={form} kind={kind} onClose={() => setForm(false)} onDone={g.reload} />
    </div>
  );
}
function LossModal({ open, kind, onClose, onDone }) {
  const reasons = useGet(open ? '/bar/loss-reasons' : null); const items = useGet(open ? '/bar/liquor-items' : null); const menu = useGet(open ? '/bar/menu' : null);
  const [mode, setMode] = useState('item'); const [f, setF] = useState({ item: '', quantity: '', unit: '', stockState: 'opened', menuItem: '', measure: '30 ml', reason: '', notes: '', supportingRef: '' }); const [run, busy] = useAction(); const key = useIdemKey(); const [err, setErr] = useState('');
  if (!open) return null; const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const it = (items.data || []).find((x) => x._id === f.item); const list = kind === 'Wastage' ? reasons.data?.wastage : reasons.data?.breakage;
  const go = async () => { setErr(''); const body = { quantity: Number(f.quantity), reason: f.reason, notes: f.notes || undefined, supportingRef: f.supportingRef || undefined, ...(mode === 'drink' ? { menuItem: f.menuItem, measure: f.measure } : { item: f.item, unit: f.unit || undefined, ...(it?.isLiquor ? { stockState: f.stockState } : {}) }) };
    try { await run(() => api.post(kind === 'Wastage' ? '/bar/wastage' : '/bar/breakage', body, idem(key.get()))); key.renew(); toast.success(`${kind} recorded`); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} title={`Record ${kind.toLowerCase()}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.reason || !f.quantity || (mode === 'item' ? !f.item : !f.menuItem)} onClick={go}>Record</Button></>}>
    <div className="space-y-3">{err && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
      <Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="item">A stock item (bottle, mixer…)</option><option value="drink">A poured drink (uses its configured stock)</option></Select>
      {mode === 'item' ? <>
        <Field label="Item" required><Select value={f.item} onChange={(e) => set('item', e.target.value)}><option value="">Choose…</option>{(items.data || []).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></Field>
        {it?.isLiquor && <Field label="Which stock" required><Select value={f.stockState} onChange={(e) => set('stockState', e.target.value)}><option value="opened">Opened bottle</option><option value="sealed">Sealed bottle</option></Select></Field>}
        <div className="grid grid-cols-2 gap-3"><Field label="Quantity" required><Input type="number" min="0" step="any" inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
          <Field label="Unit" hint={it ? `Stock unit: ${it.baseUnit}${it.bottleCapacityMl ? ' (or bottle)' : ''}` : ''}><Input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder={it?.baseUnit || 'unit'} /></Field></div></> : <>
        <Field label="Drink" required><Select value={f.menuItem} onChange={(e) => set('menuItem', e.target.value)}><option value="">Choose…</option>{(menu.data || []).filter((x) => x.consumptionStatus === 'Configured').map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Serving"><Select value={f.measure} onChange={(e) => set('measure', e.target.value)}>{MEASURES.map((x) => <option key={x}>{x}</option>)}</Select></Field><Field label="Number of drinks" required><Input type="number" min="1" step="1" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field></div></>}
      <Field label="Reason" required><Select value={f.reason} onChange={(e) => set('reason', e.target.value)}><option value="">Choose…</option>{(list || []).map((x) => <option key={x}>{x}</option>)}</Select></Field>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field><Field label="Supporting reference (optional)"><Input value={f.supportingRef} onChange={(e) => set('supportingRef', e.target.value)} placeholder="Order no., photo ref…" /></Field></div></Modal>;
}
