import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { toast } from '../../store/toast';
import { Async, Button, Card, Field, Input, PageHeader, Switch, TBC } from '../../components/ui';

function ListEditor({ label, value, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]); setDraft(''); };
  return (
    <div>
      <p className="label">{label}</p>
      <ul className="mb-2 space-y-1">{value.map((v, i) => <li key={`${v}-${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"><span className="flex-1">{v}</span><button type="button" aria-label={`Remove ${v}`} disabled={value.length <= 1} className="text-slate-400 hover:text-red-600 disabled:opacity-30" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={15} /></button></li>)}</ul>
      <div className="flex gap-2"><Input aria-label={`Add to ${label}`} placeholder="Add a checklist item" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()}><Plus size={16} />Add</Button></div>
    </div>
  );
}

export default function Settings() {
  const st = useGet('/housekeeping/settings'); const [f, setF] = useState(null); const [run, busy] = useAction();
  useEffect(() => { if (st.data) setF(JSON.parse(JSON.stringify(st.data))); }, [st.data]);
  const save = async () => {
    try {
      const body = { checklistTemplates: f.checklistTemplates, targetMinutes: Object.fromEntries(Object.entries(f.targetMinutes).map(([k, v]) => [k, Number(v)])), requireChecklistComplete: f.requireChecklistComplete, requirePhotos: f.requirePhotos, inspectorMustDifferFromCleaner: f.inspectorMustDifferFromCleaner, stayoverNeedsInspection: f.stayoverNeedsInspection, priorityWhenArrivalToday: f.priorityWhenArrivalToday };
      await run(() => api.put('/housekeeping/settings', body)); toast.success('Housekeeping settings saved'); st.reload();
    } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <PageHeader title="Housekeeping settings" subtitle="Checklists and rules. Anything the hotel hasn't confirmed is marked TBC and can be changed here." actions={<Button loading={busy} onClick={save} disabled={!f}>Save changes</Button>} />
      <Async state={st} isEmpty={() => false}>{() => f && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Cleaning checklists" badge={<TBC>Contents TBC</TBC>}>
            <div className="space-y-6">
              <ListEditor label="Check-out clean" value={f.checklistTemplates.checkout} onChange={(v) => setF({ ...f, checklistTemplates: { ...f.checklistTemplates, checkout: v } })} />
              <ListEditor label="Stay-over clean" value={f.checklistTemplates.stayover} onChange={(v) => setF({ ...f, checklistTemplates: { ...f.checklistTemplates, stayover: v } })} />
              <p className="text-xs text-slate-500">Changes apply to tasks created from now on; tasks already in progress keep their list.</p>
            </div>
          </Card>
          <div className="space-y-5">
            <Card title="Target time (minutes)" badge={<TBC>TBC</TBC>}>
              <div className="grid grid-cols-3 gap-3">{['Checkout', 'Stay-over', 'Manual'].map((k) => <Field key={k} label={k}><Input type="number" min="5" max="480" value={f.targetMinutes[k]} onChange={(e) => setF({ ...f, targetMinutes: { ...f.targetMinutes, [k]: e.target.value } })} /></Field>)}</div>
              <p className="mt-2 text-xs text-slate-500">Used only to show a task as overdue.</p>
            </Card>
            <Card title="Rules">
              <div className="space-y-4">
                <Switch checked={f.requireChecklistComplete} onChange={(v) => setF({ ...f, requireChecklistComplete: v })} label="Whole checklist must be ticked before submitting" />
                <Switch checked={f.requirePhotos} onChange={(v) => setF({ ...f, requirePhotos: v })} label="Require before and after photos" />
                <Switch checked={f.inspectorMustDifferFromCleaner} onChange={(v) => setF({ ...f, inspectorMustDifferFromCleaner: v })} label="Inspector must be a different person from the cleaner" />
                <Switch checked={f.stayoverNeedsInspection} onChange={(v) => setF({ ...f, stayoverNeedsInspection: v })} label="Stay-over cleans also need inspection" />
                <Switch checked={f.priorityWhenArrivalToday} onChange={(v) => setF({ ...f, priorityWhenArrivalToday: v })} label="High priority when a guest arrives in the room today" />
                <p className="text-xs text-slate-500">Which role is the supervisor is not yet confirmed <TBC>TBC</TBC>: anyone whose role has the “inspect rooms” permission can inspect (Settings → Roles).</p>
              </div>
            </Card>
          </div>
        </div>
      )}</Async>
    </>
  );
}
