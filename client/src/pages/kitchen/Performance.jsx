import { useState } from 'react';
import { Info } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useGet } from '../../hooks/useApi';
import { Async, Badge, Card, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import { SubNav, STATIONS, StationBadge, pct, rs, todayStr } from './shared';
import { fmtMin } from '../../utils/kitchenMath';

const d7 = () => new Date(Date.now() + 5.5 * 3600e3 - 6 * 864e5).toISOString().slice(0, 10);
export default function Performance() {
  const can = useAuth((s) => s.can); const [from, setFrom] = useState(d7()); const [to, setTo] = useState(todayStr()); const [station, setStation] = useState('all');
  const g = useGet('/kitchen/performance', { from, to, station: station === 'all' ? undefined : station });
  return (
    <div><SubNav can={can} />
      <PageHeader title="Chef performance" subtitle="Measured from recorded kitchen activity. The hotel has not yet decided how performance is judged, so there is no official score." />
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"><label className="text-xs font-semibold text-slate-600">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs font-semibold text-slate-600">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600">Station<Select value={station} onChange={(e) => setStation(e.target.value)}><option value="all">All stations</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select></label></div>
      <Async state={g}>{(d) => (<div className="space-y-4">
        <Card title="Chefs" pad={false}>{!d.users.length ? <EmptyState title="No attributed kitchen activity in this range" text="Activity is attributed when a ticket is assigned or claimed, or when someone starts or marks items ready." /> :
          <Table rows={d.users} rowKey="user" columns={[{ header: 'Chef', render: (u) => <b>{u.name}</b> }, { header: 'Tickets handled', className: 'text-right', render: (u) => <span>{u.ticketsHandled}{u.sharedTickets > 0 && <span className="block text-[10px] font-normal text-slate-400">{u.sharedTickets} shared</span>}</span> },
            { header: 'Completed', className: 'text-right', render: (u) => u.ordersCompleted }, { header: 'Avg total', className: 'text-right', render: (u) => fmtMin(u.avgTotalMinutes) }, { header: 'Avg prep', className: 'text-right', render: (u) => fmtMin(u.avgPrepMinutes) },
            { header: 'On time', className: 'text-right', render: (u) => pct(u.onTimeRate) }, { header: 'Delayed handled', className: 'text-right', render: (u) => u.delayedOrdersHandled }, { header: 'Cancelled (assigned)', className: 'text-right', render: (u) => u.cancelledAssigned },
            { header: 'Prep tasks', className: 'text-right', render: (u) => u.tasksAssigned ? `${u.tasksCompleted}/${u.tasksAssigned}` : '-' }, { header: 'Wastage', className: 'text-right', render: (u) => u.wastageRecords ? <span>{u.wastageRecords}{u.wastageCost != null && <span className="block text-[10px] text-slate-400">{rs(u.wastageCost)}{u.wastageCostIncomplete ? '*' : ''}</span>}</span> : '-' },
            ...(d.composite.enabled ? [{ header: 'Indicator', className: 'text-right', render: (u) => u.compositeIndicator ?? '-' }] : [])]} />}</Card>
        {d.composite.enabled && <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">Indicator = weighted average of on-time rate ({d.composite.weights.onTime}) and prep-task completion ({d.composite.weights.tasks}). {d.composite.note}</p>}
        <Card title="Workload by station" pad={false}><Table rows={d.stations} rowKey="station" empty={<p className="p-4 text-sm text-slate-500">No tickets in this range.</p>} columns={[{ header: 'Station', render: (s) => <StationBadge station={s.station} /> }, { header: 'Tickets', className: 'text-right', render: (s) => s.slices }, { header: 'Completed', className: 'text-right', render: (s) => s.completed }, { header: 'Open', className: 'text-right', render: (s) => s.active }, { header: 'Cancelled', className: 'text-right', render: (s) => s.cancelled }, { header: 'Delayed', className: 'text-right', render: (s) => s.delayed }, { header: 'Avg total', className: 'text-right', render: (s) => fmtMin(s.avgTotalMinutes) }, { header: 'On time', className: 'text-right', render: (s) => pct(s.onTimeRate) }]} /></Card>
        {d.unattributed.slices > 0 && <p className="text-xs text-slate-500"><Badge tone="slate">{d.unattributed.slices} unattributed</Badge> {d.unattributed.note}</p>}
        <Card title="How these numbers are worked out"><ul className="space-y-1.5 text-sm text-slate-600">{d.methodology.map((m, i) => <li key={i} className="flex gap-2"><Info size={14} className="mt-0.5 shrink-0 text-slate-400" />{m}</li>)}</ul></Card></div>)}</Async>
    </div>
  );
}
