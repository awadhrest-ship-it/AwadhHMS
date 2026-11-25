import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, Receipt, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, Select, Table, Textarea } from '../../components/ui';
import { ConfirmDialog, Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { ADJ_TONE, BILL_TONE, Mono, SETTLE_TONE, SubNav, TypeBadge, idem, rs, useIdemKey } from './shared';

export function RestaurantBills() {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const [f, setF] = useState('open'); const [q, setQ] = useState(''); const [page, setPage] = useState(1); const dq = useDebounced(q, 300);
  const params = { ...(f === 'open' ? { status: 'Draft,Final', settlement: undefined } : f === 'unpaid' ? { status: 'Final', settlement: 'Unsettled,Part-paid' } : f === 'paid' ? { settlement: 'Paid,Posted to Room' } : { includeVoid: 'true' }), ...(dq ? { q: dq } : {}), page, limit: 30 };
  const list = useGet('/restaurant/bills', params);
  return (
    <div><PageHeader title="Restaurant bills" subtitle="Bills, split bills, payments and room-service postings" /><SubNav can={can} />
      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><Pills items={[{ key: 'open', label: 'Open' }, { key: 'unpaid', label: 'Awaiting payment' }, { key: 'paid', label: 'Settled' }, { key: 'all', label: 'All' }]} value={f} onChange={(v) => { setF(v); setPage(1); }} />
          <Input className="sm:!w-64" placeholder="Bill, order or guest…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search bills" /></div>
        <Async state={{ ...list, data: list.data ? list.raw.data : null }} empty={<EmptyState icon={Receipt} title="No bills here" text="Create a bill from an order on the Orders page." />}>{(rows) => (
          <Table onRow={(r) => nav(`/restaurant/bills/${r._id}`)} columns={[
            { header: 'Bill', render: (r) => <div><Mono>{r.billNumber}</Mono>{r.splitCount > 1 && <span className="ml-1 text-xs text-slate-500">({r.label})</span>}</div> }, { header: 'Order', render: (r) => <Mono>{r.orderNumber}</Mono> }, { header: 'Type', render: (r) => <TypeBadge type={r.orderType} /> },
            { header: 'For', render: (r) => r.guest?.name || '—' }, { header: 'Total', className: 'text-right', render: (r) => rs(r.totals?.total) }, { header: 'Balance', className: 'text-right', render: (r) => (r.status === 'Final' && r.orderType !== 'Room Service' ? rs(r.balanceMinor / 100) : '—') },
            { header: 'Status', render: (r) => <div className="flex gap-1"><Badge tone={BILL_TONE[r.status]}>{r.status}</Badge>{r.status === 'Final' && <Badge tone={SETTLE_TONE[r.settlement]}>{r.settlement}</Badge>}{r.posting?.state === 'Failed' && <Badge tone="red">Not posted</Badge>}</div> },
          ]} rows={rows} />)}</Async>
        {list.raw?.pages > 1 && <div className="flex justify-end gap-2 border-t border-slate-100 p-3"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= list.raw.pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
      </Card></div>);
}

export function RestaurantBillDetail() {
  const { id } = useParams(); const can = useAuth((s) => s.can); const b = useGet(`/restaurant/bills/${id}`); const settings = useGet('/restaurant/settings'); const [run, busy] = useAction();
  const [modal, setModal] = useState(null); const [err, setErr] = useState('');
  const d = b.data; const act = async (fn, msg) => { setErr(''); try { const r = await run(fn); if (msg) toast.success(typeof msg === 'function' ? msg(r) : msg); b.reload(); return r; } catch (e) { setErr(e.message); return null; } };
  return (
    <div>
      <PageHeader back={<Link to="/restaurant/bills" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><ArrowLeft size={13} />All bills</Link>} title={d ? d.billNumber : 'Bill'} subtitle={d && <>For order <Link className="font-semibold text-brand-700" to="/restaurant/orders">{d.orderNumber}</Link> · {d.order?.type}{d.order?.tableNumber ? ` · table ${d.order.tableNumber}` : ''}{d.order?.stay ? ` · room ${d.order.stay.roomNumber} (${d.order.stay.guestName})` : ''}</>}
        actions={d && d.status !== 'Draft' && <Button variant="secondary" onClick={() => setModal('receipt')}><Printer size={15} />Receipt</Button>} />
      <Async state={b}>{() => d && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <Card title="Items" pad={false} badge={<div className="flex gap-1"><Badge tone={BILL_TONE[d.status]}>{d.status}</Badge>{d.status === 'Final' && <Badge tone={SETTLE_TONE[d.settlement]}>{d.settlement}</Badge>}</div>}>
              <Table columns={[{ header: 'Item', render: (l) => l.name }, { header: 'Qty', className: 'text-right', render: (l) => l.quantity }, { header: 'Rate', className: 'text-right', render: (l) => rs(l.unitPrice) }, { header: 'Amount', className: 'text-right', render: (l) => rs(l.unitPrice * l.quantity) }]} rows={d.lines.map((l, i) => ({ ...l, _id: i }))} />
              {d.siblings.length > 1 && <div className="border-t border-slate-100 p-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Split into {d.siblings.length} bills</p><div className="flex flex-wrap gap-2">{d.siblings.map((s) => <Link key={s._id} to={`/restaurant/bills/${s._id}`} className={`rounded-lg border px-3 py-1.5 text-xs ${s._id === d._id ? 'border-brand-500 bg-brand-50 font-bold' : 'border-slate-200 hover:bg-slate-50'}`}>{s.label} · {rs(s.totals?.total)}</Link>)}</div></div>}
            </Card>
            {d.adjustments.length > 0 && <Card title="Discount & complimentary requests"><ul className="space-y-3">{d.adjustments.map((a) => (
              <li key={a._id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{a.kind === 'Discount' ? `Discount ${a.mode === 'percent' ? `${a.value}%` : rs(a.value)}` : `Complimentary: ${a.lines.map((l) => `${l.quantity}× ${d.lines.find((x) => String(x.orderItem) === String(l.orderItem))?.name}`).join(', ')}`} · {rs(a.amount)}</span><Badge tone={ADJ_TONE[a.status]}>{a.status === 'Pending' ? 'Waiting for approval' : a.status}</Badge></div>
                <p className="mt-1 text-xs text-slate-500">“{a.reason}” — requested by {a.requestedByName}, {fmtDateTime(a.requestedAt)}{a.decidedByName && ` · decided by ${a.decidedByName}, ${fmtDateTime(a.decidedAt)}`}{a.decisionNote && ` · ${a.decisionNote}`}</p>
                {a.status === 'Applied' && <p className="mt-1 text-xs text-slate-500">Bill total {rs(a.beforeTotal)} → {rs(a.afterTotal)}</p>}
                {a.status === 'Pending' && can('approvals.approve') && <Link to="/approvals" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><ShieldCheck size={13} />Decide in Approvals</Link>}</li>))}</ul></Card>}
            {d.payments.length > 0 && <Card title="Payments" pad={false}><Table columns={[{ header: 'When', render: (p) => fmtDateTime(p.receivedAt) }, { header: 'Method', render: (p) => <>{p.method}{p.reference && <span className="text-xs text-slate-400"> · {p.reference}</span>}</> }, { header: 'By', render: (p) => p.receivedByName }, { header: 'Amount', className: 'text-right', render: (p) => rs(p.amount) }]} rows={d.payments} /></Card>}
          </div>
          <div className="space-y-4">
            <Card title="Totals">
              <dl className="space-y-1.5 text-sm">
                <Row l="Items total" v={rs(d.totals?.gross)} />{d.totals?.complimentary > 0 && <Row l="Complimentary items" v={`− ${rs(d.totals.complimentary)}`} />}{d.totals?.discount > 0 && <Row l="Discount" v={`− ${rs(d.totals.discount)}`} />}
                <Row l="Net amount" v={rs(d.totals?.net)} bold />{(d.totals?.taxes || []).map((t) => <Row key={t.code} l={`${t.name} (${t.ratePercent}%)`} v={rs(t.amount)} />)}
                {!d.totals?.taxes?.length && <p className="text-xs text-amber-700">{d.taxConfigured ? '' : 'No tax is configured for the restaurant yet (to be confirmed with the hotel).'}</p>}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-extrabold"><span>Total</span><span>{rs(d.totals?.total)}</span></div>
                {d.status === 'Final' && d.order?.type !== 'Room Service' && <><Row l="Paid" v={rs(d.paidMinor / 100)} /><div className="flex justify-between text-base font-bold"><span>Balance due</span><span className={d.balanceMinor ? 'text-red-600' : 'text-green-600'}>{rs(d.balanceMinor / 100)}</span></div></>}
              </dl>
              {d.taxSnapshot?.taxes?.length > 0 && <p className="mt-2 text-[11px] text-slate-400">Tax rates as they were when this bill was finalised.</p>}
            </Card>
            {d.order?.type === 'Room Service' && d.status === 'Final' && <Card title="Room bill">
              {d.posting?.state === 'Posted' ? <div className="text-sm"><Badge tone="teal">Posted to room {d.order.stay.roomNumber}</Badge><p className="mt-2 text-slate-600">{rs(d.posting.amount)} charged to guest bill <b>{d.folio?.folioNumber}</b> on {fmtDateTime(d.posting.postedAt)}. It is settled when the guest checks out - it is not a restaurant payment.</p>{can('bills.view') && d.posting.folio && <Link className="mt-2 inline-block text-sm font-semibold text-brand-700" to={`/bills/${d.posting.folio}`}>Open guest bill →</Link>}</div>
                : d.posting?.state === 'Reversed' ? <Badge tone="slate">Reversed on the guest bill</Badge>
                : <div className="text-sm"><Badge tone="red">{d.posting?.state === 'Failed' ? 'Not posted' : 'Posting…'}</Badge>{d.posting?.error && <p className="mt-2 text-red-700">{d.posting.error}</p>}{can('restaurant.billing') && <Button className="mt-3" loading={busy} onClick={() => act(() => api.post(`/restaurant/bills/${id}/post-to-folio`), 'Posting retried')}>Retry posting to room bill</Button>}</div>}
            </Card>}
            {err && <p className="rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
            <Card title="Actions"><div className="flex flex-col gap-2">
              {d.status === 'Draft' && can('restaurant.billing') && <>
                <Button variant="secondary" onClick={() => setModal('discount')} disabled={d.adjustments.some((a) => ['Pending', 'Applied'].includes(a.status) && a.kind === 'Discount')}>Request discount…</Button>
                <Button variant="secondary" onClick={() => setModal('comp')}>Request complimentary item…</Button>
                <Button onClick={() => setModal('finalise')} disabled={d.adjustments.some((a) => a.status === 'Pending')}>Finalise bill</Button>
                {d.adjustments.some((a) => a.status === 'Pending') && <p className="text-xs text-amber-700">Waiting for approval before this bill can be finalised. Pending requests change nothing on the bill.</p>}
                <Button variant="danger" onClick={() => setModal('void')}>Void draft</Button></>}
              {d.status === 'Final' && d.order?.type !== 'Room Service' && d.balanceMinor > 0 && can('restaurant.payment') && <Button onClick={() => setModal('pay')}>Record payment</Button>}
              {d.status === 'Final' && d.paidMinor === 0 && can('restaurant.void') && <Button variant="danger" onClick={() => setModal('void')}>Void bill (needs approval)</Button>}
              {d.status === 'Void' && <p className="text-sm text-slate-500">Voided {d.voidedAt && fmtDateTime(d.voidedAt)}: {d.voidReason}</p>}
              {d.status === 'Final' && d.settlement === 'Paid' && <p className="text-sm text-green-700">Fully paid.</p>}
            </div></Card>
          </div>
          <FinaliseDialog open={modal === 'finalise'} onClose={() => setModal(null)} bill={d} busy={busy} onConfirm={async () => { const r = await act(() => api.post(`/restaurant/bills/${id}/finalise`), (x) => x.data.message || 'Bill finalised'); if (r) setModal(null); }} />
          <DiscountModal open={modal === 'discount'} onClose={() => setModal(null)} bill={d} onDone={b.reload} />
          <CompModal open={modal === 'comp'} onClose={() => setModal(null)} bill={d} onDone={b.reload} />
          <PayModal open={modal === 'pay'} onClose={() => setModal(null)} bill={d} methods={settings.data?.effectivePaymentMethods || []} onDone={b.reload} />
          <ConfirmDialog open={modal === 'void'} onClose={() => setModal(null)} danger reason title={d.status === 'Draft' ? 'Void this draft bill?' : 'Request to void this bill?'} confirmLabel={d.status === 'Draft' ? 'Void draft' : 'Send for approval'} busy={busy}
            message={d.status === 'Draft' ? 'The order stays open; you can create a new bill.' : 'A General Manager or Owner must approve. For a room-service bill the charge on the guest bill is reversed (a reversal entry is added - history is never erased).'}
            onConfirm={async (reason) => { const r = await act(() => api.post(`/restaurant/bills/${id}/void`, { reason }), (x) => x.data.message); if (r) setModal(null); }} />
          <Modal open={modal === 'receipt'} onClose={() => setModal(null)} title="Receipt" size="sm" footer={<Button onClick={() => window.print()}><Printer size={15} />Print / save as PDF</Button>}><BillReceipt bill={d} /></Modal>
        </div>)}</Async>
    </div>);
}
const Row = ({ l, v, bold }) => <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}><dt className="text-slate-500">{l}</dt><dd>{v}</dd></div>;

function FinaliseDialog({ open, onClose, bill, onConfirm, busy }) {
  return <ConfirmDialog open={open} onClose={onClose} onConfirm={onConfirm} busy={busy} title="Finalise this bill?" confirmLabel="Finalise" message={`The bill (${rs(bill?.totals?.total)}) is frozen with today's tax settings and can no longer be changed. ${bill?.order?.type === 'Room Service' ? `It will be charged to the guest's room bill (room ${bill?.order?.stay?.roomNumber}).` : 'You can then record payments.'}`} />;
}
function DiscountModal({ open, onClose, bill, onDone }) {
  const [mode, setMode] = useState('percent'); const [value, setValue] = useState(''); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const go = async () => { setErr(''); try { const r = await run(() => api.post(`/restaurant/bills/${bill._id}/adjustments`, { kind: 'Discount', mode, value: Number(value), reason })); toast.info(r.data.message); setValue(''); setReason(''); onClose(); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal open={open} onClose={onClose} title="Request a discount" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!value || reason.trim().length < 3} onClick={go}>Send for approval</Button></>}>
    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A discount needs approval from the General Manager or Owner. The bill does not change until it is approved.</p>
    <div className="grid grid-cols-2 gap-3"><Field label="Type"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="percent">Percentage (%)</option><option value="amount">Fixed amount (₹)</option></Select></Field><Field label={mode === 'percent' ? 'Percent' : 'Amount'} required><Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></Field></div>
    <Field label="Reason" className="mt-3" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this discount being given?" /></Field>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
function CompModal({ open, onClose, bill, onDone }) {
  const [qty, setQty] = useState({}); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const lines = Object.entries(qty).filter(([, v]) => v > 0).map(([orderItem, quantity]) => ({ orderItem, quantity }));
  const go = async () => { setErr(''); try { const r = await run(() => api.post(`/restaurant/bills/${bill._id}/adjustments`, { kind: 'Complimentary', lines, reason })); toast.info(r.data.message); setQty({}); setReason(''); onClose(); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal open={open} onClose={onClose} title="Request complimentary item(s)" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!lines.length || reason.trim().length < 3} onClick={go}>Send for approval</Button></>}>
    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Complimentary food needs approval. The items stay chargeable until it is approved.</p>
    <ul className="divide-y divide-slate-100">{bill?.lines.map((l) => <li key={String(l.orderItem)} className="flex items-center justify-between py-2 text-sm"><span>{l.name} <span className="text-xs text-slate-400">(billed {l.quantity})</span></span><Input type="number" min="0" max={l.quantity} className="!w-20 text-center" value={qty[l.orderItem] || 0} onChange={(e) => setQty({ ...qty, [l.orderItem]: Math.min(l.quantity, Math.max(0, Number(e.target.value) || 0)) })} aria-label={`Complimentary ${l.name}`} /></li>)}</ul>
    <Field label="Reason" className="mt-3" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. service recovery, guest of the owner" /></Field>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
function PayModal({ open, onClose, bill, methods, onDone }) {
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState(''); const [ref, setRef] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState(''); const key = useIdemKey();
  const balance = (bill?.balanceMinor || 0) / 100; const touch = () => { key.renew(); setErr(''); };
  const go = async () => { setErr(''); try { const r = await run(() => api.post(`/restaurant/bills/${bill._id}/payments`, { amount: Number(amount || balance), method, reference: ref || undefined }, idem(key.get()))); key.renew(); toast.success(r.data.replayed ? 'Payment was already recorded - not duplicated' : 'Payment recorded'); setAmount(''); setRef(''); onClose(); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal open={open} onClose={onClose} title={`Payment · ${bill?.billNumber}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!method} onClick={go}>Record {rs(Number(amount || balance))}</Button></>}>
    <p className="mb-3 text-sm text-slate-600">Balance due <b>{rs(balance)}</b>. Part-payments are allowed.</p>
    <div className="grid grid-cols-2 gap-3"><Field label="Amount"><Input type="number" min="0.01" step="0.01" max={balance} placeholder={String(balance)} value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} /></Field><Field label="Method" required><Select value={method} onChange={(e) => { setMethod(e.target.value); touch(); }}><option value="">Select…</option>{methods.map((m) => <option key={m}>{m}</option>)}</Select></Field></div>
    <Field label="Reference (optional)" className="mt-3"><Input value={ref} onChange={(e) => { setRef(e.target.value); touch(); }} placeholder="Txn / slip no." /></Field>{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
function BillReceipt({ bill }) {
  return (
    <div className="print-area text-sm"><div className="text-center"><p className="text-base font-extrabold">AWADH PALACE</p><p className="text-xs text-slate-500">Restaurant {bill.status === 'Void' ? '· VOID' : bill.status === 'Draft' ? '· DRAFT' : 'bill'}</p></div>
      <div className="my-3 border-y border-dashed border-slate-300 py-2 text-xs"><div className="flex justify-between"><span>Bill {bill.billNumber}</span><span>{fmtDateTime(bill.finalisedAt || bill.createdAt)}</span></div><div className="flex justify-between"><span>Order {bill.orderNumber}</span><span>{bill.order?.type}</span></div>{bill.order?.tableNumber && <div>Table {bill.order.tableNumber}</div>}{bill.order?.stay && <div>Room {bill.order.stay.roomNumber} · {bill.order.stay.guestName}</div>}{bill.splitCount > 1 && <div>{bill.label} (split {bill.splitIndex}/{bill.splitCount})</div>}</div>
      <table className="w-full text-xs"><tbody>{bill.lines.map((l, i) => <tr key={i}><td className="py-0.5">{l.quantity} × {l.name}</td><td className="text-right">{rs(l.unitPrice * l.quantity)}</td></tr>)}</tbody></table>
      <div className="mt-2 space-y-0.5 border-t border-dashed border-slate-300 pt-2 text-xs"><Row l="Items total" v={rs(bill.totals?.gross)} />{bill.totals?.complimentary > 0 && <Row l="Complimentary" v={`− ${rs(bill.totals.complimentary)}`} />}{bill.totals?.discount > 0 && <Row l="Discount" v={`− ${rs(bill.totals.discount)}`} />}{(bill.totals?.taxes || []).map((t) => <Row key={t.code} l={`${t.name} ${t.ratePercent}%`} v={rs(t.amount)} />)}<div className="flex justify-between border-t border-slate-300 pt-1 text-sm font-extrabold"><span>TOTAL</span><span>{rs(bill.totals?.total)}</span></div></div>
      {bill.payments?.length > 0 && <div className="mt-2 text-xs">{bill.payments.map((p) => <div key={p._id} className="flex justify-between"><span>Paid · {p.method}</span><span>{rs(p.amount)}</span></div>)}<div className="flex justify-between font-bold"><span>Balance</span><span>{rs(bill.balanceMinor / 100)}</span></div></div>}
      {bill.posting?.state === 'Posted' && <p className="mt-2 text-center text-xs font-semibold">Charged to room {bill.order.stay.roomNumber} · {bill.folio?.folioNumber}</p>}
      <p className="mt-3 text-center text-[10px] text-slate-400">Thank you for dining with us.</p></div>);
}

/** The restaurant's view of its discount / complimentary requests. Deciding is done in the main Approvals page by GM / Owner. */
export function RestaurantApprovals() {
  const can = useAuth((s) => s.can); const [st, setSt] = useState(''); const list = useGet('/restaurant/adjustments', st ? { status: st } : {});
  return (
    <div><PageHeader title="Discount & complimentary approvals" subtitle="Requests on restaurant bills and what was decided" /><SubNav can={can} />
      <Card pad={false}><div className="border-b border-slate-100 p-4"><Pills items={[{ key: '', label: 'All' }, 'Pending', 'Applied', 'Rejected', 'Superseded']} value={st} onChange={setSt} /></div>
        <Async state={list} empty={<EmptyState icon={ShieldCheck} title="No requests" text="Discount and complimentary requests made on bills appear here." />}>{(rows) => (
          <Table columns={[{ header: 'Requested', render: (r) => fmtDateTime(r.requestedAt) }, { header: 'Bill', render: (r) => <Link className="font-semibold text-brand-700" to={`/restaurant/bills/${r.billId}`}>{r.billNumber}</Link> }, { header: 'Request', render: (r) => (r.kind === 'Discount' ? `Discount ${r.mode === 'percent' ? r.value + '%' : rs(r.value)}` : 'Complimentary item(s)') },
            { header: 'Value', className: 'text-right', render: (r) => rs(r.amount) }, { header: 'By', render: (r) => r.requestedByName }, { header: 'Reason', render: (r) => <span className="text-xs">{r.reason}</span> },
            { header: 'Status', render: (r) => <Badge tone={ADJ_TONE[r.status]}>{r.status}</Badge> }, { header: 'Decision', render: (r) => (r.decidedByName ? `${r.decidedByName}` : r.status === 'Pending' && can('approvals.approve') ? <Link className="text-xs font-semibold text-brand-700" to="/approvals">Decide →</Link> : '—') }]} rows={rows} />)}</Async></Card></div>);
}
