import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, Field, Input, PageHeader, Pills, Select, Switch, Table, Tabs, TBC } from '../../components/ui';
import { toast } from '../../store/toast';
import { SubNav, STATIONS, StationBadge } from './shared';

export default function Settings() {
  const can = useAuth((s) => s.can); const [tab, setTab] = useState(can('kitchen.stations') ? 'stations' : 'delays');
  const g = useGet('/kitchen/settings'); const tabs = [...(can('kitchen.stations') ? [{ key: 'stations', label: 'Stations' }] : []), { key: 'delays', label: 'Delays & alerts' }, { key: 'rules', label: 'Wastage, consumption & performance' }];
  return (
    <div><SubNav can={can} />
      <PageHeader title="Kitchen settings" subtitle="Rules the hotel has not confirmed yet are provisional defaults and can be changed here at any time" />
      <Tabs items={tabs} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'stations' && <Stations can={can} />}
        {tab !== 'stations' && <Async state={g}>{(s) => (tab === 'delays' ? <Delays s={s} meta={g.raw} can={can} onSaved={g.reload} /> : <Rules s={s} can={can} onSaved={g.reload} />)}</Async>}
      </div>
    </div>
  );
}

/* ---- menu item -> station ---- */
function Stations({ can }) {
  const [show, setShow] = useState('unassigned'); const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const g = useGet('/kitchen/menu', { station: show, q: dq || undefined }); const [run] = useAction(); const [sel, setSel] = useState({}); const [bulk, setBulk] = useState('');
  const set = async (id, station) => { try { await run(() => api.put(`/kitchen/menu/${id}/station`, { station: station || null })); toast.success('Station saved'); g.reload(); } catch (e) { toast.error(e.message); } };
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const applyBulk = async () => { try { await run(() => api.post('/kitchen/menu/stations', { items: ids.map((menuItem) => ({ menuItem, station: bulk })) })); toast.success(`${ids.length} item(s) assigned to ${bulk}`); setSel({}); setBulk(''); g.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <Card pad={false} title="Which station prepares each menu item?" badge={<TBC>mapping not confirmed by the hotel</TBC>}>
      <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">Nothing is assigned automatically. Items without a station still appear on the kitchen display under <b>Unassigned</b> (managers can route them), so no order is lost.</p>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between"><Input className="lg:w-72" placeholder="Search menu item" aria-label="Search menu" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2"><Pills items={[{ key: 'unassigned', label: 'Unassigned' }, { key: 'all', label: 'All' }, ...STATIONS.map((s) => ({ key: s, label: s }))]} value={show} onChange={setShow} /></div></div>
      {ids.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-brand-50 p-3 text-sm"><b>{ids.length} selected</b><Select aria-label="Station for selected items" className="!w-44" value={bulk} onChange={(e) => setBulk(e.target.value)}><option value="">Assign to…</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select><Button size="sm" disabled={!bulk} onClick={applyBulk}>Apply</Button><Button size="sm" variant="ghost" onClick={() => setSel({})}>Clear</Button></div>}
      <Async state={g} empty={<p className="p-6 text-center text-sm font-semibold text-emerald-700">{show === 'unassigned' ? 'Every menu item has a station.' : 'No items.'}</p>}>{(rows) => (
        <Table rows={rows} columns={[{ header: '', render: (i) => can('kitchen.stations') && <input type="checkbox" aria-label={`Select ${i.name}`} checked={!!sel[i._id]} onChange={(e) => setSel({ ...sel, [i._id]: e.target.checked })} /> }, { header: 'Menu item', render: (i) => <span className="font-semibold">{i.name}<span className="block text-xs font-normal text-slate-400">{i.category?.name}</span></span> },
          { header: 'Current', render: (i) => <StationBadge station={i.station || 'Unassigned'} /> }, { header: 'Station', render: (i) => <Select aria-label={`Station for ${i.name}`} className="!w-44" value={i.station || ''} onChange={(e) => set(i._id, e.target.value)}><option value="">Unassigned</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select> }]} />)}</Async>
    </Card>
  );
}

const useSave = (onSaved) => { const [run, busy] = useAction(); const save = async (body) => { try { await run(() => api.put('/kitchen/settings', body)); toast.success('Settings saved'); onSaved(); } catch (e) { toast.error(e.message); } }; return [save, busy]; };
const toNum = (v) => (v === '' || v == null ? undefined : Number(v));

/* ---- delay thresholds, recipients, escalation ---- */
function Delays({ s, meta, can, onSaved }) {
  const ok = can('kitchen.configure'); const [save, busy] = useSave(onSaved); const staff = useGet('/kitchen/staff');
  const [f, setF] = useState(null);
  useEffect(() => { setF({ enabled: s.delay.enabled, def: s.delay.defaultMinutes, st: { ...s.delay.stationMinutes }, otOn: s.delay.orderTypeThresholdsEnabled, ot: { ...s.delay.orderTypeMinutes }, roles: [...s.recipients.roles], users: [...s.recipients.users],
    escOn: s.escalation.enabled, escMin: s.escalation.afterMinutes, escRoles: [...s.escalation.roles], escUsers: [...s.escalation.users] }); }, [s]);
  if (!f) return null; const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const toggle = (k, v) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
  const submit = () => save({ delay: { enabled: f.enabled, defaultMinutes: Number(f.def), stationMinutes: clean(f.st), orderTypeThresholdsEnabled: f.otOn, orderTypeMinutes: clean(f.ot) }, recipients: { roles: f.roles, users: f.users }, escalation: { enabled: f.escOn, afterMinutes: Number(f.escMin), roles: f.escRoles, users: f.escUsers } });
  const RoleBoxes = ({ k }) => <div className="flex flex-wrap gap-2">{(meta.recipientRoles || []).map((r) => <label key={r.key} className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold"><input type="checkbox" disabled={!ok} checked={f[k].includes(r.key)} onChange={() => toggle(k, r.key)} />{r.name}</label>)}</div>;
  const UserBoxes = ({ k }) => <div className="flex flex-wrap gap-2">{(staff.data || []).map((u) => <label key={u._id} className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold"><input type="checkbox" disabled={!ok} checked={f[k].includes(u._id)} onChange={() => toggle(k, u._id)} />{u.name}</label>)}</div>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Delayed-order limits" badge={<TBC>limit not confirmed - provisional</TBC>}>
        <p className="mb-3 text-sm text-slate-600">An order is delayed when a station's share has been in the kitchen longer than its limit without being Ready. The hotel has not decided the limit; <b>{meta.defaults.delay.defaultMinutes} minutes is only a starting value</b>.</p>
        <Switch checked={f.enabled} disabled={!ok} onChange={(v) => set('enabled', v)} label="Track delayed orders" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Default limit (minutes)"><Input type="number" min="1" max="480" disabled={!ok} value={f.def} onChange={(e) => set('def', e.target.value)} /></Field></div>
        <h3 className="mb-1 mt-4 text-sm font-bold">Per station (optional)</h3><div className="grid gap-3 sm:grid-cols-2">{STATIONS.map((st) => <Field key={st} label={st} hint="empty = default"><Input type="number" min="1" max="480" disabled={!ok} value={f.st[st] ?? ''} onChange={(e) => set('st', { ...f.st, [st]: e.target.value })} /></Field>)}</div>
        <div className="mt-4"><Switch checked={f.otOn} disabled={!ok} onChange={(v) => set('otOn', v)} label="Use different limits per order type" /></div>
        {f.otOn && <div className="mt-2 grid gap-3 sm:grid-cols-2">{meta.orderTypes.map((t) => <Field key={t} label={t}><Input type="number" min="1" max="480" disabled={!ok} value={f.ot[t] ?? ''} onChange={(e) => set('ot', { ...f.ot, [t]: e.target.value })} /></Field>)}</div>}
        <p className="mt-3 text-xs text-slate-500">Order of precedence: station limit → order-type limit (if switched on) → default.</p>
      </Card>
      <Card title="Who is alerted?" badge={<TBC>recipients not confirmed - provisional</TBC>}>
        <p className="mb-3 text-sm text-slate-600">In-app notifications only (no SMS, WhatsApp or e-mail). One alert is sent per ticket and station when it first becomes delayed - never repeatedly.</p>
        <h3 className="mb-1 text-sm font-bold">Roles</h3><RoleBoxes k="roles" /><h3 className="mb-1 mt-3 text-sm font-bold">Specific people</h3><UserBoxes k="users" />
        {f.roles.length === 0 && f.users.length === 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">Nobody is selected - delayed orders will still be flagged on the display but no notification is sent.</p>}
        <div className="mt-5 border-t border-slate-100 pt-4"><Switch checked={f.escOn} disabled={!ok} onChange={(v) => set('escOn', v)} label="Escalate if still not ready (off until the hotel confirms)" />
          {f.escOn && <div className="mt-3 space-y-3"><Field label="Escalate after (minutes since the first alert)"><Input type="number" min="1" max="480" className="!w-32" disabled={!ok} value={f.escMin} onChange={(e) => set('escMin', e.target.value)} /></Field><div><h3 className="mb-1 text-sm font-bold">Escalation roles</h3><RoleBoxes k="escRoles" /></div><div><h3 className="mb-1 text-sm font-bold">Escalation people</h3><UserBoxes k="escUsers" /></div><p className="text-xs text-slate-500">Sent once per delayed ticket.</p></div>}</div>
      </Card>
      {ok ? <div className="xl:col-span-2"><Button loading={busy} onClick={submit}>Save delay settings</Button></div> : <p className="text-xs text-slate-500 xl:col-span-2">You can view these settings; changing them needs the kitchen.configure permission.</p>}
    </div>
  );
}

/* ---- wastage reasons, consumption, performance, display ---- */
function Rules({ s, can, onSaved }) {
  const ok = can('kitchen.configure'); const [save, busy] = useSave(onSaved); const [reasons, setReasons] = useState(s.wastageReasons); const [nr, setNr] = useState(''); const [auto, setAuto] = useState(s.consumption.autoConsume);
  const [from, setFrom] = useState(s.consumption.enabledFrom ? s.consumption.enabledFrom.slice(0, 16) : ''); const [comp, setComp] = useState({ ...s.performance.composite }); const [poll, setPoll] = useState(s.board.pollSeconds);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Wastage reasons"><p className="mb-3 text-sm text-slate-600">Practical defaults - not an official list. Add your own; “Other” always stays (it requires a note).</p>
        <div className="flex flex-wrap gap-2">{reasons.map((r) => <span key={r} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{r}{ok && r !== 'Other' && <button aria-label={`Remove ${r}`} onClick={() => setReasons(reasons.filter((x) => x !== r))}><X size={12} /></button>}</span>)}</div>
        {ok && <div className="mt-3 flex gap-2"><Input placeholder="New reason" aria-label="New reason" value={nr} onChange={(e) => setNr(e.target.value)} /><Button variant="secondary" disabled={nr.trim().length < 2} onClick={() => { setReasons([...new Set([...reasons, nr.trim()])]); setNr(''); }}><Plus size={14} />Add</Button></div>}
        {ok && <Button className="mt-3" loading={busy} onClick={() => save({ wastageReasons: reasons })}>Save reasons</Button>}</Card>
      <Card title="Ingredient consumption" badge={<Badge tone="blue">trigger: bill finalised</Badge>}><p className="mb-3 text-sm text-slate-600">When a restaurant bill is finalised, the recipe ingredients of what was sold leave <b>{s.consumption.department}</b> stock, once. Draft orders, kitchen progress and preparation never consume stock.</p>
        <Switch checked={auto} disabled={!ok} onChange={setAuto} label="Consume ingredients automatically" />
        <Field label="Consume bills finalised from" className="mt-3" hint="Set when Phase 7 went live. Bills finalised earlier are never consumed. Moving this earlier will back-fill bills finalised since then."><Input type="datetime-local" disabled={!ok} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        {ok && <Button className="mt-3" loading={busy} onClick={() => save({ consumption: { autoConsume: auto, enabledFrom: from ? new Date(from).toISOString() : null } })}>Save</Button>}</Card>
      <Card title="Chef performance" badge={<TBC>method not confirmed</TBC>}><p className="mb-3 text-sm text-slate-600">The dashboard shows transparent activity figures. An optional combined indicator can be switched on - it is an internal indicator, not an official hotel KPI.</p>
        <Switch checked={comp.enabled} disabled={!ok} onChange={(v) => setComp({ ...comp, enabled: v })} label="Show combined indicator" />
        {comp.enabled && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="On-time weight"><Input type="number" min="0" max="100" disabled={!ok} value={comp.onTimeWeight} onChange={(e) => setComp({ ...comp, onTimeWeight: toNum(e.target.value) })} /></Field><Field label="Prep-task weight"><Input type="number" min="0" max="100" disabled={!ok} value={comp.taskWeight} onChange={(e) => setComp({ ...comp, taskWeight: toNum(e.target.value) })} /></Field></div>}
        {ok && <Button className="mt-3" loading={busy} onClick={() => save({ performance: { composite: comp } })}>Save</Button>}</Card>
      <Card title="Kitchen display"><Field label="Refresh every (seconds)" hint="The display polls the server; 3-60 seconds."><Input type="number" min="3" max="60" className="!w-28" disabled={!ok} value={poll} onChange={(e) => setPoll(e.target.value)} /></Field>
        {ok && <Button className="mt-3" loading={busy} onClick={() => save({ board: { pollSeconds: Number(poll) } })}>Save</Button>}</Card>
    </div>
  );
}
