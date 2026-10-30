import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { toast } from '../store/toast';
import { Async, Badge, Button, EmptyState, PageHeader, Pills, Table, TBC } from '../components/ui';
import { ConfirmDialog } from '../components/feedback';
import { APPROVAL_TONE } from '../utils/constants';
import { fmtDateTime, money } from '../utils/format';

export default function Approvals() {
  const [flt, setFlt] = useState('Pending'); const st = useGet('/approvals', { status: flt === 'all' ? undefined : flt }); const [dlg, setDlg] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const act = async (reasonOrComment) => { setErr(''); const { kind, a } = dlg; try { await run(() => api.post(`/approvals/${a._id}/${kind}`, kind === 'reject' ? { reason: reasonOrComment } : {})); toast.success(kind === 'approve' ? 'Request approved' : 'Request rejected'); setDlg(null); st.reload(); } catch (e) { setErr(e.message); } };
  const detail = (a) => a.type === 'Booking price change' ? (a.payload?.directRate != null ? `Nightly rate ${money(a.payload.oldRate)} → ${money(a.payload.directRate)}` : a.payload?.newTotal != null ? `Total ${money(a.payload.oldTotal)} → ${money(a.payload.newTotal)}` : '') : a.type === 'Booking cancellation' ? a.payload?.reason : a.comments;
  return (<>
    <PageHeader title="Approvals" subtitle="Sensitive actions are reviewed before they take effect — every decision is recorded" actions={<TBC>Value thresholds TBC</TBC>} />
    <Pills className="mb-4" value={flt} onChange={setFlt} items={[{ key: 'Pending', label: 'Pending' }, { key: 'Approved', label: 'Approved' }, { key: 'Rejected', label: 'Rejected' }, { key: 'all', label: 'All' }]} />
    <div className="card"><Async state={st} empty={<EmptyState icon={ShieldCheck} title={flt === 'Pending' ? 'Nothing waiting for approval' : 'No requests'} text="Cancellations and price changes appear here when staff submit them." />}>
      {(rows) => <Table rows={rows} columns={[{ header: 'Request', render: (a) => <><b>{a.type}</b><br /><span className="text-xs text-slate-400">{a.requestNumber}</span></> }, { header: 'Reference', render: (a) => (a.referenceModel === 'Reservation' ? <Link className="font-semibold text-brand-700" to={`/reservations/${a.referenceId}`}>{a.referenceLabel}</Link> : a.referenceLabel) }, { header: 'Detail', render: (a) => <span className="text-xs text-slate-600">{detail(a)}</span> }, { header: 'Value', render: (a) => (a.amount ? money(a.amount) : '—') }, { header: 'Requested by', render: (a) => <>{a.requestedBy?.name}<br /><span className="text-xs text-slate-400">{fmtDateTime(a.requestedAt)}</span></> }, { header: 'Status', render: (a) => <><Badge tone={APPROVAL_TONE[a.status]}>{a.status}</Badge>{a.status !== 'Pending' && <p className="mt-1 text-xs text-slate-500">{a.approver?.name}{a.rejectionReason ? ` · ${a.rejectionReason}` : ''}</p>}</> },
        { header: 'Action', render: (a) => a.canDecide ? <div className="flex gap-1.5"><Button size="sm" onClick={() => { setErr(''); setDlg({ kind: 'approve', a }); }}>Approve</Button><Button size="sm" variant="secondary" onClick={() => { setErr(''); setDlg({ kind: 'reject', a }); }}>Reject</Button></div> : a.status === 'Pending' ? <span className="text-xs text-slate-400">Awaiting approver</span> : null }]} />}
    </Async></div>
    {dlg && <ConfirmDialog open onClose={() => setDlg(null)} danger={dlg.kind === 'reject'} reason={dlg.kind === 'reject'} reasonLabel="Rejection reason" title={`${dlg.kind === 'approve' ? 'Approve' : 'Reject'} ${dlg.a.type.toLowerCase()}`} message={dlg.kind === 'approve' ? `${dlg.a.referenceLabel}: this will be applied immediately.` : `${dlg.a.referenceLabel}: the request will be declined and the booking stays unchanged.`} confirmLabel={dlg.kind === 'approve' ? 'Approve' : 'Reject'} busy={busy} error={err} onConfirm={act} />}
  </>);
}
