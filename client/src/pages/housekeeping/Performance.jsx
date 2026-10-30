import { useState } from 'react';
import { Gauge, Info } from 'lucide-react';
import { useGet } from '../../hooks/useApi';
import { Async, Card, EmptyState, Field, Input, PageHeader, Table } from '../../components/ui';
import { addDaysISO, todayISO } from '../../utils/format';

const COLS = [['tasksSubmitted', 'Tasks submitted', ''], ['tasksCompleted', 'Passed', ''], ['avgCleanMinutes', 'Avg clean time', ' min'], ['inspections', 'Inspections', ''], ['rejected', 'Failed', ''], ['rejectionRate', 'Rejection rate', '%'], ['firstPassRate', 'First-pass rate', '%'], ['onTimePct', 'On time', '%']];
const LABELS = { inspections: 'Inspections of their work in the period', rejected: 'Inspections that failed' };

export default function Performance() {
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29)); const [to, setTo] = useState(todayISO());
  const st = useGet('/housekeeping/reports/performance', { from, to }, [from, to]);
  return (<>
    <PageHeader title="Staff performance" subtitle="Calculated from task and inspection records for the chosen period. Nothing is estimated." />
    <div className="mb-4 grid max-w-md grid-cols-2 gap-3"><Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field></div>
    <div className="card"><Async state={st} isEmpty={(d) => !d.rows?.length} empty={<EmptyState icon={Gauge} title="No cleaning activity in this period" text="Figures appear once tasks have been submitted and inspected." />}>
      {(d) => <Table rows={d.rows.map((r) => ({ ...r, _id: r.user._id }))} columns={[{ key: 'name', header: 'Housekeeper', render: (r) => <b>{r.user.name}</b> },
        ...COLS.map(([k, h, suffix]) => ({ key: k, header: <span title={d.definitions?.[k] || LABELS[k]}>{h}</span>, className: 'whitespace-nowrap', render: (r) => (r[k] == null ? <span className="text-slate-400">—</span> : `${r[k]}${suffix}`) }))]} />}</Async></div>
    <Card title="How these are calculated" className="mt-4"><dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">{Object.entries(st.data?.definitions || {}).map(([k, v]) => <div key={k} className="flex gap-2"><Info size={13} className="mt-0.5 shrink-0 text-slate-400" /><span><b>{COLS.find((c) => c[0] === k)?.[1] || k}:</b> {v}</span></div>)}</dl>
      <p className="mt-3 text-xs text-slate-400">Housekeepers see only their own row. Target times and scoring rules the hotel has not confirmed are not applied.</p></Card>
  </>);
}
