import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Badge, Button, Field, Input, Select, Textarea, cx, Async, EmptyState } from './ui';
import { Modal } from './feedback';
import { AuthImage, PhotoPicker, uploadPhoto } from './media';
import { HK_PRIORITY_TONE, HK_TASK_TONE, HK_REPORT_KINDS } from '../utils/constants';
import { fmtDateTime } from '../utils/format';

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const TaskStatus = ({ status }) => <Badge tone={HK_TASK_TONE[status]}>{status}</Badge>;
export const Priority = ({ p }) => (p && p !== 'Normal' ? <Badge tone={HK_PRIORITY_TONE[p]}>{p} priority</Badge> : null);

export function Due({ t }) {
  if (!t.dueAt || ['Completed', 'Cancelled'].includes(t.status)) return null;
  return <span className={cx('inline-flex items-center gap-1 text-xs font-semibold', t.overdue ? 'text-red-600' : 'text-slate-500')}>{t.overdue ? <AlertTriangle size={12} /> : <Clock size={12} />}{t.overdue ? 'Overdue · ' : 'Due '}{fmtDateTime(t.dueAt)}</span>;
}
export const Progress = ({ p }) => {
  if (!p?.total) return null; const pct = Math.round((p.done / p.total) * 100);
  return <div className="flex items-center gap-2" aria-label={`${p.done} of ${p.total} checklist items done`}><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200"><div className={cx('h-full', pct === 100 ? 'bg-green-600' : 'bg-brand-600')} style={{ width: `${pct}%` }} /></div><span className="text-xs text-slate-500">{p.done}/{p.total}</span></div>;
};

