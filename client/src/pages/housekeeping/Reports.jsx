import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileWarning, Plus } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, EmptyState, Field, Input, PageHeader, Pills, Select, Table, Tabs, Textarea, TBC } from '../../components/ui';
import { Drawer } from '../../components/feedback';
import { AuthImage, PhotoPicker, uploadPhoto } from '../../components/media';
import { ReportForm } from '../../components/hk';
import { HK_REPORT_KINDS, HK_REPORT_TONE } from '../../utils/constants';
import { fmtDateTime, money } from '../../utils/format';

const FLOW = { Damage: ['Reported', 'Under Review', 'Resolved', 'Closed'], 'Missing Item': ['Reported', 'Under Review', 'Recovered', 'Written Off', 'Closed'], 'Lost & Found': ['Found', 'In Storage', 'Returned', 'Disposed'] };
const TERMINAL = ['Closed', 'Returned', 'Disposed', 'Written Off'];

function Detail({ id, onClose, onChanged }) {
  const can = useAuth((s) => s.can); const manage = can('housekeeping.assign') || can('housekeeping.inspect');
  const st = useGet(id ? `/housekeeping/reports/${id}` : null, null, [id]); const [run, busy] = useAction();
  const [status, setStatus] = useState(''); const [note, setNote] = useState(''); const [claim, setClaim] = useState({ name: '', phone: '', idChecked: '' }); const [err, setErr] = useState('');
  const r = st.data; const locked = r && TERMINAL.includes(r.status);
  const save = async () => {
    setErr('');
    try { await run(() => api.patch(`/housekeeping/reports/${id}`, { status, note: note || undefined, ...(status === 'Returned' ? { claim } : {}) })); toast.success('Report updated'); setStatus(''); setNote(''); st.reload(); onChanged(); }
    catch (e) { setErr(e.message); }
  };
  const addPhoto = async (blob) => { await uploadPhoto(`/housekeeping/reports/${id}/photos`, blob); st.reload(); };
  return (
    <Drawer open={!!id} onClose={onClose} title={r?.reportNumber || 'Report'} subtitle={r && `${r.kind}${r.room ? ` · Room ${r.room.roomNumber}` : ''}`} width="max-w-lg">
      <Async state={st} isEmpty={() => false}>{(d) => (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5"><Badge tone={HK_REPORT_TONE[d.status]}>{d.status}</Badge>{d.severity && <Badge tone={d.severity === 'Severe' ? 'red' : d.severity === 'Moderate' ? 'orange' : 'slate'}>{d.severity}</Badge>}</div>
          <p className="text-base font-bold">{d.title}</p>
          {d.description && <p className="rounded-xl bg-slate-50 p-3">{d.description}</p>}
          <dl className="grid grid-cols-2 gap-3">
            {d.location && <div><dt className="label">Location</dt><dd>{d.location}</dd></div>}{d.task && <div><dt className="label">Task</dt><dd>{d.task.taskNumber}</dd></div>}
            {d.quantity != null && d.kind === 'Missing Item' && <div><dt className="label">Quantity</dt><dd>{d.quantity}</dd></div>}{d.estimatedValue != null && <div><dt className="label">Estimated value</dt><dd>{money(d.estimatedValue)}</dd></div>}
            {d.storageLocation && <div><dt className="label">Stored at</dt><dd>{d.storageLocation}</dd></div>}{d.identifyingMarks && <div><dt className="label">Identifying marks</dt><dd>{d.identifyingMarks}</dd></div>}
            <div><dt className="label">Reported by</dt><dd>{d.reportedByName}</dd></div><div><dt className="label">When</dt><dd>{fmtDateTime(d.createdAt)}</dd></div>
          </dl>
          {d.kind === 'Damage' && d.maintenance?.required && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Marked as needing maintenance. <TBC>Maintenance request link · Phase 10</TBC></p>}
          {d.claim?.name && <div className="rounded-xl bg-green-50 p-3"><p className="label">Returned to</p><p><b>{d.claim.name}</b>{d.claim.phone ? ` · ${d.claim.phone}` : ''}<br /><span className="text-xs text-slate-500">ID checked: {d.claim.idChecked} · {fmtDateTime(d.claim.returnedAt)} by {d.claim.returnedByName}</span></p></div>}
          {d.disposedReason && <p className="rounded-lg bg-slate-50 p-2 text-xs">Disposed: {d.disposedReason}</p>}
          <div><p className="label">Photos</p><div className="flex flex-wrap gap-2">{d.photoList?.map((p) => <AuthImage key={p._id} id={p._id} className="h-20 w-20 rounded-lg" />)}{!d.photoList?.length && <span className="text-slate-400">None</span>}</div>
            {!locked && <PhotoPicker className="mt-2" label="Add photo" onPick={addPhoto} />}</div>
          <div><p className="label">History</p><ul className="space-y-1.5 border-l-2 border-slate-100 pl-3 text-xs">{[...(d.history || [])].reverse().map((h, i) => <li key={i}><b>{h.status}</b> · {h.byName}{h.note ? ` · ${h.note}` : ''}<br /><span className="text-slate-400">{fmtDateTime(h.at)}</span></li>)}</ul></div>
          {manage && !locked && <div className="rounded-xl border border-slate-200 p-4"><p className="mb-3 text-sm font-bold">Update status</p>
            <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Keep “{d.status}”</option>{FLOW[d.kind].filter((s) => s !== d.status).map((s) => <option key={s}>{s}</option>)}</Select></Field>
            {status === 'Returned' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Collected by" required><Input value={claim.name} maxLength={80} onChange={(e) => setClaim({ ...claim, name: e.target.value })} /></Field><Field label="Phone"><Input value={claim.phone} maxLength={30} onChange={(e) => setClaim({ ...claim, phone: e.target.value })} /></Field><Field label="ID checked (type + last digits)" required className="sm:col-span-2"><Input value={claim.idChecked} maxLength={80} onChange={(e) => setClaim({ ...claim, idChecked: e.target.value })} /></Field></div>}
            <Field label={`Note${['Disposed', 'Written Off'].includes(status) ? '' : ' (optional)'}`} required={['Disposed', 'Written Off'].includes(status)} className="mt-3"><Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
            {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
            <Button className="mt-3" loading={busy} disabled={!status || (status === 'Returned' && (!claim.name.trim() || !claim.idChecked.trim())) || (['Disposed', 'Written Off'].includes(status) && note.trim().length < 3)} onClick={save}>Save update</Button></div>}
          {locked && <p className="text-xs text-slate-400">This record is {d.status.toLowerCase()} and can no longer be changed.</p>}
        </div>)}</Async>
    </Drawer>
  );
}

export default function Reports() {
  const [sp, setSp] = useSearchParams(); const [kind, setKind] = useState(HK_REPORT_KINDS[0]); const [flt, setFlt] = useState('open'); const [creating, setCreating] = useState(false);
  const st = useGet('/housekeeping/reports', { kind, status: flt === 'open' ? 'open' : undefined, limit: 200 }, [kind, flt]);
  const sel = sp.get('id'); const open = (id) => setSp(id ? { id } : {});
  return (<>
    <PageHeader title="Damage, missing & lost-and-found" subtitle="Every report is kept with its photos and status history" actions={<Button onClick={() => setCreating(true)}><Plus size={16} />New report</Button>} />
    <Tabs value={kind} onChange={setKind} items={HK_REPORT_KINDS.map((k) => ({ key: k, label: k }))} />
    <Pills className="my-3" value={flt} onChange={setFlt} items={[{ key: 'open', label: 'Open' }, { key: 'all', label: 'All' }]} />
    <div className="card"><Async state={st} empty={<EmptyState icon={FileWarning} title={`No ${kind.toLowerCase()} reports`} text="Reports raised by housekeepers and supervisors appear here." />}>
      {(rows) => <Table rows={rows} onRow={(r) => open(r._id)} columns={[
        { header: 'Report', render: (r) => <><b>{r.title}</b><br /><span className="text-xs text-slate-400">{r.reportNumber}</span></> },
        { header: 'Room', render: (r) => (r.room ? `Room ${r.room.roomNumber}` : r.location || '—') }, { header: 'Status', render: (r) => <Badge tone={HK_REPORT_TONE[r.status]}>{r.status}</Badge> },
        { header: 'Severity / value', render: (r) => [r.severity, r.estimatedValue != null && money(r.estimatedValue)].filter(Boolean).join(' · ') || '—' },
        { header: 'Reported', render: (r) => <span className="text-xs">{r.reportedByName}<br />{fmtDateTime(r.createdAt)}</span> },
      ]} />}</Async></div>
    <Detail id={sel} onClose={() => open(null)} onChanged={st.reload} />
    <ReportForm open={creating} kind={kind} onClose={() => { setCreating(false); st.reload(); }} onSaved={st.reload} />
  </>);
}
