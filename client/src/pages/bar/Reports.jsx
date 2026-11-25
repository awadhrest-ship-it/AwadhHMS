import { useState } from 'react';
import { useAuth } from '../../store/auth';
import { useGet } from '../../hooks/useApi';
import { Async, Badge, Card, EmptyState, PageHeader, Pills, Select, Table } from '../../components/ui';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Filters, VarBadge, Mono, rs, num, signed, tone, today, monthStart } from './shared';

const REPORTS = [
  { key: 'liquor-stock', label: 'Liquor stock', perm: 'bar.reports', noRange: true }, { key: 'opening-closing', label: 'Opening & closing', perm: 'bar.reports' }, { key: 'consumption', label: 'Bottle & peg consumption', perm: 'bar.reports' },
  { key: 'variance', label: 'Stock & peg variance', perm: ['bar.reports', 'bar.variance.view'] }, { key: 'complimentary', label: 'Complimentary', perm: ['bar.reports', 'bar.comp.view'] }, { key: 'wastage', label: 'Wastage', perm: ['bar.reports', 'bar.loss.view'] },
  { key: 'breakage', label: 'Breakage', perm: ['bar.reports', 'bar.loss.view'] }, { key: 'shift-closing', label: 'Bar closing (shifts)', perm: ['bar.reports', 'bar.shift.work', 'bar.shift.manage'] },
];
export default function Reports() {
  const can = useAuth((s) => s.can); const allowed = REPORTS.filter((r) => [].concat(r.perm).some(can)); const [key, setKey] = useState(allowed[0]?.key); const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today()); const [only, setOnly] = useState('');
  const def = REPORTS.find((r) => r.key === key);
  return (
    <div><SubNav can={can} />
      <PageHeader title="Bar reports" subtitle="Built from the saved records - nothing is estimated" />
      <Pills className="mb-3" items={allowed.map((r) => ({ key: r.key, label: r.label }))} value={key} onChange={setKey} />
      {!def?.noRange && <Filters from={from} to={to} setFrom={setFrom} setTo={setTo}>{key === 'variance' && <label className="text-xs font-semibold text-slate-600">Show<Select value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All counted lines</option><option value="1">Only lines with variance</option></Select></label>}</Filters>}
      {key && <ReportView key={key} k={key} params={def?.noRange ? {} : { from, to, ...(key === 'variance' && only ? { onlyVariance: 'true' } : {}) }} />}
    </div>
  );
}
/** One mounted view per report, so a report never renders with another report's data while it loads. */
function ReportView({ k, params }) {
  const g = useGet(`/bar/reports/${k}`, params);
  return <Card pad={false}><Async state={g} isEmpty={(d) => !(d.rows || d.items || []).length} empty={<EmptyState title="Nothing to report" text="No records match this report and date range." />}>{(d) => <Body k={k} d={d} />}</Async></Card>;
}
const R = (h, f) => ({ header: h, className: 'text-right', render: f });
function Body({ k, d }) {
  if (k === 'liquor-stock') return <Table rows={d.items} rowKey="item" columns={[{ header: 'Item', render: (r) => <span className="font-semibold">{r.name}</span> }, { header: 'Category', render: (r) => r.category }, R('Bottle size', (r) => r.isLiquor ? `${num(r.capacityMl, 0)} ml` : '-'), R('Sealed bottles', (r) => r.sealedBottles ?? '-'), R('Opened (ml)', (r) => r.isLiquor ? num(r.openedMl, 0) : '-'), R('Opened pegs (30 ml)', (r) => r.isLiquor ? r.pegs30 : '-'), R('Total on hand', (r) => `${num(r.totalQty, 0)} ${r.baseUnit}`)]} />;
  if (k === 'opening-closing') return <Table rows={d.rows} rowKey="item" columns={[{ header: 'Item', render: (r) => <span className="font-semibold">{r.name}</span> }, R('Opening', (r) => num(r.opening, 0)), R('Received', (r) => num(r.received, 0)), R('Sold', (r) => num(r.sold, 0)), R('Complimentary', (r) => num(r.complimentary, 0)), R('Wastage', (r) => num(r.wastage, 0)), R('Breakage', (r) => num(r.breakage, 0)), R('Adjustments', (r) => num(r.adjustments, 0)), R('Other', (r) => num(r.other, 0)), R('Closing', (r) => <b>{num(r.closing, 0)} {r.baseUnit}{r.closingBottles != null && <span className="block text-xs font-normal text-slate-500">{r.closingBottles} btl</span>}</b>)]} />;
  if (k === 'consumption') return <><Table rows={d.rows} columns={[{ header: 'Drink', render: (r) => <span className="font-semibold">{r.name}</span> }, { header: 'Serving', render: (r) => r.measure }, R('Served', (r) => r.drinks), R('Complimentary', (r) => r.complimentary), R('Liquor (ml)', (r) => num(r.ml, 0)), R('Sales', (r) => rs(r.revenue))]} /><p className="border-t border-slate-100 p-3 text-sm font-semibold">Total: {d.totals.drinks} served · {d.totals.complimentary} complimentary · {rs(d.totals.revenue)}</p></>;
  if (k === 'variance') return <><Table rows={d.rows} columns={[{ header: 'When', render: (r) => <span>{fmtDateTime(r.at)}<span className="block text-xs text-slate-500">{r.source} <Mono>{r.reference}</Mono> · {r.by}</span></span> }, { header: 'Item', render: (r) => <span className="font-semibold">{r.itemName}</span> }, R('Expected', (r) => num(r.expectedQ, 0)), R('Counted', (r) => num(r.countedQ, 0)),
    R('Variance', (r) => <span className={tone(r.varianceQ)}><b>{signed(r.varianceQ)} {r.baseUnit}</b></span>), R('Pegs', (r) => r.isLiquor ? <span className={tone(r.variancePegs)}>{signed(r.variancePegs)} × {r.pegMl} ml</span> : '-'), R('Bottles', (r) => r.isLiquor ? signed(r.varianceBottles, 3) : '-'), R('Value', (r) => r.varianceValue != null ? rs(r.varianceValue) : '-'), { header: '', render: (r) => <VarBadge line={r} /> }]} /><p className="border-t border-slate-100 p-3 text-sm">{d.totals.lines} line(s) counted · {d.totals.withVariance} with variance · {d.totals.exceedingTolerance} reportable</p></>;
  if (k === 'complimentary') return <><Table rows={d.rows} columns={[{ header: 'Request', render: (r) => <span><Mono>{r.requestNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(r.createdAt)} · {r.requestedByName}</span></span> }, { header: 'Drink', render: (r) => `${r.quantity} × ${r.itemName} (${r.measure})` }, R('List value', (r) => rs(r.listValue)), { header: 'Reason', render: (r) => r.reason }, { header: 'Status', render: (r) => <Badge tone={r.status === 'Issued' ? 'green' : r.status === 'Rejected' ? 'red' : 'amber'}>{r.status}</Badge> }]} /><p className="border-t border-slate-100 p-3 text-sm">{d.totals.requests} request(s) · {d.totals.issuedDrinks} drink(s) issued (worth {rs(d.totals.issuedListValue)}) · {d.totals.pending} pending · {d.totals.rejected} rejected</p></>;
  if (k === 'wastage' || k === 'breakage') return <><Table rows={d.rows} columns={[{ header: 'Record', render: (r) => <span><Mono>{r.lossNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(r.occurredAt)} · {r.recordedByName}</span></span> }, { header: 'Item', render: (r) => <span className="font-semibold">{r.itemName}</span> }, R('Quantity', (r) => `${num(r.quantity)} ${r.unit}`), { header: 'Reason', render: (r) => r.reason }, { header: 'Stock taken out', render: (r) => (r.consumption || []).map((c) => `${num(c.baseQty)} ${c.unit}`).join(', ') }]} />
    <div className="border-t border-slate-100 p-3 text-sm"><b>Total by item:</b> {d.byItem.map((x) => `${x.itemName} ${num(x.baseQty)} ${x.unit}`).join(' · ') || '-'}</div></>;
  if (k === 'shift-closing') return <Table rows={d.rows} columns={[{ header: 'Shift', render: (s) => <span><Mono>{s.shiftNumber}</Mono><span className="block text-xs text-slate-500">{s.bartenderName}</span></span> }, { header: 'From → to', render: (s) => `${fmtDateTime(s.startedAt)} → ${fmtDateTime(s.endedAt)}` }, R('Drinks', (s) => s.closing.sales?.drinks), R('Sales', (s) => rs(s.closing.sales?.revenue)), R('Complimentary', (s) => s.closing.complimentary?.drinks), R('Wastage', (s) => s.closing.wastage?.records), R('Breakage', (s) => s.closing.breakage?.records), { header: 'Variance', render: (s) => s.closing.linesWithVariance ? <Badge tone="red">{s.closing.linesWithVariance} item(s)</Badge> : <Badge tone="green">None</Badge> }, { header: '', render: (s) => s.revision ? <Badge tone="amber">Corrected</Badge> : '' }]} />;
  return null;
}
