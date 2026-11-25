import { Link } from 'react-router-dom';
import { AlertTriangle, ChefHat, ClipboardList, Flame, PackageX, Trash2, Utensils } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { Async, Badge, Button, Card, Kpi, PageHeader } from '../../components/ui';
import { SubNav, STATIONS, StationBadge, usePollGet, rs } from './shared';

export default function Overview() {
  const can = useAuth((s) => s.can); const g = usePollGet('/kitchen/overview', undefined, 15000);
  return (
    <div><SubNav can={can} />
      <PageHeader title="Kitchen" subtitle="Live view of tickets, stations, stock use and preparation" actions={<Link to="/kitchen/display"><Button><ChefHat size={16} />Open kitchen display</Button></Link>} />
      <Async state={g}>{(d) => (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="New tickets" value={d.totals.queued} tone="blue" to="/kitchen/display" /><Kpi label="Preparing" value={d.totals.preparing} tone="amber" to="/kitchen/display" />
          <Kpi label="Ready for service" value={d.totals.ready} tone="green" to="/kitchen/display" /><Kpi label="Delayed now" value={d.totals.delayed} sub={d.openDelayAlerts ? `${d.openDelayAlerts} open alert${d.openDelayAlerts > 1 ? 's' : ''}` : 'no open alerts'} tone={d.totals.delayed ? 'red' : 'slate'} to="/kitchen/display" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card title="Stations" className="lg:col-span-2"><div className="grid gap-2.5 sm:grid-cols-2">{d.stations.map((s) => { const c = d.counts[s] || {}; return (
            <div key={s} className="rounded-lg border border-slate-200 p-3"><div className="flex items-center justify-between"><StationBadge station={s} />{c.delayed > 0 && <Badge tone="red">{c.delayed} delayed</Badge>}</div>
              <div className="mt-2 grid grid-cols-3 text-center"><div><p className="text-xl font-extrabold">{c.Queued || 0}</p><p className="text-[10px] font-bold uppercase text-slate-400">New</p></div><div><p className="text-xl font-extrabold">{c.Preparing || 0}</p><p className="text-[10px] font-bold uppercase text-slate-400">Preparing</p></div><div><p className="text-xl font-extrabold">{c.Ready || 0}</p><p className="text-[10px] font-bold uppercase text-slate-400">Ready</p></div></div></div>); })}</div></Card>
          <Card title="Needs attention">
            <ul className="space-y-2.5 text-sm">
              <Row icon={AlertTriangle} n={d.unassignedMenuItems} text="menu items without a station" to="/kitchen/settings" show={can('kitchen.stations')} />
              <Row icon={PackageX} n={d.consumptionNeedsAttention} text="ingredient consumptions failed / pending" to="/kitchen/consumption" show={can('kitchen.consumption.view')} />
              <Row icon={Utensils} n={d.menuWithoutRecipe} text="menu items have no recipe yet" to="/kitchen/recipes" show={can('kitchen.recipes.view')} tone="slate" />
              <Row icon={Flame} n={d.unavailable.length} text="items marked unavailable" to="/kitchen/display" tone="slate" />
              {d.wastageToday && <li className="flex items-center gap-2"><Trash2 size={15} className="text-slate-400" /><span><b>{d.wastageToday.records}</b> wastage record{d.wastageToday.records === 1 ? '' : 's'} today{d.wastageToday.records ? <> · {rs(d.wastageToday.cost)}{!d.wastageToday.costComplete && <span className="text-amber-700"> (cost incomplete)</span>}</> : null}</span></li>}
              {d.prepToday !== undefined && <li className="flex items-center gap-2"><ClipboardList size={15} className="text-slate-400" />{d.prepToday ? <Link className="hover:underline" to="/kitchen/prep"><b>Preparation list:</b> {d.prepToday.progress.completed}/{d.prepToday.progress.total} done ({d.prepToday.progress.percent}%)</Link> : <span>No preparation list for today yet{can('kitchen.prep.manage') && <> - <Link className="font-semibold text-brand-700" to="/kitchen/prep">create one</Link></>}</span>}</li>}
            </ul>
            {!d.unassignedMenuItems && !d.consumptionNeedsAttention && <p className="mt-3 text-xs font-semibold text-emerald-700">Nothing is waiting for a decision.</p>}
          </Card>
        </div>
        <p className="mt-4 text-xs text-slate-500">Stations: {STATIONS.join(' · ')}. Delay limits, alert recipients and escalation are provisional settings until the hotel confirms them.</p>
      </>)}</Async>
    </div>
  );
}
function Row({ icon: Icon, n, text, to, show = true, tone = 'amber' }) {
  if (!show || !n) return null;
  return <li><Link to={to} className="flex items-center gap-2 hover:underline"><Icon size={15} className={tone === 'amber' ? 'text-amber-600' : 'text-slate-400'} /><span><b>{n}</b> {text}</span></Link></li>;
}
