import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ReceiptText, Plus } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, Select, Table, TBC } from '../components/ui';
import { Modal } from '../components/feedback';
import { fmtDateTime, fmtHotelDate, fullName, money } from '../utils/format';

export function Bills() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const [flt, setFlt] = useState(sp.get('due') ? 'due' : 'all');
  const st = useGet('/bills', { due: flt === 'due' || undefined });
  return (<>
    <PageHeader title="Guest bills" subtitle="Charges, payments and outstanding balances" />
    <Pills className="mb-4" value={flt} onChange={setFlt} items={[{ key: 'all', label: 'All bills' }, { key: 'due', label: 'Outstanding only' }]} />
    <div className="card"><Async state={st} empty={<EmptyState icon={ReceiptText} title="No bills to show" text={flt === 'due' ? 'Nothing is outstanding right now.' : 'Bills appear after a guest’s booking has charges or payments.'} />}>
      {(rows) => <Table rows={rows} onRow={(b) => nav(`/bills/${b._id}`)} columns={[{ header: 'Bill', render: (b) => <b>{b.folioNumber}</b> }, { header: 'Guest', render: (b) => fullName(b.guest) }, { header: 'Room', render: (b) => b.room?.roomNumber || '—' }, { header: 'Booking', render: (b) => b.reservation?.reservationNumber }, { header: 'Charges', render: (b) => money(b.totalCharges) }, { header: 'Paid', render: (b) => money(b.totalPaid) }, { header: 'Outstanding', render: (b) => (b.outstanding > 0 ? <b className="text-red-600">{money(b.outstanding)}</b> : <Badge tone="green">Settled</Badge>) }, { header: 'Status', render: (b) => <Badge tone={b.status === 'Open' ? 'amber' : 'green'}>{b.status}</Badge> }]} />}
    </Async></div>
  </>);
}

function PaymentModal({ bill, onClose, onSaved }) {
  const prop = useGet('/property'); const [amount, setAmount] = useState(bill.outstanding > 0 ? bill.outstanding : ''); const [method, setMethod] = useState(''); const [ref, setRef] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const save = async () => { try { await run(() => api.post(`/bills/${bill._id}/payment`, { amount: Number(amount), method, reference: ref || undefined })); toast.success('Payment recorded'); onSaved(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} size="sm" title="Record payment" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!(Number(amount) > 0) || !method}>Record payment</Button></>}>
    <div className="grid gap-4"><Field label="Amount (₹)" required><Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <Field label={<>Method <TBC /></>} required><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Select…</option>{(prop.data?.settings?.paymentMethods || []).map((m) => <option key={m}>{m}</option>)}</Select></Field>
      <Field label="Reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Txn ID / receipt no." /></Field></div>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}

export function BillDetail() {
  const { id } = useParams(); const can = useAuth((s) => s.can); const st = useGet(`/bills/${id}`); const [pay, setPay] = useState(false);
  return <Async state={st} isEmpty={() => false}>{(b) => (<>
    <Link to="/bills" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-brand-700"><ArrowLeft size={15} />Guest bills</Link>
    <PageHeader title={b.folioNumber} subtitle={`${fullName(b.guest)} · Room ${b.room?.roomNumber || '—'} · ${b.reservation?.reservationNumber}`} actions={<>{can('bills.payment') && <Button onClick={() => setPay(true)}><Plus size={15} />Record payment</Button>}<Link className="btn btn-secondary" to={`/reservations/${b.reservation?._id}`}>Booking</Link></>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><Card><p className="label">Total charges</p><p className="text-2xl font-extrabold">{money(b.totalCharges)}</p></Card><Card><p className="label">Paid</p><p className="text-2xl font-extrabold text-green-700">{money(b.totalPaid)}</p></Card><Card><p className="label">Outstanding</p><p className={`text-2xl font-extrabold ${b.outstanding > 0 ? 'text-red-600' : ''}`}>{money(b.outstanding)}</p></Card></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Charges" pad={false} badge={<TBC>Taxes & invoice format TBC</TBC>}><Table dense rows={b.charges} empty={<EmptyState title="No charges posted yet" text="Room charges post when the guest checks in." />} columns={[{ header: 'Description', key: 'description' }, { header: 'Type', render: (c) => <Badge>{c.type}</Badge> }, { header: 'Amount', className: 'text-right', render: (c) => money(c.amount) }]} /></Card>
      <Card title="Payments" pad={false}><Table dense rows={b.payments} empty={<EmptyState title="No payments yet" />} columns={[{ header: 'When', render: (p) => fmtDateTime(p.receivedAt) }, { header: 'Method', render: (p) => <>{p.method}{p.kind === 'Advance' && <Badge tone="blue" className="ml-1">Advance</Badge>}</> }, { header: 'By', render: (p) => p.receivedBy?.name }, { header: 'Amount', render: (p) => money(p.amount) }]} /></Card>
    </div>
    <p className="mt-3 text-xs text-slate-400">Room-service and other department charges will post to this bill in later phases. Discounts, refunds and bill edits go through approval.</p>
    {pay && <PaymentModal bill={b} onClose={() => setPay(false)} onSaved={() => { setPay(false); st.reload(); }} />}
  </>)}</Async>;
}
