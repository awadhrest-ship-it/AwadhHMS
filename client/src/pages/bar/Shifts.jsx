import { useEffect, useState } from 'react';
import { PlayCircle, Square } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Notice, SHIFT_TONE, VarBadge, Mono, rs, num, signed, tone } from './shared';

export default function Shifts() {
  // the API returns data:null when there is no open shift (useGet would otherwise hand back the whole response body)
  const can = useAuth((s) => s.can); const work = can('bar.shift.work'); const manage = can('bar.shift.manage'); const curG = useGet(work ? '/bar/shifts/current' : null); const cur = { ...curG, data: curG.raw ? curG.raw.data : null }; const list = useGet('/bar/shifts', { limit: 60 }); const settings = useGet('/bar/settings');
  const [start, setStart] = useState(false); const [close, setClose] = useState(null); const [detail, setDetail] = useState(null); const reload = () => { curG.reload(); list.reload(); };
  return (
    <div><SubNav can={can} />
      <PageHeader title="Bartender shifts" subtitle="Start a shift, work it, then count the stock and close it" />
      {!settings.data?.shifts?.definitions?.length && settings.data && <Notice tone="blue" title="Shift timings are not defined">The hotel has not set its shifts, so you simply start a shift when you begin and close it when you finish.</Notice>}
      {work && <Card title="My shift" className="mb-4">{cur.data ? <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold"><Mono>{cur.data.shiftNumber}</Mono> <Badge tone={SHIFT_TONE[cur.data.status]}>{cur.data.status}</Badge></p><p className="text-sm text-slate-500">{cur.data.definition ? `${cur.data.definition} · ` : ''}started {fmtDateTime(cur.data.startedAt)}</p></div>
        <Button onClick={() => setClose(cur.data)}><Square size={15} />Count stock &amp; close shift</Button></div> : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">You have no open shift.</p><Button onClick={() => setStart(true)}><PlayCircle size={15} />Start shift</Button></div>}</Card>}
      <Card title={manage ? 'All shifts' : 'My shifts'} pad={false}><Async state={list} empty={<EmptyState title="No shifts yet" />}>{(rows) => <Table rows={rows} onRow={setDetail} columns={[
        { header: 'Shift', render: (s) => <span><Mono>{s.shiftNumber}</Mono><span className="block text-xs text-slate-500">{s.bartenderName}{s.definition ? ` · ${s.definition}` : ''}</span></span> }, { header: 'Started', render: (s) => fmtDateTime(s.startedAt) }, { header: 'Ended', render: (s) => s.endedAt ? fmtDateTime(s.endedAt) : '-' },
        { header: 'Sales', className: 'text-right', render: (s) => s.closing?.sales ? rs(s.closing.sales.revenue) : '-' }, { header: 'Variance', className: 'text-right', render: (s) => s.status === 'Closed' ? (s.closing.linesWithVariance ? <Badge tone="red">{s.closing.linesWithVariance} item(s)</Badge> : <Badge tone="green">None</Badge>) : '-' },
        { header: 'Status', render: (s) => <span><Badge tone={SHIFT_TONE[s.status]}>{s.status}</Badge>{s.revision > 0 && <Badge tone="amber" className="ml-1">Corrected</Badge>}</span> }]} />}</Async></Card>
      <StartModal open={start} defs={settings.data?.shifts?.definitions || []} onClose={() => setStart(false)} onDone={reload} />
      <CloseModal shift={close} onClose={() => setClose(null)} onDone={reload} />
      <DetailModal id={detail?._id} manage={manage} onClose={() => setDetail(null)} onChanged={reload} />
    </div>
  );
}
function StartModal({ open, defs, onClose, onDone }) {
  const [def, setDef] = useState(''); const [notes, setNotes] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState(''); useEffect(() => { if (open) { setErr(''); setDef(defs[0]?.name || ''); } }, [open, defs]);
  const go = async () => { try { await run(() => api.post('/bar/shifts', { definition: def || undefined, notes: notes || undefined })); toast.success('Shift started'); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return <Modal open={open} onClose={onClose} size="sm" title="Start shift" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Start</Button></>}>
    <div className="space-y-3">{err && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}<p className="text-sm text-slate-600">The current stock of every bar item is recorded as your opening stock.</p>
      {defs.length > 0 ? <Field label="Shift" required><Select value={def} onChange={(e) => setDef(e.target.value)}>{defs.map((d) => <option key={d.name} value={d.name}>{d.name}{d.start ? ` (${d.start}-${d.end})` : ''}</option>)}</Select></Field> : <Field label="Label (optional)"><Input value={def} onChange={(e) => setDef(e.target.value)} placeholder="e.g. Evening" /></Field>}
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div></Modal>;
}
function CountFields({ items, v, setV, showExpected }) {
  const set = (id, k, x) => setV((s) => ({ ...s, [id]: { ...s[id], [k]: x } }));
  return <div className="space-y-2">{items.map((it) => (<div key={it.item} className="grid items-end gap-2 rounded-xl p-2 ring-1 ring-slate-200 sm:grid-cols-[1fr_9rem_9rem]">
    <p className="text-sm font-semibold">{it.name}<span className="block text-xs font-normal text-slate-500">Opening {it.isLiquor ? `${num(it.openingQ, 0)} ml (${num(it.openingOpenQ, 0)} opened)` : `${num(it.openingQ)} ${it.baseUnit}`}{showExpected && it.expectedQ != null && <> · expected now {num(it.expectedQ, 0)} {it.baseUnit}</>}</span></p>
    {it.isLiquor ? <><Field label="Sealed bottles" className="!mb-0"><Input type="number" min="0" step="1" inputMode="numeric" value={v[it.item]?.sealed ?? ''} onChange={(e) => set(it.item, 'sealed', e.target.value)} /></Field><Field label="Opened (ml)" className="!mb-0"><Input type="number" min="0" step="any" inputMode="decimal" value={v[it.item]?.open ?? ''} onChange={(e) => set(it.item, 'open', e.target.value)} /></Field></>
      : <Field label={`Counted (${it.baseUnit})`} className="!mb-0 sm:col-span-2"><Input type="number" min="0" step="any" inputMode="decimal" value={v[it.item]?.qty ?? ''} onChange={(e) => set(it.item, 'qty', e.target.value)} /></Field>}</div>))}</div>;
}
const toCounts = (items, v) => items.filter((it) => { const c = v[it.item]; return c && (it.isLiquor ? c.sealed !== '' && c.sealed != null && c.open !== '' && c.open != null : c.qty !== '' && c.qty != null); }).map((it) => { const c = v[it.item]; return it.isLiquor ? { item: it.item, sealedBottles: Number(c.sealed), openMl: Number(c.open) } : { item: it.item, quantity: Number(c.qty) }; });
function CloseModal({ shift, onClose, onDone }) {
  const g = useGet(shift ? `/bar/shifts/${shift._id}/sheet` : null); const [v, setV] = useState({}); const [notes, setNotes] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [res, setRes] = useState(null);
  useEffect(() => { if (shift) { setV({}); setNotes(''); setErr(''); setRes(null); } }, [shift]);
  if (!shift) return null;
  const go = async () => { setErr(''); try { const r = await run(() => api.post(`/bar/shifts/${shift._id}/close`, { counts: toCounts(g.data.items, v), notes: notes || undefined })); setRes(r.data.data); onDone(); } catch (e) { setErr(e.message); } };
  if (res) return <Modal open onClose={onClose} size="xl" title={`${res.shiftNumber} closed`} footer={<Button onClick={onClose}>Done</Button>}><ClosingReport shift={res} /></Modal>;
  return <Modal open onClose={onClose} size="xl" title={`Close ${shift.shiftNumber}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Close shift</Button></>}>
    <Async state={g}>{(d) => (<div className="space-y-3">{!d.tolerance.configured && <Notice title="No variance tolerance is configured">Every difference will be reported.</Notice>}
      <p className="text-sm text-slate-600">Count every item. Sealed bottles are whole bottles; measure the ml left in opened bottles. A closed shift cannot be closed again.</p>{err && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
      <CountFields items={d.items} v={v} setV={setV} showExpected={!d.blindCount} /><Field label="Closing notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>)}</Async></Modal>;
}
function ClosingReport({ shift }) {
  const c = shift.closing; if (!c) return <p className="text-sm text-slate-500">This shift is still open.</p>;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Orders', c.sales?.orders], ['Drinks sold', c.sales?.drinks], ['Sales', rs(c.sales?.revenue)], ['Complimentary drinks', c.complimentary?.drinks], ['Wastage records', c.wastage?.records], ['Breakage records', c.breakage?.records], ['Items with variance', c.linesWithVariance]].map(([l, x]) => <div key={l} className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10px] font-semibold uppercase text-slate-500">{l}</p><p className="text-lg font-extrabold">{x ?? 0}</p></div>)}</div>
    {c.sales?.byMeasure && <p className="text-xs text-slate-600">Sold by measure: {Object.entries(c.sales.byMeasure).map(([k, x]) => `${x} × ${k}`).join(' · ') || 'none'}</p>}
    <Table rows={c.lines} rowKey="item" columns={[{ header: 'Item', render: (l) => <span className="font-semibold">{l.itemName}</span> }, { header: 'Opening', className: 'text-right', render: (l) => num(l.openingQ, 0) },
      ...['received', 'sold', 'complimentary', 'wastage', 'breakage'].map((k) => ({ header: k, className: 'text-right', render: (l) => num(l.breakdown?.[k], 0) })),
      { header: 'Expected', className: 'text-right', render: (l) => <b>{num(l.expectedQ, 0)}</b> }, { header: 'Counted', className: 'text-right', render: (l) => <b>{num(l.countedQ, 0)}</b> },
      { header: 'Variance', className: 'text-right', render: (l) => <span className={tone(l.varianceQ)}><b>{signed(l.varianceQ)} {l.baseUnit}</b>{l.isLiquor && <span className="block text-xs">{signed(l.variancePegs)} pegs</span>}</span> }, { header: '', render: (l) => <VarBadge line={l} /> }]} />
    <p className="text-xs text-slate-500">Quantities in ml for liquor and in the item's own unit for other stock. Outflows (sold, complimentary, wastage, breakage) are shown as negative numbers.</p></div>;
}
function DetailModal({ id, manage, onClose, onChanged }) {
  const g = useGet(id ? `/bar/shifts/${id}` : null); const [corr, setCorr] = useState(false);
  return <Modal open={!!id} onClose={onClose} size="xl" title={g.data ? `${g.data.shiftNumber} · ${g.data.bartenderName}` : 'Shift'} footer={<>{manage && g.data?.status === 'Closed' && <Button variant="secondary" onClick={() => setCorr(true)}>Correct count</Button>}<Button onClick={onClose}>Close</Button></>}>
    <Async state={g}>{(s) => (<div className="space-y-3"><p className="text-sm text-slate-600">{fmtDateTime(s.startedAt)} → {s.endedAt ? fmtDateTime(s.endedAt) : 'open'}{s.closedByName ? ` · closed by ${s.closedByName}` : ''}{s.closingNotes ? ` · ${s.closingNotes}` : ''}</p>
      {s.status === 'Open' && s.liveActivity && <p className="text-sm">So far: {s.liveActivity.sales.orders} order(s), {s.liveActivity.sales.drinks} drink(s), {rs(s.liveActivity.sales.revenue)}.</p>}
      <ClosingReport shift={s} />
      {s.corrections?.length > 0 && <div><p className="mb-1 text-sm font-semibold">Corrections (original figures are kept)</p><ul className="space-y-1 text-xs text-slate-600">{s.corrections.map((c, i) => <li key={i} className="rounded-lg bg-amber-50 p-2">{fmtDateTime(c.at)} · {c.byName}: {c.reason}</li>)}</ul></div>}</div>)}</Async>
    <CorrectModal open={corr} shift={g.data} onClose={() => setCorr(false)} onDone={() => { g.reload(); onChanged(); }} /></Modal>;
}
function CorrectModal({ open, shift, onClose, onDone }) {
  const [v, setV] = useState({}); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState(''); useEffect(() => { if (open) { setV({}); setReason(''); setErr(''); } }, [open]);
  if (!open || !shift?.closing) return null; const items = shift.closing.lines.map((l) => ({ item: l.item, name: l.itemName, isLiquor: l.isLiquor, baseUnit: l.baseUnit, openingQ: l.openingQ, openingOpenQ: l.openingOpenQ }));
  const go = async () => { setErr(''); try { await run(() => api.post(`/bar/shifts/${shift._id}/correct`, { reason, counts: toCounts(items, v) })); toast.success('Correction recorded'); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} size="xl" title={`Correct ${shift.shiftNumber}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={reason.trim().length < 10} onClick={go}>Save correction</Button></>}>
    <div className="space-y-3"><Notice title="The original figures are kept">Only fill in the items whose count was wrong. Your name, the time and the reason are recorded.</Notice>{err && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
      <CountFields items={items} v={v} setV={setV} /><Field label="Reason for the correction" required hint="At least 10 characters"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div></Modal>;
}
