import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileWarning, Play, Plus, Send, Trash2, UserPlus, XCircle } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, Card, Field, Input, PageHeader, RoomStatusBadge, Textarea, cx } from '../../components/ui';
import { ConfirmDialog } from '../../components/feedback';
import { AuthImage, PhotoPicker, uploadPhoto } from '../../components/media';
import { Due, Priority, ReportForm, StaffPicker, TaskStatus } from '../../components/hk';
import { SupplyForm, SupplyList } from '../../components/hkSupply';
import { fmtDateTime } from '../../utils/format';

function Checklist({ t, editable, act, busy }) {
  const [label, setLabel] = useState('');
  const add = async () => { const l = label.trim(); if (!l) return; if (await act(() => api.post(`/housekeeping/tasks/${t._id}/checklist`, { label: l }), 'Item added')) setLabel(''); };
  return (
    <Card title="Checklist" badge={<span className={cx('text-xs font-bold', t.progress.done === t.progress.total ? 'text-green-600' : 'text-slate-500')}>{t.progress.done}/{t.progress.total} done</span>}>
      <ul className="space-y-1">{t.checklist.map((it) => (
        <li key={it._id} className="flex items-start gap-2">
          <label className={cx('flex min-h-[44px] flex-1 items-start gap-3 rounded-lg px-2 py-2', editable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default')}>
            <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-slate-300" checked={!!it.done} disabled={!editable || busy} onChange={() => act(() => api.patch(`/housekeeping/tasks/${t._id}/checklist/${it._id}`, { done: !it.done }))} />
            <span className={cx('text-sm', it.done && 'text-slate-400 line-through')}>{it.label}{it.custom && <Badge className="ml-1.5">Custom</Badge>}
              {it.done && it.doneByName && <span className="block text-[11px] text-slate-400 no-underline">{it.doneByName}{it.doneAt ? ` · ${fmtDateTime(it.doneAt)}` : ''}</span>}</span>
          </label>
          {editable && it.custom && <button type="button" className="min-h-[44px] px-2 text-slate-400 hover:text-red-600" aria-label={`Remove ${it.label}`} onClick={() => act(() => api.delete(`/housekeeping/tasks/${t._id}/checklist/${it._id}`), 'Item removed')}><Trash2 size={15} /></button>}
        </li>))}</ul>
      {editable && <div className="mt-3 flex gap-2"><Input value={label} maxLength={100} placeholder="Add an item (optional)" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button variant="secondary" onClick={add} disabled={!label.trim()}><Plus size={14} />Add</Button></div>}
      {!editable && t.status === 'In Progress' && <p className="mt-2 text-xs text-slate-400">Only the assigned housekeeper can tick this checklist.</p>}
    </Card>
  );
}

function Photos({ t, editable, reload }) {
  const [rm, setRm] = useState(null); const [run] = useAction();
  const up = (kind) => async (blob) => { await uploadPhoto(`/housekeeping/tasks/${t._id}/photos`, blob, { kind }); toast.success(`${kind === 'before' ? 'Before' : 'After'} photo added`); reload(); };
  const remove = async (p) => { try { await run(() => api.delete(`/housekeeping/tasks/${t._id}/photos/${p._id}`)); reload(); } catch (e) { toast.error(e.message); } setRm(null); };
  return (
    <Card title="Photos" badge={<span className="text-xs text-slate-400">{t.photos.length}/12</span>}>
      {['before', 'after'].map((k) => { const list = t.photos.filter((p) => p.kind === k); return (
        <div key={k} className="mb-4 last:mb-0"><p className="label capitalize">{k}</p>
          <div className="flex flex-wrap gap-2">{list.map((p) => <div key={p._id} className="relative"><AuthImage id={p.attachment} alt={`${k} photo`} className="h-24 w-24 rounded-lg" />{editable && <button type="button" aria-label="Remove photo" onClick={() => setRm(p)} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-1 text-red-600 shadow"><XCircle size={16} /></button>}</div>)}
            {!list.length && <p className="text-sm text-slate-400">None yet</p>}</div>
          {editable && <PhotoPicker className="mt-2" label={`Add ${k} photo`} onPick={up(k)} />}</div>); })}
      {rm && <ConfirmDialog open onClose={() => setRm(null)} danger title="Remove photo" message="This photo will be deleted." confirmLabel="Remove" onConfirm={() => remove(rm)} />}
    </Card>
  );
}

function InspectPanel({ t, onDone }) {
  const [failed, setFailed] = useState([]); const [notes, setNotes] = useState(''); const [dlg, setDlg] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const toggle = (id) => setFailed((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const submit = async (result, reason) => { setErr(''); try { await run(() => api.post(`/housekeeping/tasks/${t._id}/inspect`, { result, reason, notes: notes || undefined, failedItemIds: result === 'Rejected' ? failed : undefined })); toast.success(result === 'Approved' ? `Room ${t.room.roomNumber} is now Vacant & Clean` : 'Sent back for re-cleaning'); setDlg(null); onDone(); } catch (e) { setErr(e.message); } };
  return (
    <Card title="Supervisor inspection" className="border-violet-300">
      <p className="mb-3 text-sm text-slate-600">Check the room against the list. Tick anything that <b>failed</b>, then approve or reject. Approving makes Room {t.room.roomNumber} Vacant &amp; Clean; rejecting sends it back to the housekeeper with your reason.</p>
      <ul className="mb-3 space-y-1">{t.checklist.map((i) => <li key={i._id}><label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-50"><input type="checkbox" className="h-5 w-5 rounded border-slate-300 accent-red-600" checked={failed.includes(i._id)} onChange={() => toggle(i._id)} /><span className={cx('text-sm', failed.includes(i._id) && 'font-semibold text-red-700')}>{i.label}</span>{failed.includes(i._id) && <Badge tone="red">Failed</Badge>}</label></li>)}</ul>
      <Field label="Inspector notes (optional)"><Textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && !dlg && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2"><Button loading={busy} onClick={() => submit('Approved')}><CheckCircle2 size={16} />Approve — room is clean</Button><Button variant="danger" onClick={() => { setErr(''); setDlg(true); }}><XCircle size={16} />Reject{failed.length ? ` (${failed.length} failed)` : ''}</Button></div>
      {dlg && <ConfirmDialog open onClose={() => setDlg(null)} danger reason reasonLabel="Why did it fail?" title="Reject inspection" message="The housekeeper is notified and must re-clean the room." confirmLabel="Send back" busy={busy} error={err} onConfirm={(reason) => submit('Rejected', reason)} />}
    </Card>
  );
}

export default function TaskDetail() {
  const { id } = useParams(); const user = useAuth((s) => s.user); const can = useAuth((s) => s.can);
  const st = useGet(`/housekeeping/tasks/${id}`, null, [id]); const [run, busy] = useAction();
  const [assign, setAssign] = useState(false); const [cancel, setCancel] = useState(false); const [err, setErr] = useState(''); const [report, setReport] = useState(false); const [sKey, setSKey] = useState(0);
  const act = async (fn, okMsg) => { try { const r = await run(fn); if (okMsg) toast.success(okMsg); st.reload(); return r; } catch (e) { toast.error(e.message); return false; } };
  return (<>
    <Async state={st} isEmpty={() => false}>{(t0) => { const mine = !!(t0.assignedTo && String(t0.assignedTo._id) === String(user.id) && can('housekeeping.work')); const working = mine && t0.status === 'In Progress'; const pendingItems = t0.checklist.length - t0.checklist.filter((i) => i.done).length; return (<>
      <PageHeader back={<Link to={mine && !can('housekeeping.view') ? '/housekeeping/my-tasks' : '/housekeeping'} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><ArrowLeft size={13} />Back</Link>}
        title={`Room ${t0.room.roomNumber}`} subtitle={`${t0.taskNumber} · ${t0.type} clean · Floor ${t0.room.floor}`}
        actions={<div className="flex flex-wrap items-center gap-2"><TaskStatus status={t0.status} /><Priority p={t0.priority} /><Due t={t0} /></div>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {t0.status === 'Re-clean Required' && t0.lastRejection && <div className="rounded-2xl border border-red-300 bg-red-50 p-4" role="alert"><p className="flex items-center gap-2 text-sm font-bold text-red-800"><AlertTriangle size={16} />Failed inspection — re-clean needed</p><p className="mt-1 text-sm text-red-800">{t0.lastRejection.reason}</p>{t0.lastRejection.failedItems?.length > 0 && <p className="mt-1 text-xs text-red-700">Failed items: {t0.lastRejection.failedItems.join(', ')}</p>}<p className="mt-1 text-[11px] text-red-600">By {t0.lastRejection.byName} · {fmtDateTime(t0.lastRejection.at)}</p></div>}
          {t0.status === 'Inspection Pending' && !can('housekeeping.inspect') && <div className="rounded-2xl bg-violet-50 p-4 text-sm text-violet-800">Waiting for a supervisor to inspect the room. It stays “Inspection Pending” until then.</div>}
          {t0.status === 'Completed' && <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-800">Inspection passed{t0.inspection?.byName ? ` by ${t0.inspection.byName}` : ''}. The room is Vacant &amp; Clean.</div>}
          {t0.notes && <div className="rounded-2xl bg-slate-50 p-4 text-sm"><p className="label">Notes</p>{t0.notes}</div>}
          {mine && ['Assigned', 'Re-clean Required'].includes(t0.status) && <Button className="min-h-[52px] w-full text-base" loading={busy} onClick={() => act(() => api.post(`/housekeeping/tasks/${id}/start`), 'Cleaning started')}><Play size={18} />{t0.status === 'Re-clean Required' ? 'Start re-clean' : 'Start cleaning'}</Button>}
          {t0.status !== 'Unassigned' && t0.status !== 'Cancelled' && <Checklist t={t0} editable={!!working} act={act} busy={busy} />}
          {t0.status !== 'Unassigned' && t0.type !== 'Stay-over' && <Photos t={t0} editable={!!working} reload={st.reload} />}
          {t0.status === 'Inspection Pending' && can('housekeeping.inspect') && <InspectPanel t={t0} onDone={st.reload} />}
          {working && <Card title="Supplies used on this task"><SupplyList task={t0} reloadKey={sKey} /><div className="mt-4 border-t border-slate-100 pt-4"><SupplyForm task={t0} room={t0.room} compact onDone={() => setSKey((k) => k + 1)} /></div></Card>}
          {!working && t0.status !== 'Unassigned' && (can('housekeeping.view') || mine) && <Card title="Supplies used on this task"><SupplyList task={t0} reloadKey={sKey} /></Card>}
          {working && <div className="rounded-2xl border border-slate-200 bg-white p-4"><Button className="min-h-[52px] w-full text-base" loading={busy} disabled={pendingItems > 0} onClick={() => act(() => api.post(`/housekeeping/tasks/${id}/submit`), 'Sent for inspection')}><Send size={18} />Submit for inspection</Button>
            <p className="mt-2 text-xs text-slate-500">{pendingItems > 0 ? `${pendingItems} checklist item(s) still to tick.` : 'The room moves to “Inspection Pending”. It becomes Vacant & Clean only after a supervisor approves it.'}</p></div>}
        </div>
        <div className="space-y-4">
          <Card title="Room">
            <div className="flex flex-wrap items-center gap-2"><RoomStatusBadge status={t0.room.status} /></div>
            {t0.roomStatusReason && <p className="mt-2 text-xs text-slate-500">Reason: {t0.roomStatusReason}</p>}
            {t0.roomStatusNote && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">{t0.roomStatusNote}</p>}
            <dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Assigned to</dt><dd className="font-semibold">{t0.assignedTo?.name || '—'}</dd></div>
              {t0.cleanedBy && <div className="flex justify-between"><dt className="text-slate-500">Cleaned by</dt><dd className="font-semibold">{t0.cleanedBy.name}</dd></div>}
              {t0.startedAt && <div className="flex justify-between"><dt className="text-slate-500">Started</dt><dd>{fmtDateTime(t0.startedAt)}</dd></div>}
              {t0.submittedAt && <div className="flex justify-between"><dt className="text-slate-500">Submitted</dt><dd>{fmtDateTime(t0.submittedAt)}</dd></div>}
              {t0.completedAt && <div className="flex justify-between"><dt className="text-slate-500">Completed</dt><dd>{fmtDateTime(t0.completedAt)}</dd></div>}
              {t0.rejectionCount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Re-cleans</dt><dd className="font-semibold text-red-600">{t0.rejectionCount}</dd></div>}</dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {can('housekeeping.assign') && ['Unassigned', 'Assigned', 'In Progress', 'Re-clean Required'].includes(t0.status) && <Button size="sm" variant="secondary" onClick={() => { setErr(''); setAssign(true); }}><UserPlus size={14} />{t0.assignedTo ? 'Reassign' : 'Assign'}</Button>}
              {can('housekeeping.assign') && ['Unassigned', 'Assigned', 'In Progress', 'Inspection Pending', 'Re-clean Required'].includes(t0.status) && <Button size="sm" variant="ghost" onClick={() => { setErr(''); setCancel(true); }}>Cancel task</Button>}
              <Button size="sm" variant="secondary" onClick={() => setReport(true)}><FileWarning size={14} />Report damage / lost item</Button></div>
          </Card>
          {t0.inspections?.length > 0 && <Card title="Inspection history"><ul className="space-y-3">{t0.inspections.map((i) => <li key={i._id} className="text-sm"><div className="flex items-center justify-between"><Badge tone={i.result === 'Approved' ? 'green' : 'red'}>{i.result}</Badge><span className="text-xs text-slate-400">{fmtDateTime(i.inspectedAt)}</span></div><p className="mt-1 text-xs text-slate-500">By {i.inspectorName} · attempt {i.attempt}</p>{i.reason && <p className="mt-1 text-xs text-red-700">{i.reason}</p>}{i.failedItems?.length > 0 && <p className="text-xs text-slate-500">Failed: {i.failedItems.join(', ')}</p>}{i.notes && <p className="text-xs text-slate-500">{i.notes}</p>}</li>)}</ul></Card>}
          {t0.assignmentHistory?.length > 0 && <Card title="Assignment history"><ul className="space-y-2 text-xs text-slate-600">{[...t0.assignmentHistory].reverse().map((h, i) => <li key={i}><b>{h.toName}</b> assigned by {h.byName}<br /><span className="text-slate-400">{fmtDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>)}</ul></Card>}
        </div>
      </div>
      <StaffPicker open={assign} onClose={() => setAssign(false)} busy={busy} error={err} current={t0.assignedTo?._id} title={`${t0.assignedTo ? 'Reassign' : 'Assign'} Room ${t0.room.roomNumber}`}
        onPick={async (userId, note) => { setErr(''); try { await run(() => api.post(`/housekeeping/tasks/${id}/assign`, { userId, note })); toast.success('Assigned'); setAssign(false); st.reload(); } catch (e) { setErr(e.message); } }} />
      {cancel && <ConfirmDialog open onClose={() => setCancel(false)} danger reason reasonLabel="Cancellation reason" title={`Cancel ${t0.taskNumber}`} confirmLabel="Cancel task" busy={busy} error={err} onConfirm={async (reason) => { setErr(''); try { await run(() => api.post(`/housekeeping/tasks/${id}/cancel`, { reason })); toast.success('Task cancelled'); setCancel(false); st.reload(); } catch (e) { setErr(e.message); } }} />}
      <ReportForm open={report} onClose={() => setReport(false)} room={t0.room} task={t0} />
    </>); }}</Async>
  </>);
}
