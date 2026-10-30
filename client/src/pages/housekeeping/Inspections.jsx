import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck } from 'lucide-react';
import { useGet } from '../../hooks/useApi';
import { Async, Badge, EmptyState, Field, Input, PageHeader, Select, Table, Tabs } from '../../components/ui';
import { TaskCard } from '../../components/hk';
import { fmtDateTime } from '../../utils/format';

export default function Inspections() {
  const nav = useNavigate(); const [tab, setTab] = useState('queue'); const [f, setF] = useState({ result: '', from: '', to: '' });
  const q = useGet(tab === 'queue' ? '/housekeeping/tasks' : null, { status: 'Inspection Pending', limit: 100 }, [tab]);
  const h = useGet(tab === 'history' ? '/housekeeping/inspections' : null, { result: f.result || undefined, from: f.from || undefined, to: f.to || undefined, limit: 200 }, [tab]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (<>
    <PageHeader title="Room inspections" subtitle="A room becomes Vacant & Clean only when a supervisor approves it here" />
    <Tabs value={tab} onChange={setTab} items={[{ key: 'queue', label: 'Waiting for inspection', count: tab === 'queue' ? q.data?.length : undefined }, { key: 'history', label: 'Inspection history' }]} />
    <div className="mt-4">
      {tab === 'queue' ? (
        <Async state={q} empty={<div className="card"><EmptyState icon={BadgeCheck} title="Nothing to inspect" text="Rooms appear here after the housekeeper submits them." /></div>}>
          {(rows) => <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((t) => <TaskCard key={t._id} t={t} />)}</div>}
        </Async>
      ) : (<>
        <div className="mb-3 grid gap-3 sm:grid-cols-3"><Field label="Result"><Select value={f.result} onChange={set('result')}><option value="">All</option><option>Approved</option><option>Rejected</option></Select></Field><Field label="From"><Input type="date" value={f.from} onChange={set('from')} /></Field><Field label="To"><Input type="date" value={f.to} onChange={set('to')} /></Field></div>
        <div className="card"><Async state={h} empty={<EmptyState title="No inspections found" />}>
          {(rows) => <Table rows={rows} onRow={(r) => nav(`/housekeeping/tasks/${r.task?._id}`)} columns={[
            { header: 'When', render: (r) => fmtDateTime(r.inspectedAt) },
            { header: 'Room', render: (r) => <b>Room {r.room?.roomNumber}</b> },
            { header: 'Result', render: (r) => <Badge tone={r.result === 'Approved' ? 'green' : 'red'}>{r.result}</Badge> },
            { header: 'Cleaned by', render: (r) => r.cleanedByName || '—' }, { header: 'Inspector', render: (r) => r.inspectorName },
            { header: 'Attempt', render: (r) => r.attempt },
            { header: 'Reason / failed items', render: (r) => <span className="text-xs">{r.reason}{r.failedItems?.length ? ` · ${r.failedItems.join(', ')}` : ''}</span> },
          ]} />}
        </Async></div></>)}
    </div>
  </>);
}
