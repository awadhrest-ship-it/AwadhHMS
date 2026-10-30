import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAction } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Button, Field, Input, Select, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { ConvertPreview, InfoBox, ItemPicker, Replayed, qtyFmt, unitOptions, useIdemKey, useInvScope, useUnits } from './shared';

const REASON_REQUIRED = ['Stock Out', 'Wastage', 'Breakage', 'Damaged', 'Adjustment'];
const HINT = {
  'Stock In': 'Goods received into a department (purchase, return, donation). Price, supplier, batch and expiry are recorded.',
  'Stock Out': 'Stock issued or used. The oldest-expiring batch is used first (FEFO).',
  Transfer: 'Move stock between departments in one step. Both sides are recorded together.',
  Wastage: 'Spoiled, expired or spilt stock written off.', Breakage: 'Items broken during handling or use.', Damaged: 'Items damaged and no longer usable.',
  Adjustment: 'Correct the book quantity. This needs approval; stock does not change until it is approved.',
};
const newLine = (dept) => ({ item: null, quantity: '', unit: '', fromDepartment: dept || '', toDepartment: dept || '', unitPrice: '', supplier: '', lotNo: '', expiryDate: '', direction: 'increase' });

export default function MovementForm({ open, initialType = 'Stock In', onClose, onDone }) {
  const can = useAuth((s) => s.can); const { units } = useUnits(); const { departments, allDepartments, own } = useInvScope();
  const types = [...(can('inventory.move') ? ['Stock In', 'Stock Out', 'Transfer', 'Wastage', 'Breakage', 'Damaged'] : []), ...(can('inventory.adjust') ? ['Adjustment'] : [])];
  const [type, setType] = useState(initialType); const [lines, setLines] = useState([newLine(own)]); const [reason, setReason] = useState(''); const [notes, setNotes] = useState('');
  const [err, setErr] = useState(''); const [result, setResult] = useState(null); const [run, busy] = useAction(); const key = useIdemKey();
  useEffect(() => { if (open) { setType(types.includes(initialType) ? initialType : types[0] || 'Stock In'); setLines([newLine(own)]); setReason(''); setNotes(''); setErr(''); setResult(null); key.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLines((ls) => ls.map((l) => ({ ...l, fromDepartment: l.fromDepartment || own || '', toDepartment: l.toDepartment || own || '' }))); }, [own]);
  const incoming = type === 'Stock In'; const adjust = type === 'Adjustment'; const transfer = type === 'Transfer';
  const patch = (i, p) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l))); key.reset(); };   // content changed: this is a new request
  const pick = (i, item) => patch(i, { item, unit: item ? (incoming ? item.purchaseUnit : item.usageUnit) || item.baseUnit : '', lotNo: '', expiryDate: '' });
  const reasonNeeded = REASON_REQUIRED.includes(type);
  const missing = useMemo(() => lines.some((l) => !l.item || !(Number(l.quantity) > 0) || (incoming && !l.toDepartment) || (transfer && (!l.fromDepartment || !l.toDepartment)) || (!incoming && !transfer && !(adjust ? (l.direction === 'increase' ? l.toDepartment : l.fromDepartment) : l.fromDepartment)) || (incoming && l.item?.trackExpiry && !l.expiryDate)) || (reasonNeeded && reason.trim().length < 3), [lines, incoming, transfer, adjust, reason, reasonNeeded]);

  const submit = async () => {
    setErr('');
    const L = lines[0];
    const headers = { 'Idempotency-Key': key.get() };
    try {
      let r;
      if (adjust) {
        const department = L.direction === 'increase' ? L.toDepartment : L.fromDepartment;
        r = await run(() => api.post('/inventory/adjustments', { item: L.item._id, department, direction: L.direction, quantity: Number(L.quantity), unit: L.unit || L.item.baseUnit, reason: reason.trim(), notes: notes || undefined, expiryDate: L.expiryDate || undefined, lotNo: L.lotNo || undefined }, { headers }));
      } else {
        const body = { lines: lines.map((l) => ({ item: l.item._id, quantity: Number(l.quantity), unit: l.unit || l.item.baseUnit, ...(incoming ? { toDepartment: l.toDepartment, unitPrice: l.unitPrice === '' ? undefined : Number(l.unitPrice), supplier: l.supplier || undefined, lotNo: l.lotNo || undefined, expiryDate: l.expiryDate || undefined } : transfer ? { fromDepartment: l.fromDepartment, toDepartment: l.toDepartment } : { fromDepartment: l.fromDepartment }) })), reason: reason.trim() || undefined, notes: notes || undefined };
        r = await run(() => (transfer ? api.post('/inventory/transfers', body, { headers }) : api.post('/inventory/movements', { ...body, type }, { headers })));
      }
      key.reset(); setResult({ status: r.status, ...r.data }); onDone?.();
      if (!adjust) toast.success(r.data.replayed ? 'Already recorded' : `${type} recorded`);
    } catch (e) { setErr(e.message); }
  };

  if (result) return (
    <Modal open={open} onClose={onClose} title={adjust ? 'Adjustment submitted for approval' : `${type} recorded`} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-green-600" size={18} /><div>
          <p className="font-semibold">{result.data?.movementNumber}</p>
          {adjust ? <p className="text-slate-600">Stock has <b>not</b> changed. It will be applied once, only after an approver approves the request{result.approval?.requestNumber ? ` (${result.approval.requestNumber})` : ''}.</p> : <p className="text-slate-600">Stock was updated and the ledger entry was written.</p>}
        </div></div>
        {adjust && <Link to="/approvals" className="btn btn-secondary">Open approvals</Link>}
        <Replayed show={result.replayed} />
      </div>
    </Modal>
  );
  const L0 = lines[0];
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Record stock movement"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={missing || !types.length}>{adjust ? 'Submit for approval' : `Record ${type.toLowerCase()}`}</Button></>}>
      <div className="space-y-4">
        <Field label="Movement type"><Select value={type} onChange={(e) => { setType(e.target.value); setErr(''); setLines((ls) => (e.target.value === 'Adjustment' ? [{ ...ls[0], item: ls[0].item }] : ls)); key.reset(); }}>{types.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <InfoBox tone={adjust ? 'amber' : 'blue'}>{HINT[type]}</InfoBox>
        {lines.map((l, i) => {
          const opts = unitOptions(l.item, units); const unit = l.unit || l.item?.baseUnit;
          return (
            <div key={i} className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Field label={lines.length > 1 ? `Item ${i + 1}` : 'Item'} required><ItemPicker value={l.item} onChange={(it) => pick(i, it)} autoFocus={i === 0} /></Field></div>
                {lines.length > 1 && !adjust && <button type="button" aria-label={`Remove item ${i + 1}`} className="mt-6 rounded p-2 text-slate-400 hover:bg-slate-100" onClick={() => { setLines(lines.filter((_, j) => j !== i)); key.reset(); }}><Trash2 size={16} /></button>}</div>
              {l.item && <p className="-mt-1 text-xs text-slate-500">On hand now: <b>{qtyFmt(l.item.stock?.total)} {l.item.baseUnit}</b>{l.item.stock?.byDepartment && Object.keys(l.item.stock.byDepartment).length > 0 && <> ({Object.entries(l.item.stock.byDepartment).map(([d, v]) => `${d} ${qtyFmt(v)}`).join(', ')})</>}</p>}
              <div className="grid gap-3 sm:grid-cols-4">
                {adjust && <Field label="Direction" required><Select value={l.direction} onChange={(e) => patch(i, { direction: e.target.value })}><option value="increase">Increase stock (+)</option><option value="decrease">Decrease stock (−)</option></Select></Field>}
                <Field label="Quantity" required><Input type="number" min="0" step="any" inputMode="decimal" value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} /></Field>
                <Field label="Unit"><Select value={unit || ''} disabled={!l.item} onChange={(e) => patch(i, { unit: e.target.value })}>{opts.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</Select></Field>
                {(transfer || (!incoming && !(adjust && l.direction === 'increase'))) && <Field label={transfer ? 'From department' : 'Department'} required><Select value={l.fromDepartment} onChange={(e) => patch(i, { fromDepartment: e.target.value })}><option value="" disabled>Select…</option>{departments.map((d) => <option key={d}>{d}</option>)}</Select></Field>}
                {(incoming || transfer || (adjust && l.direction === 'increase')) && <Field label={transfer ? 'To department' : 'Department'} required><Select value={l.toDepartment} onChange={(e) => patch(i, { toDepartment: e.target.value })}><option value="" disabled>Select…</option>{(transfer ? allDepartments : departments).map((d) => <option key={d}>{d}</option>)}</Select></Field>}
              </div>
              {l.item && <ConvertPreview item={l.item} quantity={l.quantity} unit={unit} />}
              {(incoming || (adjust && l.direction === 'increase')) && (
                <div className="grid gap-3 sm:grid-cols-4">
                  {incoming && <><Field label={`Price per ${unit || 'unit'} (₹)`}><Input type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => patch(i, { unitPrice: e.target.value })} /></Field>
                    <Field label="Supplier"><Input value={l.supplier} onChange={(e) => patch(i, { supplier: e.target.value })} /></Field></>}
                  <Field label="Batch no."><Input value={l.lotNo} onChange={(e) => patch(i, { lotNo: e.target.value })} /></Field>
                  <Field label="Expiry date" required={!!l.item?.trackExpiry} hint={l.item?.trackExpiry ? 'This item is expiry-tracked' : undefined}><Input type="date" value={l.expiryDate} onChange={(e) => patch(i, { expiryDate: e.target.value })} /></Field>
                </div>
              )}
            </div>
          );
        })}
        {!adjust && <Button variant="secondary" size="sm" type="button" onClick={() => { setLines([...lines, newLine(own)]); key.reset(); }}><Plus size={14} />Add another item</Button>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={reasonNeeded ? 'Reason' : 'Reason (optional)'} required={reasonNeeded} hint={adjust ? 'Approvers see this reason' : undefined}><Textarea rows={2} value={reason} onChange={(e) => { setReason(e.target.value); key.reset(); }} /></Field>
          <Field label="Notes (optional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        {adjust && L0?.item && Number(L0.quantity) > 0 && <InfoBox tone="amber">Requesting {L0.direction === 'increase' ? '+' : '−'}{L0.quantity} {L0.unit || L0.item.baseUnit} of {L0.item.name}. Nothing changes until approved.</InfoBox>}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}
