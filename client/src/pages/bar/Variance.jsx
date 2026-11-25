import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Table, Tabs, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Notice, Mono, VarBadge, idem, useIdemKey, num, signed, tone } from './shared';

export default function Variance() {
  const can = useAuth((s) => s.can); const view = can('bar.variance.view'); const rec = can('bar.variance.record'); const [tab, setTab] = useState(view ? 'history' : 'count'); const [count, setCount] = useState(false); const [detail, setDetail] = useState(null);
  const hist = useGet(view ? '/bar/variance' : null, { limit: 100 }); const alerts = useGet(view ? '/bar/variance/alerts' : null);
  const ack = async (a) => { try { await api.post(`/bar/variance/alerts/${a._id}/acknowledge`); alerts.reload(); } catch (e) { toast.error(e.message); } };
  const openAlerts = (alerts.data || []).filter((a) => !a.acknowledgedAt).length;
  return (
    <div><SubNav can={can} />
      <PageHeader title="Stock count & variance" subtitle="Count what is physically there and compare it with what the records say should be there" actions={rec && <Button onClick={() => setCount(true)}><ClipboardCheck size={15} />Count stock</Button>} />
      <Tabs items={[...(view ? [{ key: 'history', label: 'Counts', count: hist.data?.length }, { key: 'alerts', label: 'Alerts', count: openAlerts || undefined }] : [])]} value={tab} onChange={setTab} />
      {tab === 'history' && <Card pad={false} className="mt-4"><Async state={hist} empty={<EmptyState icon={ClipboardCheck} title="No stock counts yet" text="Record a count to compare expected and actual bar stock." />}>{(rows) => <Table rows={rows} onRow={setDetail} columns={[
        { header: 'Count', render: (r) => <span><Mono>{r.reconNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(r.countedAt)} · {r.countedByName}</span></span> },
        { header: 'Items', className: 'text-right', render: (r) => r.lines.length }, { header: 'With variance', className: 'text-right', render: (r) => r.linesWithVariance ? <Badge tone="red">{r.linesWithVariance}</Badge> : <Badge tone="green">None</Badge> }, { header: 'Notes', render: (r) => r.notes || '-' }]} />}</Async></Card>}
      {tab === 'alerts' && <Card pad={false} className="mt-4"><Async state={alerts} empty={<EmptyState title="No variance alerts" />}>{(rows) => <Table rows={rows} columns={[
        { header: 'When', render: (a) => fmtDateTime(a.createdAt) }, { header: 'Item', render: (a) => <span className="font-semibold">{a.itemName}<span className="block text-xs font-normal text-slate-500">{a.sourceLabel}</span></span> },
        { header: 'Variance', className: 'text-right', render: (a) => <span className={tone(a.varianceQ)}><b>{signed(a.varianceQ)} {a.baseUnit}</b>{a.variancePegs != null && <span className="block text-xs">{signed(a.variancePegs)} pegs</span>}</span> },
        { header: 'Sent to', render: (a) => a.usedFallback ? <span className="text-xs text-amber-800">Everyone with variance access (no recipients configured)</span> : `${a.recipientCount} recipient(s)` },
        { header: '', render: (a) => a.acknowledgedAt ? <Badge tone="slate">Acknowledged</Badge> : <Button size="sm" variant="secondary" onClick={() => ack(a)}>Acknowledge</Button> }]} />}</Async></Card>}
      <CountModal open={count} onClose={() => setCount(false)} onDone={() => { hist.reload(); alerts.reload(); setTab('history'); }} />
      <DetailModal id={detail?._id} onClose={() => setDetail(null)} onChanged={hist.reload} can={can} />
    </div>
  );
}
function CountModal({ open, onClose, onDone }) {
  const g = useGet(open ? '/bar/variance/expected' : null); const [v, setV] = useState({}); const [notes, setNotes] = useState(''); const [run, busy] = useAction(); const key = useIdemKey(); const [err, setErr] = useState(''); const can = useAuth((s) => s.can); const sees = can('bar.variance.view');
  useEffect(() => { if (open) { setV({}); setNotes(''); setErr(''); } }, [open]);
  const set = (id, k, x) => setV((s) => ({ ...s, [id]: { ...s[id], [k]: x } }));
  const submit = async () => { setErr(''); const items = g.data.items; const counts = []; for (const it of items) { const c = v[it.item]; if (!c || (it.isLiquor ? c.sealed === '' || c.sealed == null || c.open === '' || c.open == null : c.qty === '' || c.qty == null)) continue;
      counts.push(it.isLiquor ? { item: it.item, sealedBottles: Number(c.sealed), openMl: Number(c.open) } : { item: it.item, quantity: Number(c.qty) }); }
    if (!counts.length) return setErr('Enter the count for at least one item');
    try { const r = await run(() => api.post('/bar/variance', { counts, notes: notes || undefined }, idem(key.get()))); key.renew(); toast.success(`${r.data.data.reconNumber} recorded${r.data.alertsRaised ? ` - ${r.data.alertsRaised} alert(s) raised` : ''}`); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return <Modal open={open} onClose={onClose} size="xl" title="Count bar stock" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Record count</Button></>}>
    <Async state={g}>{(d) => (<div className="space-y-3">
      {!d.tolerance.configured && <Notice title="No variance tolerance is configured yet">Every difference is reported until the hotel sets a tolerance in Bar &gt; Settings.</Notice>}
      <p className="text-sm text-slate-600">Count the sealed bottles and measure the ml left in opened bottles. Leave an item blank to skip it. A count never changes stock by itself.</p>
      {err && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
      <div className="space-y-2">{d.items.map((it) => (<div key={it.item} className="grid items-end gap-2 rounded-xl p-2 ring-1 ring-slate-200 sm:grid-cols-[1fr_9rem_9rem]">
        <p className="text-sm font-semibold">{it.name}<span className="block text-xs font-normal text-slate-500">{it.isLiquor ? `${num(it.capacityMl, 0)} ml bottle` : it.baseUnit}{sees && <> · expected {it.isLiquor ? `${num(it.expectedSealedBottles)} sealed + ${num(it.expectedOpenQ, 0)} ml opened` : `${num(it.expectedQ)} ${it.baseUnit}`}</>}</span></p>
        {it.isLiquor ? <><Field label="Sealed bottles" className="!mb-0"><Input type="number" min="0" step="1" inputMode="numeric" value={v[it.item]?.sealed ?? ''} onChange={(e) => set(it.item, 'sealed', e.target.value)} /></Field><Field label="Opened (ml)" className="!mb-0"><Input type="number" min="0" step="any" inputMode="decimal" value={v[it.item]?.open ?? ''} onChange={(e) => set(it.item, 'open', e.target.value)} /></Field></>
          : <Field label={`Counted (${it.baseUnit})`} className="!mb-0 sm:col-span-2"><Input type="number" min="0" step="any" inputMode="decimal" value={v[it.item]?.qty ?? ''} onChange={(e) => set(it.item, 'qty', e.target.value)} /></Field>}</div>))}</div>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>)}</Async></Modal>;
}
function DetailModal({ id, onClose, onChanged, can }) {
  const g = useGet(id ? `/bar/variance/${id}` : null); const [run, busy] = useAction(); const adj = can('bar.variance.adjust');
  const ask = async (l) => { try { await run(() => api.post(`/bar/variance/${id}/lines/${l._id}/adjust`, {})); toast.success('Adjustment sent for approval'); g.reload(); onChanged(); } catch (e) { toast.error(e.message); } };
  return <Modal open={!!id} onClose={onClose} size="xl" title={g.data ? `${g.data.reconNumber} · ${fmtDateTime(g.data.countedAt)}` : 'Stock count'} footer={<Button onClick={onClose}>Close</Button>}>
    <Async state={g}>{(d) => (<div className="space-y-3"><p className="text-xs text-slate-500">Counted by {d.countedByName}. Counts are permanent records; a variance changes stock only through an approved stock adjustment.</p>
      <Table rows={d.lines} columns={[{ header: 'Item', render: (l) => <span className="font-semibold">{l.itemName}</span> },
        { header: 'Expected', className: 'text-right', render: (l) => l.isLiquor ? <span>{num(l.expectedQ, 0)} ml<span className="block text-xs text-slate-500">{num(l.expectedSealedBottles)} sealed + {num(l.expectedOpenQ, 0)} open</span></span> : `${num(l.expectedQ)} ${l.baseUnit}` },
        { header: 'Counted', className: 'text-right', render: (l) => l.isLiquor ? <span>{num(l.countedQ, 0)} ml<span className="block text-xs text-slate-500">{l.countedSealedBottles} sealed + {num(l.countedOpenQ, 0)} open</span></span> : `${num(l.countedQ)} ${l.baseUnit}` },
        { header: 'Variance', className: 'text-right', render: (l) => <span className={tone(l.varianceQ)}><b>{signed(l.varianceQ)} {l.baseUnit}</b>{l.isLiquor && <span className="block text-xs">{signed(l.variancePegs)} pegs · {signed(l.varianceBottles, 3)} btl</span>}</span> }, { header: '', render: (l) => <VarBadge line={l} /> },
        { header: 'Adjustment', render: (l) => l.adjustment?.status ? <Badge tone={l.adjustment.status === 'Applied' ? 'green' : l.adjustment.status === 'Rejected' ? 'red' : 'amber'}>{l.adjustment.status}</Badge> : (adj && l.varianceQ ? <Button size="sm" variant="secondary" loading={busy} onClick={() => ask(l)}>Request adjustment</Button> : '-') }]} />
      <details className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold">How the expected figure was worked out</summary>
        <Table dense rows={d.lines} columns={['opening', 'received', 'sold', 'complimentary', 'wastage', 'breakage', 'adjustments', 'other'].map((k) => ({ header: k, className: 'text-right', render: (l) => num(l.breakdown?.[k], 0) })).reduce((a, c) => a.concat(c), [{ header: 'Item', render: (l) => l.itemName }])} /></details>
      {d.notes && <p className="text-sm"><b>Notes:</b> {d.notes}</p>}</div>)}</Async></Modal>;
}
