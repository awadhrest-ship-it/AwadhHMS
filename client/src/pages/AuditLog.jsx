import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useGet, useDebounced } from '../hooks/useApi';
import { Async, Badge, Button, EmptyState, Field, Input, PageHeader, Select } from '../components/ui';
import { Drawer } from '../components/feedback';
import { fmtDateTime } from '../utils/format';

const TONE = { create: 'green', update: 'blue', delete: 'red', status: 'indigo', approve: 'green', reject: 'red', login: 'slate', logout: 'slate' };
const Json = ({ v }) => (v ? <pre className="scroll-thin max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed">{JSON.stringify(v, null, 2)}</pre> : <p className="text-sm text-slate-400">—</p>);

export default function AuditLog() {
  const [module, setModule] = useState(''); const [action, setAction] = useState(''); const [q, setQ] = useState(''); const dq = useDebounced(q); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1); const [sel, setSel] = useState(null);
  const mods = useGet('/audit-logs/modules'); const st = useGet('/audit-logs', { module: module || undefined, action: action || undefined, q: dq || undefined, from: from || undefined, to: to || undefined, page, limit: 40 });
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };
  return (<>
    <PageHeader title="Audit log" subtitle="Every create, edit, delete, status change and approval — nothing is overwritten" />
    <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"><Field label="Search"><Input placeholder="User, record or note" value={q} onChange={reset(setQ)} /></Field>
      <Field label="Module"><Select value={module} onChange={reset(setModule)}><option value="">All</option>{(mods.data || []).map((m) => <option key={m}>{m}</option>)}</Select></Field>
      <Field label="Action"><Select value={action} onChange={reset(setAction)}><option value="">All</option>{Object.keys(TONE).map((a) => <option key={a}>{a}</option>)}</Select></Field>
      <Field label="From"><Input type="date" value={from} onChange={reset(setFrom)} /></Field><Field label="To"><Input type="date" value={to} onChange={reset(setTo)} /></Field></div>
    <div className="card"><Async state={st} empty={<EmptyState icon={ScrollText} title="No audit entries match" />}>
      {(rows) => (<><ul className="divide-y divide-slate-100">{rows.map((a) => <li key={a._id}><button onClick={() => setSel(a)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-slate-50"><Badge tone={TONE[a.action] || 'slate'}>{a.action}</Badge><span className="text-sm font-semibold">{a.userName || 'System'}</span><span className="text-xs text-slate-400">{a.userRole}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-600">{a.module} · {a.entity} {a.entityLabel}{a.note ? ` — ${a.note}` : ''}</span><span className="text-xs text-slate-400">{fmtDateTime(a.timestamp)}</span></button></li>)}</ul>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm"><span className="text-slate-500">{st.raw?.total} entries · page {st.raw?.page} of {st.raw?.pages}</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= (st.raw?.pages || 1)} onClick={() => setPage(page + 1)}>Next</Button></div></div></>)}
    </Async></div>
    <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.action} · ${sel.entity}` : ''} subtitle={sel?.entityLabel} width="max-w-xl">{sel && <div className="space-y-4 text-sm"><dl className="grid grid-cols-2 gap-3"><div><dt className="label">User</dt><dd className="font-semibold">{sel.userName} ({sel.userRole})</dd></div><div><dt className="label">When</dt><dd>{fmtDateTime(sel.timestamp)}</dd></div><div><dt className="label">Module</dt><dd>{sel.module}</dd></div><div><dt className="label">IP / device</dt><dd className="truncate text-xs">{sel.ip} {sel.userAgent}</dd></div></dl>{sel.note && <p className="rounded-lg bg-slate-50 p-3">{sel.note}</p>}<div><p className="label">Old value</p><Json v={sel.oldValue} /></div><div><p className="label">New value</p><Json v={sel.newValue} /></div></div>}</Drawer>
  </>);
}