/** Large touch-friendly card (phone first). */
export function TaskCard({ t, to }) {
  return (
    <Link to={to || `/housekeeping/tasks/${t._id}`} className={cx('block rounded-2xl border bg-white p-4 shadow-sm transition active:scale-[0.99]', t.overdue ? 'border-red-300' : 'border-slate-200 hover:border-brand-300')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-lg font-extrabold text-brand-800">{t.room?.roomNumber}</span>
          <div><p className="text-base font-bold text-slate-900">Room {t.room?.roomNumber}</p><p className="text-xs text-slate-500">{t.type} clean · Floor {t.room?.floor} · {t.taskNumber}</p></div></div>
        <TaskStatus status={t.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5"><Priority p={t.priority} /><Due t={t} /><Progress p={t.progress} />{t.assignedTo && <span className="text-xs text-slate-500">{t.assignedTo.name}</span>}</div>
      {t.status === 'Re-clean Required' && t.lastRejection?.reason && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">Re-clean: {t.lastRejection.reason}</p>}
    </Link>
  );
}

/** Staff picker for assign / reassign. Lists housekeeping workers with their open-task counts. */
export function StaffPicker({ open, onClose, onPick, busy, error, title = 'Assign to', current }) {
  const [all, setAll] = useState(false); const [sel, setSel] = useState(''); const [note, setNote] = useState('');
  const st = useGet(open ? '/housekeeping/staff' : null, { all: all ? 1 : undefined }, [open]);
  useEffect(() => { if (open) { setSel(''); setNote(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!sel} onClick={() => onPick(sel, note.trim() || undefined)}>Assign</Button></>}>
      <Async state={st} empty={<EmptyState title="No housekeeping staff" text="Create users whose role has the Housekeeping work permission." />}>
        {(rows) => <ul className="space-y-1.5" role="radiogroup" aria-label="Staff">{rows.map((u) => (
          <li key={u._id}><label className={cx('flex min-h-[48px] cursor-pointer items-center justify-between rounded-xl border px-3 py-2', sel === u._id ? 'border-brand-600 bg-brand-50' : 'border-slate-200', current === u._id && 'opacity-50')}>
            <span className="flex items-center gap-3"><input type="radio" name="staff" disabled={current === u._id} checked={sel === u._id} onChange={() => setSel(u._id)} /><span><b className="text-sm">{u.name}</b><br /><span className="text-xs text-slate-500">{u.role}</span></span></span>
            <Badge tone={u.openTasks ? 'amber' : 'green'}>{u.openTasks} open</Badge></label></li>))}</ul>}
      </Async>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Include other departments</label>
      <Field label="Note (optional)" className="mt-3"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </Modal>
  );
}

/** Damage / missing item / lost & found form. After saving, photos can be attached to the new report. */
export function ReportForm({ open, onClose, onSaved, room, task, kind: kind0 = 'Damage' }) {
  const can = useAuth((s) => s.can);
  const key = useRef(newKey());
  const rooms = useGet(open && can('rooms.view') && !room ? '/rooms' : null, null, [open]);
  const blank = { kind: kind0, title: '', description: '', roomId: room?._id || '', location: '', severity: 'Minor', quantity: 1, estimatedValue: '', storageLocation: '', identifyingMarks: '', maintenanceRequired: false };
  const [f, setF] = useState(blank); const [err, setErr] = useState(''); const [run, busy] = useAction(); const [saved, setSaved] = useState(null);
  useEffect(() => { if (open) { key.current = newKey(); setF({ ...blank, kind: kind0 }); setErr(''); setSaved(null); } /* eslint-disable-next-line */ }, [open, kind0, room?._id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async () => {
    setErr('');
    const body = { kind: f.kind, title: f.title.trim(), description: f.description || undefined, room: f.roomId || undefined, task: task?._id, location: f.location || undefined, clientKey: key.current };
    if (f.kind === 'Damage') Object.assign(body, { severity: f.severity, maintenanceRequired: f.maintenanceRequired });
    if (f.kind === 'Missing Item') body.quantity = Number(f.quantity) || 1;
    if (f.kind === 'Lost & Found') Object.assign(body, { storageLocation: f.storageLocation || undefined, identifyingMarks: f.identifyingMarks || undefined });
    if (f.estimatedValue !== '') body.estimatedValue = Number(f.estimatedValue);
    try { const r = await run(() => api.post('/housekeeping/reports', body)); setSaved(r.data.data); toast.success(r.data.replayed ? 'Already saved' : `${r.data.data.reportNumber} saved`); onSaved?.(r.data.data); }
    catch (e) { setErr(e.fields?.title || e.message); }
  };
  const addPhoto = async (blob) => { const d = await uploadPhoto(`/housekeeping/reports/${saved._id}/photos`, blob); setSaved(d); };
  return (
    <Modal open={open} onClose={onClose} title={saved ? `${saved.reportNumber} saved` : 'New report'} size="lg"
      footer={saved ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={f.title.trim().length < 2 || (!f.roomId && !f.location.trim())} onClick={submit}>Save report</Button></>}>
      {saved ? (
        <div className="space-y-3"><p className="text-sm text-slate-600">Add photos as evidence (optional). Photos can be added until the report is closed.</p>
          <div className="flex flex-wrap gap-2">{(saved.photoList || []).map((p) => <AuthImage key={p._id} id={p._id} className="h-20 w-20 rounded-lg" />)}</div>
          <PhotoPicker onPick={addPhoto} label="Take / add photo" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" required><Select value={f.kind} onChange={set('kind')}>{HK_REPORT_KINDS.map((k) => <option key={k}>{k}</option>)}</Select></Field>
          <Field label={f.kind === 'Lost & Found' ? 'What was found' : f.kind === 'Missing Item' ? 'Missing item' : 'What is damaged'} required><Input value={f.title} maxLength={120} onChange={set('title')} /></Field>
          {room ? <Field label="Room"><Input value={`Room ${room.roomNumber}`} disabled /></Field>
            : can('rooms.view') ? <Field label="Room"><Select value={f.roomId} onChange={set('roomId')}><option value="">No room (use location)</option>{(rooms.data || []).map((r) => <option key={r._id} value={r._id}>{r.roomNumber}</option>)}</Select></Field> : null}
          <Field label="Location / detail" hint={!f.roomId ? 'Required when no room is chosen' : undefined} required={!f.roomId}><Input value={f.location} maxLength={120} onChange={set('location')} placeholder="e.g. Corridor floor 2, under the bed" /></Field>
          {f.kind === 'Damage' && <><Field label="Severity"><Select value={f.severity} onChange={set('severity')}>{['Minor', 'Moderate', 'Severe'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.maintenanceRequired} onChange={set('maintenanceRequired')} />Needs maintenance <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800" title="Linking to a maintenance request arrives with the Maintenance phase (Phase 10). Nothing is created automatically.">Link TBC · Phase 10</span></label></>}
          {f.kind === 'Missing Item' && <Field label="Quantity"><Input type="number" min="1" value={f.quantity} onChange={set('quantity')} /></Field>}
          {f.kind === 'Lost & Found' && <><Field label="Stored at"><Input value={f.storageLocation} maxLength={120} onChange={set('storageLocation')} /></Field><Field label="Identifying marks"><Input value={f.identifyingMarks} maxLength={200} onChange={set('identifyingMarks')} /></Field></>}
          <Field label="Estimated value (₹)"><Input type="number" min="0" value={f.estimatedValue} onChange={set('estimatedValue')} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} maxLength={1000} onChange={set('description')} /></Field>
          {err && <p className="text-sm text-red-600 sm:col-span-2" role="alert">{err}</p>}
        </div>)}
    </Modal>
  );
}
