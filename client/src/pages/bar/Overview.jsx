import { Link } from 'react-router-dom';
import { Wine, GlassWater, ClipboardCheck, ShieldAlert, Clock } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useGet } from '../../hooks/useApi';
import { Async, Badge, Card, Kpi, PageHeader, Table } from '../../components/ui';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Notice, rs, num } from './shared';

export default function BarOverview() {
  const can = useAuth((s) => s.can); const g = useGet('/bar/overview');
  return (
    <div><SubNav can={can} />
      <PageHeader title="Bar" subtitle="Drink orders, bottle & peg stock, stock variance, complimentary drinks and bartender shifts" />
      <Async state={g}>{(d) => (<div className="space-y-4">
        {!d.config.happyHourConfigured && <Notice title="Happy-hour pricing is not configured">Normal menu prices apply. Happy-hour timings and rules are still to be confirmed with the client - an authorised user can set them up in Bar &gt; Settings.</Notice>}
        {d.config.billingDestination == null && <Notice title="Bar billing is not decided yet" tone="blue">Drink orders are recorded and served, but they are not posted to a separate bill or a room bill: the hotel has not confirmed how bar sales are billed.</Notice>}
        {(!d.config.varianceToleranceConfigured || !d.config.varianceRecipientsConfigured) && <Notice title="Stock-variance rules are provisional">{!d.config.varianceToleranceConfigured && 'No tolerance is set, so every difference between expected and counted stock is reported. '}{!d.config.varianceRecipientsConfigured && 'No alert recipients are set, so alerts go to everyone with variance access.'}</Notice>}
        {d.menu.incomplete.length > 0 && <Notice tone="red" title={`${d.menu.incomplete.length} drink(s) cannot be sold: stock consumption is not configured`}>{d.menu.incomplete.map((m) => m.name).join(', ')} - open Bar &gt; Bar menu to finish the setup.</Notice>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Sales today" value={rs(d.today.sales)} sub={`${d.today.orders} order(s) · ${d.today.drinks} drink(s)`} to="/bar/orders" />
          <Kpi label="Open orders" value={d.openOrders} sub="not yet served" tone={d.openOrders ? 'amber' : 'slate'} to="/bar/orders" />
          <Kpi label="Complimentary" value={d.pendingComplimentary} sub={`awaiting approval · ${d.approvedToIssue} to issue`} tone={d.pendingComplimentary ? 'amber' : 'slate'} to="/bar/complimentary" />
          <Kpi label="Variance alerts" value={d.unacknowledgedAlerts} sub="not acknowledged" tone={d.unacknowledgedAlerts ? 'red' : 'green'} to="/bar/variance" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Liquor on hand" action={<Link to="/bar/inventory" className="text-xs font-semibold text-brand-700">Bottle &amp; peg stock</Link>} pad={false}>
            <Table rows={d.liquor} rowKey="item" columns={[{ header: 'Item', render: (r) => <span className="font-semibold">{r.name}{!r.capacityConfigured && <Badge tone="red" className="ml-2">No bottle size</Badge>}</span> }, { header: 'Sealed', className: 'text-right', render: (r) => `${r.sealedBottles ?? '-'} btl` }, { header: 'Opened', className: 'text-right', render: (r) => `${num(r.openedMl, 0)} ml` }]} />
          </Card>
          <Card title="Shifts">
            {d.myShift ? <p className="mb-3 text-sm">Your shift <b>{d.myShift.shiftNumber}</b> is {d.myShift.status.toLowerCase()} (started {fmtDateTime(d.myShift.startedAt)}). <Link className="font-semibold text-brand-700" to="/bar/shifts">Open</Link></p> : can('bar.shift.work') && <p className="mb-3 text-sm text-slate-600">You have no open shift. <Link className="font-semibold text-brand-700" to="/bar/shifts">Start one</Link></p>}
            {d.openShifts.length ? <ul className="divide-y divide-slate-100 text-sm">{d.openShifts.map((s) => <li key={s._id} className="flex justify-between py-2"><span className="font-semibold">{s.bartenderName}</span><span className="text-slate-500"><Clock size={12} className="mr-1 inline" />{s.shiftNumber} · since {fmtDateTime(s.startedAt)}</span></li>)}</ul> : <p className="text-sm text-slate-500">No shift is open right now.</p>}
          </Card>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[[Wine, '/bar/orders', 'New drink order'], [GlassWater, '/bar/inventory', 'Open a bottle'], [ClipboardCheck, '/bar/variance', 'Count stock'], [ShieldAlert, '/bar/complimentary', 'Complimentary drinks']].map(([I, to, l]) => <Link key={to} to={to} className="flex items-center gap-2 rounded-xl bg-white p-3 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"><I size={16} className="text-brand-700" />{l}</Link>)}</div>
      </div>)}</Async>
    </div>
  );
}
