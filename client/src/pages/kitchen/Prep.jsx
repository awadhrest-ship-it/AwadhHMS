import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, Hand, Play, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Textarea } from '../../components/ui';
import { ConfirmDialog, Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { SubNav, STATIONS, StationBadge, todayStr } from './shared';

const TTONE = { Pending: 'slate', 'In Progress': 'amber', Completed: 'green' };
export default function Prep() {
  const can = useAuth((s) => s.can); const me = useAuth((s) => s.user); const manage = can('kitchen.prep.manage'); const [date, setDate] = useState(todayStr());
  const g = useGet(`/kitchen/prep/date/${date}`, undefined, [date]); // the API returns data:null when the day has no list (useGet would otherwise hand us the whole response body)
  const list = g.raw ? g.raw.data : null; const ref = useGet(manage ? '/kitchen/prep-reference' : null, { date }, [date]); const [run, busy] = useAction();
  const [taskForm, setTaskForm] = useState(null); const [finish, setFinish] = useState(null); const [del, setDel] = useState(null);
  const create = async () => { try { await run(() => api.post('/kitchen/prep', { businessDate: date })); toast.success('Preparation list created'); g.reload(); } catch (e) { toast.error(e.message); } };
  const patch = async (t, body, ok) => { try { await run(() => api.patch(`/kitchen/prep/${list._id}/tasks/${t._id}`, body)); if (ok) toast.success(ok); g.reload(); } catch (e) { toast.error(e.message); } };
  const mine = (t) => manage || !t.assignedTo || String(t.assignedTo) === String(me?.id);
  return (
    <div><SubNav can={can} />
      <PageHeader title="Daily preparation list" subtitle="What the kitchen plans to prepare today and what was actually prepared. Preparing food does not change stock - ingredients leave stock when the dish is sold." actions={<Input type="date" aria-label="Business date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />} />
      <Async state={g} isEmpty={() => !list} empty={<Card><EmptyState icon={ClipboardList} title={`No preparation list for ${date}`} text={manage ? 'Create the list, then add what needs preparing, with quantities and who is responsible.' : 'The kitchen manager or head chef has not created one yet.'} action={manage && <Button loading={busy} onClick={create}><Plus size={15} />Create list</Button>} /></Card>}>{(l) => (
        <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <Card pad={false} title={l.title || `Preparation - ${l.businessDate}`} action={manage && <Button size="sm" onClick={() => setTaskForm({})}><Plus size={14} />Add task</Button>}>
            <div className="border-b border-slate-100 p-4"><div className="mb-1 flex justify-between text-xs font-semibold text-slate-600"><span>{l.progress.completed} of {l.progress.total} tasks done · {l.progress.inProgress} in progress</span><span>{l.progress.percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${l.progress.percent}%` }} /></div></div>
            {!l.tasks.length ? <EmptyState title="No tasks yet" /> : <Table rows={l.tasks} columns={[
              { header: 'Task', render: (t) => <span className="font-semibold">{t.title}{t.instructions && <span className="block max-w-[18rem] break-words text-xs font-normal text-slate-500">{t.instructions}</span>}</span> }, { header: 'Station', render: (t) => t.station ? <StationBadge station={t.station} /> : '-' },
              { header: 'Planned', className: 'text-right', render: (t) => `${t.plannedQty} ${t.unit}` }, { header: 'Actual', className: 'text-right', render: (t) => t.actualQty != null ? <b>{t.actualQty} {t.unit}</b> : <span className="text-slate-400">-</span> }, { header: 'Left', className: 'text-right', render: (t) => t.remainingQty != null ? `${t.remainingQty}` : '-' },
              { header: 'Chef', render: (t) => t.assignedToName || <span className="text-slate-400">Unassigned</span> }, { header: 'Status', render: (t) => <Badge tone={TTONE[t.status]}>{t.status}</Badge> },
              { header: '', render: (t) => <div className="flex flex-wrap justify-end gap-1">
                {can('kitchen.prep.work') && mine(t) && t.status === 'Pending' && <Button size="sm" variant="secondary" onClick={() => patch(t, { status: 'In Progress' })}>{t.assignedTo ? <Play size={13} /> : <Hand size={13} />}{t.assignedTo ? 'Start' : 'Take & start'}</Button>}
                {(can('kitchen.prep.work') || manage) && mine(t) && t.status !== 'Completed' && <Button size="sm" onClick={() => setFinish(t)}><CheckCircle2 size={13} />Complete</Button>}
                {manage && <Button size="sm" variant="ghost" onClick={() => setTaskForm(t)}>Edit</Button>}{manage && t.status === 'Pending' && <Button size="sm" variant="ghost" aria-label={`Remove ${t.title}`} onClick={() => setDel(t)}><Trash2 size={13} /></Button>}</div> }]} />}
          </Card>
          {manage && <Card title="Past sales (reference only)"><p className="mb-2 text-xs text-slate-500">Average portions sold per day over the last {ref.data?.days || 7} days. {ref.data?.note}</p>
            <Async state={ref} empty={<p className="text-sm text-slate-500">No sales history yet.</p>}>{(r) => <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-auto text-sm">{r.data.slice(0, 25).map((x) => <li key={x.menuItem} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="block truncate font-semibold">{x.name}</span><span className="text-xs text-slate-500">≈ {x.averagePerDay}/day · same weekday last week: {x.sameWeekday}</span></span><Button size="sm" variant="secondary" onClick={() => setTaskForm({ menuItem: x.menuItem, title: x.name, station: x.station, plannedQty: Math.ceil(x.averagePerDay) })}>Add</Button></li>)}</ul>}</Async></Card>}
        </div>)}</Async>
      <TaskModal task={taskForm} list={list} onClose={() => setTaskForm(null)} onDone={g.reload} />
      <FinishModal task={finish} onClose={() => setFinish(null)} onSave={async (b) => { await patch(finish, { status: 'Completed', ...b }, 'Task completed'); setFinish(null); }} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Remove “${del?.title}”?`} message="Only tasks that have not been started can be removed. This is recorded in the audit trail." confirmLabel="Remove" danger busy={busy} onConfirm={async () => { try { await run(() => api.delete(`/kitchen/prep/${list._id}/tasks/${del._id}`)); setDel(null); g.reload(); } catch (e) { toast.error(e.message); } }} />
    </div>
  );
}
function FinishModal({ task, onClose, onSave }) {
  const [a, setA] = useState(''); const [r, setR] = useState(''); const [busy, setBusy] = useState(false); useEffect(() => { if (task) { setA(task.actualQty ?? ''); setR(task.remainingQty ?? ''); } }, [task]);
  return <Modal open={!!task} onClose={onClose} size="sm" title={`Complete: ${task?.title || ''}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={a === ''} onClick={async () => { setBusy(true); try { await onSave({ actualQty: Number(a), remainingQty: r === '' ? undefined : Number(r) }); } finally { setBusy(false); } }}>Mark completed</Button></>}>
    <p className="mb-3 text-sm text-slate-500">Planned: <b>{task?.plannedQty} {task?.unit}</b>. Record what was really prepared - it can differ from the plan.</p>
    <div className="grid grid-cols-2 gap-3"><Field label={`Actually prepared (${task?.unit || ''})`} required><Input type="number" min="0" step="any" autoFocus value={a} onChange={(e) => setA(e.target.value)} /></Field><Field label="Remaining / left over"><Input type="number" min="0" step="any" value={r} onChange={(e) => setR(e.target.value)} /></Field></div></Modal>;
}
function TaskModal({ task, list, onClose, onDone }) {
  const [f, setF] = useState({}); const [run, busy] = useAction(); const [err, setErr] = useState(''); const menu = useGet(task ? '/kitchen/menu' : null); const staff = useGet(task ? '/kitchen/staff' : null); const isNew = task && !task._id;
  useEffect(() => { if (task) { setErr(''); setF({ menuItem: task.menuItem || '', title: task.title || '', station: task.station || '', plannedQty: task.plannedQty ?? '', unit: task.unit || 'portion', assignedTo: task.assignedTo || '', instructions: task.instructions || '' }); } }, [task]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v })); if (!task) return null;
  const save = async () => { setErr(''); if (!f.menuItem && !f.title) return setErr('Choose a menu item or type a task name'); if (!(Number(f.plannedQty) >= 0) || f.plannedQty === '') return setErr('Enter the planned quantity');
    const body = { menuItem: f.menuItem || undefined, title: f.title || undefined, station: f.station || undefined, plannedQty: Number(f.plannedQty), unit: f.unit, assignedTo: f.assignedTo || undefined, instructions: f.instructions || undefined };
    try { await run(() => (isNew ? api.post(`/kitchen/prep/${list._id}/tasks`, body) : api.patch(`/kitchen/prep/${list._id}/tasks/${task._id}`, { ...body, station: f.station || null }))); toast.success(isNew ? 'Task added' : 'Task updated'); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add preparation task' : 'Edit task'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">{err && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{err}</div>}
        {isNew && <Field label="Menu item" hint="Or leave empty and type a task such as “Marinate chicken”"><Select value={f.menuItem} onChange={(e) => { const m = (menu.data || []).find((x) => x._id === e.target.value); setF((x) => ({ ...x, menuItem: e.target.value, title: m ? m.name : x.title, station: m?.station || x.station })); }}><option value="">None (custom task)</option>{(menu.data || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</Select></Field>}
        <Field label="Task" required><Input value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Planned quantity" required><Input type="number" min="0" step="any" value={f.plannedQty} onChange={(e) => set('plannedQty', e.target.value)} /></Field><Field label="Unit"><Input value={f.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
          <Field label="Station"><Select value={f.station} onChange={(e) => set('station', e.target.value)}><option value="">None</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select></Field></div>
        <Field label="Assigned to"><Select value={f.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}><option value="">Unassigned (a chef can take it)</option>{(staff.data || []).map((s) => <option key={s._id} value={s._id}>{s.name} - {s.role}</option>)}</Select></Field>
        <Field label="Instructions"><Textarea rows={2} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} /></Field></div>
    </Modal>
  );
}
