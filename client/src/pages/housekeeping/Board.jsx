import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, ClipboardList, Plus, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import api from '../../services/api';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, Card, EmptyState, Field, Input, Kpi, PageHeader, Select, Table, Textarea, RoomStatusBadge } from '../../components/ui';
import { ConfirmDialog, Modal } from '../../components/feedback';
import { Due, Priority, Progress, StaffPicker, TaskStatus } from '../../components/hk';
import { fmtDateTime } from '../../utils/format';

const STATUS_OPTS = [['open', 'All open'], ['Unassigned', 'Unassigned'], ['Assigned', 'Assigned'], ['In Progress', 'In progress'], ['Inspection Pending', 'Inspection pending'], ['Re-clean Required', 'Re-clean required'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled'], ['', 'Everything']];

function NewTask({ open, onClose, onSaved }) {
  const rooms = useGet(open ? '/rooms' : null, null, [open]); const staff = useGet(open ? '/housekeeping/staff' : null, null, [open]);
  const [f, setF] = useState({ room: '', type: 'Manual', priority: 'Normal', notes: '', assignedTo: '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF({ room: '', type: 'Manual', priority: 'Normal', notes: '', assignedTo: '' }); setErr(''); } }, [open]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const eligible = (rooms.data || []).filter((r) => (f.type === 'Stay-over' ? r.status === 'Occupied' : ['Vacant & Dirty', 'Cleaning in Progress', 'Vacant & Clean', 'Available', 'Reserved'].includes(r.status)));
  const save = async () => { setErr(''); try { await run(() => api.post('/housekeeping/tasks', { room: f.room, type: f.type, priority: f.priority, notes: f.notes || undefined, assignedTo: f.assignedTo || undefined })); toast.success('Task created'); onSaved(); } catch (e) { setErr(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title="New cleaning task" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.room} onClick={save}>Create task</Button></>}>
      <p className="mb-3 text-xs text-slate-500">Check-out cleaning tasks are created automatically. Use this for deep cleans, re-cleans or stay-over service.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, room: '' })}><option value="Manual">Manual / deep clean</option><option value="Stay-over">Stay-over service</option></Select></Field>
        <Field label="Priority"><Select value={f.priority} onChange={set('priority')}>{['Normal', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Room" required className="sm:col-span-2"><Select value={f.room} onChange={set('room')}><option value="">Select a room…</option>{eligible.map((r) => <option key={r._id} value={r._id}>{r.roomNumber} · {r.status}</option>)}</Select></Field>
        <Field label="Assign to (optional)" className="sm:col-span-2"><Select value={f.assignedTo} onChange={set('assignedTo')}><option value="">Leave unassigned</option>{(staff.data || []).map((u) => <option key={u._id} value={u._id}>{u.name} · {u.openTasks} open</option>)}</Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} maxLength={500} onChange={set('notes')} /></Field>
      </div>
      {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
    </Modal>
  );
}

export default function Board() {
  const can = useAuth((s) => s.can); const nav = useNavigate();
  const board = useGet('/housekeeping/board'); const staff = useGet('/housekeeping/staff', { all: 1 });
  const [flt, setFlt] = useState({ status: 'open', type: '', priority: '', assignedTo: '', q: '' }); const q = useDebounced(flt.q);
  const list = useGet('/housekeeping/tasks', { status: flt.status || undefined, type: flt.type || undefined, priority: flt.priority || undefined, assignedTo: flt.assignedTo || undefined, q: q || undefined, limit: 200 });
  const [assign, setAssign] = useState(null); const [cancel, setCancel] = useState(null); const [creating, setCreating] = useState(false); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const reload = () => { board.reload(); list.reload(); staff.reload(); };
  const doAssign = async (userId, note) => { setErr(''); try { await run(() => api.post(`/housekeeping/tasks/${assign._id}/assign`, { userId, note })); toast.success(`Room ${assign.room.roomNumber} assigned`); setAssign(null); reload(); } catch (e) { setErr(e.message); } };
  const doCancel = async (reason) => { setErr(''); try { await run(() => api.post(`/housekeeping/tasks/${cancel._id}/cancel`, { reason })); toast.success('Task cancelled'); setCancel(null); reload(); } catch (e) { setErr(e.message); } };
  const sync = async () => { try { const r = await run(() => api.post('/housekeeping/tasks/sync')); toast.success(r.data.data.created ? `${r.data.data.created} task(s) created` : 'Every dirty room already has a task'); reload(); } catch (e) { toast.error(e.message); } };
  const stayover = async () => { try { const r = await run(() => api.post('/housekeeping/tasks/stayover', {})); toast.success(r.data.data.created ? `${r.data.data.created} stay-over task(s) created` : 'Stay-over tasks for today already exist'); reload(); } catch (e) { toast.error(e.message); } };
  const set = (k) => (e) => setFlt({ ...flt, [k]: e.target.value });
  const c = board.data?.counts;
  return (<>
    <PageHeader title="Housekeeping" subtitle="Task board · assign rooms, follow cleaning and inspections"
      actions={<>{can('housekeeping.assign') && <><Button variant="secondary" size="sm" loading={busy} onClick={stayover}><CalendarPlus size={14} />Stay-over tasks</Button><Button size="sm" onClick={() => setCreating(true)}><Plus size={14} />New task</Button></>}<Button variant="secondary" size="sm" onClick={reload}><RefreshCw size={14} /></Button></>} />
    <Async state={board} isEmpty={() => false}>{() => (<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Open" value={c.open} /><Kpi label="Unassigned" value={c.unassigned} tone={c.unassigned ? 'red' : 'slate'} /><Kpi label="Assigned" value={c.assigned} /><Kpi label="In progress" value={c.inProgress} />
        <Kpi label="Inspection" value={c.inspectionPending} tone={c.inspectionPending ? 'amber' : 'slate'} to="/housekeeping/inspections" /><Kpi label="Re-clean" value={c.recleanRequired} tone={c.recleanRequired ? 'red' : 'slate'} />
        <Kpi label="Overdue" value={c.overdue} tone={c.overdue ? 'red' : 'slate'} /><Kpi label="Done today" value={c.completedToday} tone="green" /></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Staff workload" className="lg:col-span-1">{board.data.workload?.length ? <ul className="space-y-2 text-sm">{board.data.workload.map((w) => <li key={w.user._id} className="flex justify-between"><span>{w.user.name}</span><Badge tone="blue">{w.open} open</Badge></li>)}</ul> : <p className="text-sm text-slate-400">No open tasks are assigned.</p>}</Card>
        <Card title="Rooms needing attention" className="lg:col-span-2" action={can('housekeeping.assign') && <Button size="sm" variant="secondary" loading={busy} onClick={sync}>Sync rooms</Button>}>
          <div className="flex flex-wrap gap-2 text-xs">{Object.entries(board.data.roomStatus || {}).map(([s, n]) => <span key={s} className="flex items-center gap-1.5"><RoomStatusBadge status={s} /><b>{n}</b></span>)}</div>
          {board.data.roomsWithoutTask?.length > 0 ? <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><b>{board.data.roomsWithoutTask.length} room(s) need cleaning but have no task:</b> {board.data.roomsWithoutTask.map((r) => r.roomNumber).join(', ')}. Use “Sync rooms” to create the tasks.</div> : <p className="mt-3 text-xs text-slate-400">Every room in the cleaning cycle has a task.</p>}
        </Card></div></>)}</Async>
    <div className="card mt-4">
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
        <div className="relative min-w-[180px] flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><Input className="pl-9" placeholder="Room or task number" aria-label="Search" value={flt.q} onChange={set('q')} /></div>
        <Select aria-label="Status" className="w-auto" value={flt.status} onChange={set('status')}>{STATUS_OPTS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</Select>
        <Select aria-label="Type" className="w-auto" value={flt.type} onChange={set('type')}><option value="">All types</option>{['Checkout', 'Stay-over', 'Manual'].map((t) => <option key={t}>{t}</option>)}</Select>
        <Select aria-label="Priority" className="w-auto" value={flt.priority} onChange={set('priority')}><option value="">Any priority</option>{['Normal', 'High', 'Urgent'].map((t) => <option key={t}>{t}</option>)}</Select>
        <Select aria-label="Assignee" className="w-auto" value={flt.assignedTo} onChange={set('assignedTo')}><option value="">Anyone</option><option value="none">Unassigned</option>{(staff.data || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</Select>
      </div>
      <Async state={list} empty={<EmptyState icon={ClipboardList} title="No tasks match" text="Tasks appear automatically when a guest checks out." />}>
        {(rows) => <Table rows={rows} onRow={(t) => nav(`/housekeeping/tasks/${t._id}`)} columns={[
          { header: 'Room', render: (t) => <><b>Room {t.room?.roomNumber}</b><br /><span className="text-xs text-slate-400">{t.taskNumber} · {t.type}</span></> },
          { header: 'Status', render: (t) => <div className="flex flex-col items-start gap-1"><TaskStatus status={t.status} /><Priority p={t.priority} /></div> },
          { header: 'Assigned to', render: (t) => t.assignedTo?.name || <span className="text-slate-400">—</span> },
          { header: 'Progress', render: (t) => <Progress p={t.progress} /> },
          { header: "Due", render: (t) => <Due t={t} /> },
          { header: '', render: (t) => <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            {can('housekeeping.assign') && ['Unassigned', 'Assigned', 'In Progress', 'Re-clean Required'].includes(t.status) && <Button size="sm" variant="secondary" onClick={() => { setErr(''); setAssign(t); }}><UserPlus size={13} />{t.assignedTo ? 'Reassign' : 'Assign'}</Button>}
            {can('housekeeping.assign') && ['Unassigned', 'Assigned', 'In Progress', 'Inspection Pending', 'Re-clean Required'].includes(t.status) && <Button size="sm" variant="ghost" aria-label={`Cancel ${t.taskNumber}`} onClick={() => { setErr(''); setCancel(t); }}><X size={14} /></Button>}</div> },
        ]} />}
      </Async>
    </div>
    <p className="mt-3 text-xs text-slate-400"><Link to="/housekeeping/inspections" className="underline">Inspection queue</Link> · A room becomes Vacant &amp; Clean only after a supervisor approves the inspection.</p>
    <StaffPicker open={!!assign} onClose={() => setAssign(null)} onPick={doAssign} busy={busy} error={err} current={assign?.assignedTo?._id} title={assign ? `${assign.assignedTo ? 'Reassign' : 'Assign'} Room ${assign.room.roomNumber}` : ''} />
    {cancel && <ConfirmDialog open onClose={() => setCancel(null)} danger reason reasonLabel="Cancellation reason" title={`Cancel ${cancel.taskNumber}`} message="The room goes back to Vacant & Dirty if this task had started cleaning." confirmLabel="Cancel task" busy={busy} error={err} onConfirm={doCancel} />}
    <NewTask open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
  </>);
}
