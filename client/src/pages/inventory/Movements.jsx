import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, Download, Plus, Search } from 'lucide-react';
import { useDebounced, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { Async, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table } from '../../components/ui';
import { Drawer } from '../../components/feedback';
import { MOVEMENT_STATUS_TONE, MOVEMENT_TONE, MOVEMENT_TYPES } from '../../utils/constants';
import { fmtDateTime } from '../../utils/format';
import { DeptSelect, dateOnly, downloadFile, qtyFmt, rupee, useInvScope } from './shared';
import MovementForm from './MovementForm';

const route = (l) => (l.fromDepartment && l.toDepartment ? `${l.fromDepartment} → ${l.toDepartment}` : l.toDepartment ? `→ ${l.toDepartment}` : l.fromDepartment ? `${l.fromDepartment} →` : '');

function Detail({ id, onClose }) {
  const st = useGet(id ? `/inventory/movements/${id}` : null, null, [id]);
  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-xl" title={st.data?.movementNumber || 'Movement'} subtitle={st.data && `${st.data.type} · ${fmtDateTime(st.data.createdAt)}`}>
      <Async state={st} isEmpty={() => false}>{(m) => (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5"><Badge tone={MOVEMENT_TONE[m.type]}>{m.type}</Badge><Badge tone={MOVEMENT_STATUS_TONE[m.status]}>{m.status}</Badge>{m.source && m.source !== 'inventory' && <Badge>{m.source}</Badge>}</div>
          {m.status === 'Awaiting Approval' && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">Waiting for approval{m.approval?.requestNumber ? ` (${m.approval.requestNumber})` : ''}. Stock has not changed. <Link to="/approvals" className="font-semibold underline">Open approvals</Link></p>}
          {m.status === 'Rejected' && <p className="rounded-lg bg-red-50 p-3 text-red-800">Rejected{m.approval?.rejectionReason ? `: ${m.approval.rejectionReason}` : ''}. Stock was not changed.</p>}
          {m.status === 'Failed' && <p className="rounded-lg bg-red-50 p-3 text-red-800">Could not be applied: {m.failureReason || 'unknown reason'}. No stock was changed.</p>}
          <Table dense rows={m.lines.map((l, i) => ({ ...l, _id: String(i) }))} columns={[
            { header: 'Item', render: (l) => <span className="font-semibold">{l.itemName}<span className="block text-xs font-normal text-slate-400">{l.sku}</span></span> },
            { header: 'Qty', className: 'text-right', render: (l) => <span>{l.direction === 'decrease' ? '−' : l.direction === 'increase' ? '+' : ''}{qtyFmt(l.quantity)} {l.unit}{l.unit !== l.baseUnit && <span className="block text-xs text-slate-400">= {qtyFmt(l.baseQty)} {l.baseUnit}</span>}</span> },
            { header: 'Department', render: (l) => <span className="text-xs">{route(l)}</span> },
            { header: 'Detail', render: (l) => <span className="text-xs text-slate-500">{[l.lotNo && `Batch ${l.lotNo}`, l.expiryDate && `Exp ${dateOnly(l.expiryDate)}`, l.unitPrice != null && `${rupee(l.unitPrice)}/${l.unit}`, l.supplier].filter(Boolean).join(' · ') || '—'}</span> },
          ]} />
          <dl className="grid grid-cols-2 gap-3"><div><dt className="label">By</dt><dd>{m.performedByName}</dd></div><div><dt className="label">Posted</dt><dd>{m.postedAt ? fmtDateTime(m.postedAt) : '—'}</dd></div>
            {m.reason && <div className="col-span-2"><dt className="label">Reason</dt><dd>{m.reason}</dd></div>}{m.notes && <div className="col-span-2"><dt className="label">Notes</dt><dd>{m.notes}</dd></div>}{m.reference?.label && <div><dt className="label">Reference</dt><dd>{m.reference.label}</dd></div>}</dl>
        </div>
      )}</Async>
    </Drawer>
  );
}

export default function Movements() {
  const can = useAuth((s) => s.can); const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [page, setPage] = useState(1); const [open, setOpen] = useState(null); const [form, setForm] = useState(false);
  const f = { type: sp.get('type') || '', status: sp.get('status') || '', department: sp.get('department') || '', from: sp.get('from') || '', to: sp.get('to') || '' };
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(1); };
  const { departments, ownOnly } = useInvScope();
  useEffect(() => { if (sp.get('new') === '1') { setForm(true); const n = new URLSearchParams(sp); n.delete('new'); setSp(n, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const params = { q: dq || undefined, type: f.type || undefined, status: f.status || undefined, department: f.department || undefined, from: f.from || undefined, to: f.to || undefined };
  const st = useGet('/inventory/movements', { ...params, page, limit: 50 });
  const canMove = can('inventory.move') || can('inventory.adjust');
  return (
    <>
      <PageHeader title="Stock movements" subtitle="Every receipt, issue, transfer, write-off and adjustment, with who did it and why"
        actions={<>{can('inventory.reports') && <Button variant="secondary" onClick={() => downloadFile('/inventory/movements', { ...params, format: 'csv' }, 'movements.csv')}><Download size={16} />Export CSV</Button>}{canMove && <Button onClick={() => setForm(true)}><Plus size={16} />Record movement</Button>}</>} />
      <Card pad={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><Input className="pl-9" aria-label="Search movements" placeholder="Reference, item, reason, person" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <Select aria-label="Type" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{MOVEMENT_TYPES.map((t) => <option key={t}>{t}</option>)}{f.type.includes(',') && <option value={f.type}>{f.type.replace(/,/g, ' / ')}</option>}</Select>
          <Select aria-label="Status" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{['Posted', 'Awaiting Approval', 'Rejected', 'Failed', 'Pending'].map((t) => <option key={t}>{t}</option>)}</Select>
          {!ownOnly && <DeptSelect value={f.department} onChange={(v) => set('department', v)} departments={departments} all="All departments" />}
          <Input type="date" aria-label="From date" value={f.from} onChange={(e) => set('from', e.target.value)} /><Input type="date" aria-label="To date" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <Async state={st} empty={<EmptyState icon={ArrowRightLeft} title="No movements found" text="Nothing matches these filters yet." />}>{(rows) => (
          <>
            <Table rows={rows} onRow={(r) => setOpen(r._id)} columns={[
              { header: 'Ref', render: (r) => <span className="font-mono text-xs">{r.movementNumber}</span> },
              { header: 'Type', render: (r) => <Badge tone={MOVEMENT_TONE[r.type]}>{r.type}</Badge> },
              { header: 'Items', render: (r) => <span className="text-sm">{r.lines.slice(0, 2).map((l) => `${l.itemName} ${qtyFmt(l.quantity)} ${l.unit}`).join(', ')}{r.lines.length > 2 ? ` +${r.lines.length - 2} more` : ''}</span> },
              { header: 'Dept', render: (r) => <span className="text-xs text-slate-500">{route(r.lines[0] || {})}</span> },
              { header: 'Status', render: (r) => <Badge tone={MOVEMENT_STATUS_TONE[r.status]}>{r.status}</Badge> },
              { header: 'By / when', render: (r) => <span className="text-xs text-slate-500">{r.performedByName}<br />{fmtDateTime(r.createdAt)}</span> },
            ]} />
            {(st.raw?.pages || 1) > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {st.raw.pages} · {st.raw.total} movements</span><Button size="sm" variant="secondary" disabled={page >= st.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
          </>
        )}</Async>
      </Card>
      <Detail id={open} onClose={() => setOpen(null)} />
      <MovementForm open={form} onClose={() => setForm(false)} onDone={st.reload} />
    </>
  );
}
