import { useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { useGet } from '../../hooks/useApi';
import { Async, Button, EmptyState, PageHeader, Pills } from '../../components/ui';
import { TaskCard } from '../../components/hk';

/** Housekeeper's own work list. Designed for a phone: one column of large cards. The server only ever returns tasks assigned to the signed-in user. */
export default function MyTasks() {
  const [tab, setTab] = useState('open');
  const st = useGet('/housekeeping/tasks', { status: tab === 'open' ? 'open' : 'Completed,Cancelled', limit: 100 });
  return (<>
    <PageHeader title="My tasks" subtitle="Rooms assigned to you. Start a task, tick the checklist, add photos and send it for inspection." actions={<Button variant="secondary" size="sm" onClick={st.reload}><RefreshCw size={14} />Refresh</Button>} />
    <Pills className="mb-4" value={tab} onChange={setTab} items={[{ key: 'open', label: 'To do' }, { key: 'done', label: 'Finished' }]} />
    <Async state={st} empty={<div className="card"><EmptyState icon={ClipboardList} title={tab === 'open' ? 'No tasks assigned to you' : 'Nothing finished yet'} text={tab === 'open' ? 'When a supervisor assigns you a room it appears here.' : undefined} /></div>}>
      {(rows) => <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((t) => <TaskCard key={t._id} t={t} />)}</div>}
    </Async>
  </>);
}
