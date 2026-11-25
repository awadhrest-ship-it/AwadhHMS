import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck, Plus } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Textarea } from '../../components/ui';
import { ConfirmDialog, Modal } from '../../components/feedback';
import { fmtDateTime } from '../../utils/format';
import { InfoBox, ItemPicker, qtyFmt, useInvScope } from './shared';

const ST_TONE = { Counting: 'blue', Submitted: 'amber', Resolved: 'green', Cancelled: 'slate' };
const LINE_TONE = { 'Not Counted': 'slate', Matched: 'green', Variance: 'red', 'Adjustment Requested': 'amber', Adjusted: 'green', Rejected: 'red', Explained: 'blue' };

function Start({ open, onClose, onStarted }) {
  const { departments } = useInvScope(); const cats = useGet(open ? '/inventory/categories' : null);
  const [f, setF] = useState({ department: '', category: '', notes: '' }); const [err, setErr] = useState(''); const [run, busy] = useAction();
  useEffect(() => { if (open) { setF({ department: departments.length === 1 ? departments[0] : '', category: '', notes: '' }); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setErr(''); try { const r = await run(() => api.post('/inventory/stocktakes', { department: f.department, category: f.category || undefined, notes: f.notes || undefined })); toast.success('Count sheet created'); onStarted(r.data.data); } catch (e) { setErr(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title="Start a stock count" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.department} onClick={go}>Create count sheet</Button></>}>
      <div className="space-y-3">
        <InfoBox>The sheet lists the department's items with the quantity the system expects at this moment. Count what is physically on the shelf, then submit. Stock is only corrected through an approved adjustment.</InfoBox>
        <Field label="Department" required><Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="" disabled>Select…</option>{departments.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Only this category (optional)"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{(cats.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function Sheet({ id }) {
  const can = useAuth((s) => s.can); const nav = useNavigate();
  const st = useGet(`/inventory/stocktakes/${id}`, null, [id]);
  const [counts, setCounts] = useState({}); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [sel, setSel] = useState({}); const [adj, setAdj] = useState(false); const [reason, setReason] = useState(''); const [explain, setExplain] = useState(null); const [note, setNote] = useState(''); const [cancel, setCancel] = useState(false); const [result, setResult] = useState(null);
  const d = st.data;
  useEffect(() => { if (d && d.status === 'Counting') setCounts(Object.fromEntries(d.lines.map((l) => [l._id, l.countedQty == null ? '' : String(l.countedQty)]))); }, [d?._id, d?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, ok) => { setErr(''); try { const r = await run(fn); if (ok) toast.success(ok); st.reload(); return r; } catch (e) { setErr(e.message); return null; } };
  const dirty = d?.status === 'Counting' ? d.lines.filter((l) => (counts[l._id] ?? '') !== (l.countedQty == null ? '' : String(l.countedQty))) : [];
  const save = () => act(() => api.put(`/inventory/stocktakes/${id}/counts`, { counts: dirty.map((l) => ({ lineId: l._id, quantity: counts[l._id] === '' ? null : Number(counts[l._id]) })) }), 'Counts saved');
  const submit = async () => { if (dirty.length) { const r = await save(); if (!r) return; } await act(() => api.post(`/inventory/stocktakes/${id}/submit`, {}), 'Count submitted'); };
  const open = d?.lines.filter((l) => ['Variance', 'Rejected'].includes(l.status)) || [];
  const chosen = open.filter((l) => sel[l._id]);
  const requestAdj = async () => { const r = await act(() => api.post(`/inventory/stocktakes/${id}/request-adjustment`, { lineIds: chosen.map((l) => l._id), reason: reason.trim() || undefined })); if (r) { setAdj(false); setSel({}); setResult(r.data); } };
  const doExplain = async () => { const r = await act(() => api.post(`/inventory/stocktakes/${id}/lines/${explain._id}/explain`, { note: note.trim() }), 'Marked as explained'); if (r) { setExplain(null); setNote(''); } };
  return (
    <Async state={st} isEmpty={() => false}>{(s) => (
      <>
        <PageHeader back={<Link to="/inventory/stocktakes" className="text-xs font-semibold text-brand-700">← All stock counts</Link>} title={s.stocktakeNumber} subtitle={`${s.department} · started ${fmtDateTime(s.createdAt)}`}
          actions={<><Badge tone={ST_TONE[s.status]}>{s.status}</Badge>{s.status === 'Counting' && can('inventory.stocktake') && <Button variant="secondary" onClick={() => setCancel(true)}>Cancel count</Button>}</>} />
        {s.notes && <p className="mb-3 text-sm text-slate-600">{s.notes}</p>}
        {result && <div className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900" role="status">Adjustment submitted for approval ({result.approval?.requestNumber}). Stock will not change until it is approved. <Link to="/approvals" className="font-semibold underline">Open approvals</Link></div>}
        {err && <p className="mb-3 text-sm text-red-600" role="alert">{err}</p>}
        <Card pad={false} title={s.status === 'Counting' ? 'Count sheet' : 'Count result'}>
          <Table dense rows={s.lines} columns={[
            ...(s.status === 'Submitted' && can('inventory.adjust') ? [{ header: '', render: (l) => (['Variance', 'Rejected'].includes(l.status) ? <input type="checkbox" aria-label={`Select ${l.itemName}`} checked={!!sel[l._id]} onChange={(e) => setSel({ ...sel, [l._id]: e.target.checked })} /> : null) }] : []),
            { header: 'Item', render: (l) => <span className="font-semibold">{l.itemName}<span className="block text-xs font-normal text-slate-400">{l.sku}</span></span> },
            { header: 'System', className: 'text-right', render: (l) => `${qtyFmt(l.systemQty)} ${l.baseUnit}` },
            { header: 'Counted', className: 'text-right', render: (l) => (s.status === 'Counting' ? <span className="inline-flex items-center gap-1"><Input aria-label={`Counted ${l.itemName}`} className="w-28 text-right" type="number" min="0" step="any" inputMode="decimal" value={counts[l._id] ?? ''} onChange={(e) => setCounts({ ...counts, [l._id]: e.target.value })} /><span className="text-xs text-slate-400">{l.baseUnit}</span></span> : l.countedQty == null ? '—' : `${qtyFmt(l.countedQty)} ${l.baseUnit}`) },
            { header: 'Difference', className: 'text-right', render: (l) => (l.countedQty == null ? '—' : <b className={l.variance < 0 ? 'text-red-600' : l.variance > 0 ? 'text-amber-600' : 'text-green-700'}>{l.variance > 0 ? '+' : ''}{qtyFmt(l.variance)}</b>) },
            { header: 'Status', render: (l) => <div><Badge tone={LINE_TONE[l.status]}>{l.status}</Badge>{l.resolutionNote && <p className="mt-1 text-xs text-slate-500">{l.resolutionNote}</p>}</div> },
            ...(s.status === 'Submitted' && can('inventory.adjust') ? [{ header: '', render: (l) => (['Variance', 'Rejected'].includes(l.status) ? <Button size="sm" variant="secondary" onClick={() => { setExplain(l); setNote(''); }}>No adjustment needed</Button> : null) }] : []),
          ]} />
        </Card>
        {s.status === 'Counting' && can('inventory.stocktake') && (
          <div className="mt-4 space-y-3">
            <div className="max-w-md"><Field label="Add an item that is not on the sheet"><ItemPicker value={null} onChange={(it) => it && act(() => api.post(`/inventory/stocktakes/${id}/lines`, { item: it._id }), 'Item added')} label="Add item to count" /></Field></div>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" loading={busy} disabled={!dirty.length} onClick={save}>Save counts{dirty.length ? ` (${dirty.length})` : ''}</Button><Button loading={busy} onClick={submit}>Submit count</Button></div>
            <p className="text-xs text-slate-500">Items left blank are treated as not counted and are left out of the result. Submitting does not change stock.</p>
          </div>
        )}
        {s.status === 'Submitted' && can('inventory.adjust') && open.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={!chosen.length} onClick={() => { setReason(''); setAdj(true); }}>Request adjustment for {chosen.length || ''} selected</Button><span className="text-xs text-slate-500">Goes to an approver. Stock only changes once approved.</span></div>}
        {s.status === 'Submitted' && !can('inventory.adjust') && open.length > 0 && <InfoBox tone="amber">There are discrepancies. A user with adjustment permission must raise the adjustment request.</InfoBox>}
        <Modal open={adj} onClose={() => setAdj(false)} title="Request stock adjustment" footer={<><Button variant="secondary" onClick={() => setAdj(false)}>Cancel</Button><Button loading={busy} onClick={requestAdj}>Submit for approval</Button></>}>
          <div className="space-y-3 text-sm"><p>{chosen.length} item{chosen.length === 1 ? '' : 's'} will be corrected to the counted quantity <b>after approval</b>:</p>
            <ul className="list-disc pl-5">{chosen.map((l) => <li key={l._id}>{l.itemName}: {l.variance > 0 ? '+' : ''}{qtyFmt(l.variance)} {l.baseUnit}</li>)}</ul>
            <Field label="Reason (optional)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        </Modal>
        <Modal open={!!explain} onClose={() => setExplain(null)} title="No adjustment needed" footer={<><Button variant="secondary" onClick={() => setExplain(null)}>Cancel</Button><Button loading={busy} disabled={note.trim().length < 3} onClick={doExplain}>Save explanation</Button></>}>
          <p className="mb-3 text-sm text-slate-600">{explain?.itemName}: system {qtyFmt(explain?.systemQty)}, counted {qtyFmt(explain?.countedQty)} {explain?.baseUnit}. Explain why stock should stay as it is.</p>
          <Field label="Explanation" required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Modal>
        <ConfirmDialog open={cancel} onClose={() => setCancel(false)} danger title="Cancel this count?" message="The count sheet is discarded. Stock is not affected." confirmLabel="Cancel count" busy={busy} onConfirm={async () => { const r = await act(() => api.post(`/inventory/stocktakes/${id}/cancel`, {}), 'Count cancelled'); if (r) { setCancel(false); nav('/inventory/stocktakes'); } }} />
      </>
    )}</Async>
  );
}

export default function Stocktakes() {
  const { id } = useParams(); const can = useAuth((s) => s.can); const nav = useNavigate();
  const [start, setStart] = useState(false); const [status, setStatus] = useState('');
  const st = useGet(id ? null : '/inventory/stocktakes', { status: status || undefined });
  if (id) return <Sheet id={id} />;
  return (
    <>
      <PageHeader title="Stock count" subtitle="Physical verification against the system balance" actions={can('inventory.stocktake') && <Button onClick={() => setStart(true)}><Plus size={16} />Start a count</Button>} />
      <Card pad={false}>
        <div className="border-b border-slate-100 p-4 sm:w-64"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(ST_TONE).map((s) => <option key={s}>{s}</option>)}</Select></div>
        <Async state={st} empty={<EmptyState icon={ClipboardCheck} title="No stock counts yet" text="Start a count to compare the shelf with the system." />}>{(rows) => (
          <Table rows={rows} onRow={(r) => nav(`/inventory/stocktakes/${r._id}`)} columns={[{ header: 'Count', render: (r) => <span className="font-mono text-xs font-semibold">{r.stocktakeNumber}</span> }, { header: 'Department', key: 'department' }, { header: 'Items', render: (r) => r.lines.length },
            { header: 'Differences', render: (r) => { const n = r.lines.filter((l) => l.status !== 'Matched' && l.countedQty != null && Math.abs(l.variance) > 1e-6).length; return n ? <Badge tone="red">{n}</Badge> : <span className="text-slate-400">—</span>; } },
            { header: 'Status', render: (r) => <Badge tone={ST_TONE[r.status]}>{r.status}</Badge> }, { header: 'Started', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span> }]} />
        )}</Async>
      </Card>
      <Start open={start} onClose={() => setStart(false)} onStarted={(s) => { setStart(false); nav(`/inventory/stocktakes/${s._id}`); }} />
    </>
  );
}
