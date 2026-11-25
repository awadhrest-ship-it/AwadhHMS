import { useState } from 'react';
import { Gift } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Notice, COMP_TONE, MEASURES, Mono, rs, idem, useIdemKey } from './shared';

export default function Complimentary() {
  const can = useAuth((s) => s.can); const g = useGet('/bar/complimentary', { limit: 100 }); const [form, setForm] = useState(false); const [run, busy] = useAction(); const [status, setStatus] = useState('');
  const issue = async (r) => { try { await run(() => api.post(`/bar/complimentary/${r._id}/issue`)); toast.success(`${r.requestNumber} issued - stock deducted`); g.reload(); } catch (e) { toast.error(e.message); g.reload(); } };
  const withdraw = async (r) => { try { await run(() => api.post(`/bar/complimentary/${r._id}/cancel`)); g.reload(); } catch (e) { toast.error(e.message); } };
  const rows = (g.data || []).filter((r) => !status || r.status === status);
  return (
    <div><SubNav can={can} />
      <PageHeader title="Complimentary drinks" subtitle="Free drinks need approval from the General Manager or Owner before they can be served" actions={can('bar.comp.request') && <Button onClick={() => setForm(true)}><Gift size={15} />Request complimentary drink</Button>} />
      <Notice tone="blue" title="How it works">Request → General Manager / Owner approves in <Link to="/approvals" className="font-semibold underline">Approvals</Link> → the bar issues the drink. Stock is deducted only when the approved drink is issued, and only once.</Notice>
      <div className="mb-3"><Select className="!w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All requests</option>{Object.keys(COMP_TONE).map((s) => <option key={s}>{s}</option>)}</Select></div>
      <Card pad={false}><Async state={{ ...g, data: g.data && rows }} empty={<EmptyState icon={Gift} title="No complimentary requests" />}>{(list) => <Table rows={list} columns={[
        { header: 'Request', render: (r) => <span><Mono>{r.requestNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(r.createdAt)} · {r.requestedByName}</span></span> },
        { header: 'Drink', render: (r) => <span className="font-semibold">{r.quantity} × {r.itemName} ({r.measure})<span className="block text-xs font-normal text-slate-500">Worth {rs(r.listValue)} · {r.reason}</span></span> },
        { header: 'Status', render: (r) => <span><Badge tone={COMP_TONE[r.status]}>{r.status}</Badge>{r.decisionReason && <span className="block text-xs text-red-700">{r.decisionReason}</span>}{r.issueError && r.status === 'Approved' && <span className="block text-xs text-red-700">{r.issueError}</span>}</span> },
        { header: 'Approval', render: (r) => r.approval?.requestNumber || '-' },
        { header: '', render: (r) => <div className="flex gap-1">{can('bar.comp.issue') && ['Approved', 'Issuing'].includes(r.status) && <Button size="sm" loading={busy} onClick={() => issue(r)}>Issue</Button>}{['Pending Approval', 'Approved'].includes(r.status) && can('bar.comp.request') && <Button size="sm" variant="ghost" onClick={() => withdraw(r)}>Withdraw</Button>}</div> }]} />}</Async></Card>
      <RequestModal open={form} onClose={() => setForm(false)} onDone={g.reload} />
    </div>
  );
}
function RequestModal({ open, onClose, onDone }) {
  const menu = useGet(open ? '/bar/menu' : null); const [f, setF] = useState({ menuItem: '', measure: '30 ml', quantity: 1, reason: '' }); const [run, busy] = useAction(); const key = useIdemKey(); const [err, setErr] = useState('');
  if (!open) return null; const m = (menu.data || []).find((x) => x._id === f.menuItem); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const go = async () => { setErr(''); try { await run(() => api.post('/bar/complimentary', { menuItem: f.menuItem, measure: f.measure, quantity: Number(f.quantity), reason: f.reason }, idem(key.get()))); key.renew(); toast.success('Sent for approval'); setF({ menuItem: '', measure: '30 ml', quantity: 1, reason: '' }); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} size="sm" title="Request complimentary drink" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.menuItem || f.reason.trim().length < 5} onClick={go}>Send for approval</Button></>}>
    <div className="space-y-3">{err && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
      <Field label="Drink" required><Select value={f.menuItem} onChange={(e) => set('menuItem', e.target.value)}><option value="">Choose…</option>{(menu.data || []).filter((x) => x.active).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Serving"><Select value={f.measure} onChange={(e) => set('measure', e.target.value)}>{(m ? m.servings.filter((s) => s.active !== false).map((s) => s.measure) : MEASURES).map((x) => <option key={x}>{x}</option>)}</Select></Field><Field label="Quantity"><Input type="number" min="1" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field></div>
      <Field label="Reason" required hint="At least 5 characters"><Textarea rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field></div></Modal>;
}
