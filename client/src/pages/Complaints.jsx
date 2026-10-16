import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageSquareWarning, Plus } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Badge, Button, EmptyState, Field, Input, PageHeader, Select, Table, TBC, Textarea } from '../components/ui';
import { Drawer } from '../components/feedback';
import ComplaintForm from '../components/ComplaintForm';
import { COMPLAINT_TONE, PRIORITY_TONE } from '../utils/constants';
import { fmtDateTime, fullName } from '../utils/format';
import { Link } from 'react-router-dom';

function Detail({ id, onClose, onChanged }) {
  const can = useAuth((s) => s.can); const st = useGet(id ? `/complaints/${id}` : null, null, [id]); const [status, setStatus] = useState(''); const [resolution, setResolution] = useState(''); const [priority, setPriority] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const save = async () => { setErr(''); try { await run(() => api.put(`/complaints/${id}`, { ...(status && { status }), ...(priority && { priority }), ...(resolution && { resolution }) })); toast.success('Complaint updated'); setStatus(''); setPriority(''); st.reload(); onChanged(); } catch (e) { setErr(e.message); } };
  return <Drawer open={!!id} onClose={onClose} title={st.data?.complaintNumber || 'Complaint'} subtitle={st.data && `${fullName(st.data.guest)}${st.data.room ? ` · Room ${st.data.room.roomNumber}` : ''}`} width="max-w-lg">
    <Async state={st} isEmpty={() => false}>{(c) => (<div className="space-y-4">
      <div className="flex flex-wrap gap-1.5"><Badge tone={COMPLAINT_TONE[c.status]}>{c.status}</Badge><Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge><Badge>{c.category}</Badge></div>
      <p className="rounded-xl bg-slate-50 p-4 text-sm">{c.description}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="label">Guest</dt><dd><Link className="font-semibold text-brand-700" to={`/guests/${c.guest?._id}`}>{fullName(c.guest)}</Link></dd></div><div><dt className="label">Raised by</dt><dd className="font-semibold">{c.createdBy?.name}</dd></div><div><dt className="label">Raised</dt><dd>{fmtDateTime(c.createdAt)}</dd></div>{c.resolvedAt && <div><dt className="label">Resolved</dt><dd>{fmtDateTime(c.resolvedAt)} by {c.resolvedBy?.name}</dd></div>}</dl>
      {c.resolution && <div><p className="label">Resolution</p><p className="rounded-xl bg-green-50 p-3 text-sm">{c.resolution}</p></div>}
      {can('complaints.edit') && c.status !== 'Closed' && <div className="rounded-xl border border-slate-200 p-4"><p className="mb-3 text-sm font-bold">Update <TBC>Workflow TBC</TBC></p><div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Keep “{c.status}”</option>{['Open', 'In Progress', 'Resolved', 'Closed'].filter((s) => s !== c.status).map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Keep “{c.priority}”</option>{['Low', 'Medium', 'High', 'Urgent'].filter((s) => s !== c.priority).map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Resolution" className="sm:col-span-2" hint="Required to resolve or close"><Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field></div>
        {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}<Button className="mt-3" onClick={save} loading={busy} disabled={!status && !priority && !resolution}>Save update</Button></div>}
    </div>)}</Async></Drawer>;
}

export default function Complaints() {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const { id } = useParams();
  const [status, setStatus] = useState(''); const [priority, setPriority] = useState(''); const [q, setQ] = useState(''); const [add, setAdd] = useState(false);
  const rooms = useGet('/rooms'); const [room, setRoom] = useState('');
  const st = useGet('/complaints', { status: status || undefined, priority: priority || undefined, room: room || undefined, q: q || undefined });
  return (<>
    <PageHeader title="Complaints" subtitle="Registered against the guest and visible in their history" actions={can('complaints.create') && <Button onClick={() => setAdd(true)}><Plus size={16} />Register complaint</Button>} />
    <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-4"><Field label="Search"><Input placeholder="Number or text" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="Open,In Progress">Active (open + in progress)</option>{['Open', 'In Progress', 'Resolved', 'Closed'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">All</option>{['Low', 'Medium', 'High', 'Urgent'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Room"><Select value={room} onChange={(e) => setRoom(e.target.value)}><option value="">All</option>{(rooms.data || []).map((r) => <option key={r._id} value={r._id}>{r.roomNumber}</option>)}</Select></Field></div>
    <div className="card"><Async state={st} empty={<EmptyState icon={MessageSquareWarning} title="No complaints found" text="Register a complaint so it is tracked and appears in the guest’s history." />}>
      {(rows) => <Table rows={rows} onRow={(c) => nav(`/complaints/${c._id}`)} columns={[{ header: 'No.', render: (c) => <b>{c.complaintNumber}</b> }, { header: 'Guest', render: (c) => fullName(c.guest) }, { header: 'Room', render: (c) => c.room?.roomNumber || '—' }, { header: 'Category', key: 'category' }, { header: 'Description', render: (c) => <span className="line-clamp-1 max-w-xs">{c.description}</span> }, { header: 'Priority', render: (c) => <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge> }, { header: 'Status', render: (c) => <Badge tone={COMPLAINT_TONE[c.status]}>{c.status}</Badge> }, { header: 'Raised', render: (c) => fmtDateTime(c.createdAt) }]} />}
    </Async></div>
    <Detail id={id} onClose={() => nav('/complaints')} onChanged={st.reload} />
    {add && <ComplaintForm onClose={() => setAdd(false)} onSaved={() => { setAdd(false); st.reload(); }} />}
  </>);
}
