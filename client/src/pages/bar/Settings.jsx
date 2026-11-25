import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, Field, Input, PageHeader, Select, Switch, Textarea } from '../../components/ui';
import { toast } from '../../store/toast';
import { SubNav, Notice } from './shared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nv = (v) => (v === '' || v == null ? null : Number(v));
export default function BarSettings() {
  const can = useAuth((s) => s.can); const edit = can('bar.configure'); const g = useGet('/bar/settings'); const menu = useGet('/bar/menu');
  return (
    <div><SubNav can={can} />
      <PageHeader title="Bar settings" subtitle="Rules the client has not confirmed yet are configured here - none of them is switched on by default" />
      {!edit && <Notice tone="blue" title="View only">You can see these settings but not change them.</Notice>}
      <Async state={g}>{(s) => <Form s={s} meta={g.raw} menu={menu.data || []} edit={edit} onSaved={g.reload} />}</Async>
    </div>
  );
}
function Form({ s, meta, menu, edit, onSaved }) {
  const [f, setF] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  useEffect(() => { setF({ pegMl: s.pegMl, autoOpenBottles: s.autoOpenBottles, allowSalesWithoutConsumption: s.allowSalesWithoutConsumption, requireOpenShift: s.requireOpenShift, rules: s.happyHour.rules.map((r) => ({ ...r })), tolMl: s.variance.toleranceMl ?? '', tolPct: s.variance.tolerancePercent ?? '', tolOther: s.variance.toleranceOther ?? '',
    roles: s.variance.recipients.roles, defs: s.shifts.definitions.map((d) => ({ ...d })), wastage: s.wastageReasons.join('\n'), breakage: s.breakageReasons.join('\n'), billingNote: s.billing?.note || '' }); }, [s]);
  if (!f) return null; const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const dis = !edit;
  const setRule = (i, k, v) => set('rules', f.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => { setErr('');
    const body = { pegMl: Number(f.pegMl), autoOpenBottles: f.autoOpenBottles, allowSalesWithoutConsumption: f.allowSalesWithoutConsumption, requireOpenShift: f.requireOpenShift,
      happyHour: { rules: f.rules.map((r) => ({ id: r.id, name: r.name, active: r.active !== false, days: r.days, start: r.start, end: r.end, scope: r.scope, menuItems: r.scope === 'items' ? r.menuItems : [], mode: r.mode, ...(r.mode === 'percent' ? { percentOff: Number(r.percentOff) } : {}) })) },
      variance: { toleranceMl: nv(f.tolMl), tolerancePercent: nv(f.tolPct), toleranceOther: nv(f.tolOther), recipients: { roles: f.roles } },
      shifts: { definitions: f.defs.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), ...(d.start ? { start: d.start } : {}), ...(d.end ? { end: d.end } : {}) })) },
      wastageReasons: f.wastage.split('\n').map((x) => x.trim()).filter(Boolean), breakageReasons: f.breakage.split('\n').map((x) => x.trim()).filter(Boolean), billing: { note: f.billingNote } };
    try { await run(() => api.put('/bar/settings', body)); toast.success('Bar settings saved'); onSaved(); } catch (e) { setErr(e.message); } };
  return (
    <div className="space-y-4">{err && <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{err}</p>}
      <Card title="Happy-hour pricing" badge={<Badge tone="amber">To be confirmed</Badge>} action={edit && <Button size="sm" variant="secondary" onClick={() => set('rules', [...f.rules, { name: '', active: true, days: [1, 2, 3, 4, 5], start: '17:00', end: '19:00', scope: 'all', menuItems: [], mode: 'percent', percentOff: 10 }])}><Plus size={13} />Add rule</Button>}>
        {!f.rules.length ? <Notice title="Happy hour is not configured">Normal menu prices apply at all times. The hotel's timings and rules are still to be confirmed; the values pre-filled when you add a rule are only a starting point - change them to the hotel's real rule.</Notice> : null}
        <div className="space-y-3">{f.rules.map((r, i) => (<div key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-slate-200">
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]"><Input disabled={dis} placeholder="Rule name" value={r.name} onChange={(e) => setRule(i, 'name', e.target.value)} /><Input disabled={dis} type="time" value={r.start} onChange={(e) => setRule(i, 'start', e.target.value)} aria-label="Start" /><Input disabled={dis} type="time" value={r.end} onChange={(e) => setRule(i, 'end', e.target.value)} aria-label="End" /><Switch disabled={dis} checked={r.active !== false} onChange={(v) => setRule(i, 'active', v?.target ? v.target.checked : v)} label="Active" /></div>
          <div className="flex flex-wrap gap-1.5">{DAYS.map((d, n) => <button key={d} type="button" disabled={dis} onClick={() => setRule(i, 'days', r.days.includes(n) ? r.days.filter((x) => x !== n) : [...r.days, n])} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${r.days.includes(n) ? 'bg-brand-100 text-brand-800 ring-brand-300' : 'bg-white text-slate-500 ring-slate-200'}`}>{d}</button>)}</div>
          <div className="grid gap-2 sm:grid-cols-3"><Select disabled={dis} value={r.mode} onChange={(e) => setRule(i, 'mode', e.target.value)}><option value="percent">Percent off the normal price</option><option value="itemPrice">Use each drink's happy-hour price</option></Select>
            {r.mode === 'percent' ? <Input disabled={dis} type="number" min="1" max="99" value={r.percentOff ?? ''} onChange={(e) => setRule(i, 'percentOff', e.target.value)} placeholder="% off" /> : <span className="self-center text-xs text-slate-500">Set happy-hour prices on the bar menu</span>}
            <Select disabled={dis} value={r.scope} onChange={(e) => setRule(i, 'scope', e.target.value)}><option value="all">All drinks</option><option value="items">Selected drinks</option></Select></div>
          {r.scope === 'items' && <div className="flex flex-wrap gap-1.5">{menu.map((m) => <button key={m._id} type="button" disabled={dis} onClick={() => setRule(i, 'menuItems', (r.menuItems || []).includes(m._id) ? r.menuItems.filter((x) => x !== m._id) : [...(r.menuItems || []), m._id])} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${(r.menuItems || []).includes(m._id) ? 'bg-brand-100 text-brand-800 ring-brand-300' : 'bg-white text-slate-500 ring-slate-200'}`}>{m.name}</button>)}</div>}
          {edit && <Button size="sm" variant="ghost" onClick={() => set('rules', f.rules.filter((_, j) => j !== i))}><Trash2 size={13} />Remove rule</Button>}</div>))}</div></Card>
      <Card title="Stock variance" badge={<Badge tone="amber">To be confirmed</Badge>}>
        {nv(f.tolMl) == null && nv(f.tolPct) == null && nv(f.tolOther) == null && <Notice title="No tolerance is set">Every difference between expected and counted stock is reported until you set one.</Notice>}
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Liquor tolerance (ml)" hint="Differences up to this are not reported"><Input disabled={dis} type="number" min="0" value={f.tolMl} onChange={(e) => set('tolMl', e.target.value)} placeholder="not set" /></Field><Field label="Other items tolerance (units)"><Input disabled={dis} type="number" min="0" value={f.tolOther} onChange={(e) => set('tolOther', e.target.value)} placeholder="not set" /></Field><Field label="Tolerance (% of expected)"><Input disabled={dis} type="number" min="0" max="100" value={f.tolPct} onChange={(e) => set('tolPct', e.target.value)} placeholder="not set" /></Field></div>
        <Field label="Who receives variance alerts" hint={f.roles.length ? '' : 'None chosen: alerts go to everyone who can view stock variance.'}><div className="flex flex-wrap gap-1.5">{(meta.recipientRoles || []).map((r) => <button key={r.key} type="button" disabled={dis} onClick={() => set('roles', f.roles.includes(r.key) ? f.roles.filter((x) => x !== r.key) : [...f.roles, r.key])} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${f.roles.includes(r.key) ? 'bg-brand-100 text-brand-800 ring-brand-300' : 'bg-white text-slate-500 ring-slate-200'}`}>{r.name}</button>)}</div></Field></Card>
      <Card title="Shifts" badge={<Badge tone="amber">Not specified by the client</Badge>} action={edit && <Button size="sm" variant="secondary" onClick={() => set('defs', [...f.defs, { name: '', start: '', end: '' }])}><Plus size={13} />Add shift</Button>}>
        {!f.defs.length && <p className="text-sm text-slate-500">No shifts are defined: bartenders start and close shifts freely. Add shifts here only if the hotel confirms them.</p>}
        {f.defs.map((d, i) => <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]"><Input disabled={dis} placeholder="Shift name" value={d.name} onChange={(e) => set('defs', f.defs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><Input disabled={dis} type="time" value={d.start || ''} onChange={(e) => set('defs', f.defs.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} /><Input disabled={dis} type="time" value={d.end || ''} onChange={(e) => set('defs', f.defs.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} />{edit && <Button size="sm" variant="ghost" aria-label="Remove shift" onClick={() => set('defs', f.defs.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>}</div>)}</Card>
      <Card title="Bar rules">
        <div className="space-y-3"><Switch disabled={dis} checked={f.requireOpenShift} onChange={(v) => set('requireOpenShift', v?.target ? v.target.checked : v)} label="Orders, complimentary issues and wastage need the user's open shift" />
          <Switch disabled={dis} checked={f.autoOpenBottles} onChange={(v) => set('autoOpenBottles', v?.target ? v.target.checked : v)} label="Open a bottle automatically when a peg order needs one (still recorded as an opening)" />
          <Switch disabled={dis} checked={f.allowSalesWithoutConsumption} onChange={(v) => set('allowSalesWithoutConsumption', v?.target ? v.target.checked : v)} label="Allow selling drinks whose stock consumption is not configured (no stock is deducted)" />
          <Field label="Peg size used for peg variance (ml)"><Input disabled={dis} type="number" min="5" max="200" className="!w-32" value={f.pegMl} onChange={(e) => set('pegMl', e.target.value)} /></Field></div></Card>
      <Card title="Wastage & breakage reasons"><div className="grid gap-3 sm:grid-cols-2"><Field label="Wastage reasons (one per line)"><Textarea disabled={dis} rows={5} value={f.wastage} onChange={(e) => set('wastage', e.target.value)} /></Field><Field label="Breakage reasons (one per line)"><Textarea disabled={dis} rows={5} value={f.breakage} onChange={(e) => set('breakage', e.target.value)} /></Field></div></Card>
      <Card title="Bar billing" badge={<Badge tone="amber">To be confirmed</Badge>}><Notice tone="blue" title="Not decided yet">Whether bar sales are billed on a separate bill, posted to the room bill, or both has not been confirmed. Until then bar orders are recorded as "Pending destination decision" and nothing is billed or posted.</Notice>
        <Field label="Note for the team"><Textarea disabled={dis} rows={2} value={f.billingNote} onChange={(e) => set('billingNote', e.target.value)} /></Field></Card>
      {edit && <div className="sticky bottom-3 flex justify-end"><Button loading={busy} onClick={save}>Save settings</Button></div>}</div>
  );
}
