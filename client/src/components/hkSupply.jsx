import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { toast } from '../store/toast';
import { Button, Field, Input, Select } from './ui';
import { newKey } from './hk';
import { HK_SUPPLY_KINDS } from '../utils/constants';
import { fmtDateTime } from '../utils/format';

/**
 * Record linen / toiletry / cleaning-supply use. Each submit carries a clientKey generated when the form opens (and renewed after success),
 * so a double tap or a network retry can never take stock twice: the server answers 200 + replayed:true instead.
 */
export function SupplyForm({ task, room, onDone, compact }) {
  const [kind, setKind] = useState(HK_SUPPLY_KINDS[0]); const items = useGet('/housekeeping/supplies/items', { kind }, [kind]);
  const [item, setItem] = useState(''); const [qty, setQty] = useState(''); const [notes, setNotes] = useState(''); const [err, setErr] = useState(''); const [run, busy] = useAction(); const key = useRef(newKey());
  useEffect(() => { setItem(''); }, [kind]);
  const sel = (items.data || []).find((i) => i._id === item);
  const submit = async () => {
    setErr('');
    try {
      const r = await run(() => api.post('/housekeeping/supplies', { kind, item, quantity: Number(qty), unit: sel?.usageUnit, task: task?._id, room: room?._id, notes: notes || undefined, clientKey: key.current }));
      toast.success(r.data.replayed ? 'Already recorded - stock was not taken twice' : `${qty} ${sel?.usageUnit || ''} ${sel?.name} recorded`);
      key.current = newKey(); setQty(''); setNotes(''); setItem(''); items.reload(); onDone?.();
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="space-y-3">
      <div className={compact ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{HK_SUPPLY_KINDS.map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Item" required><Select value={item} onChange={(e) => setItem(e.target.value)}><option value="">{items.loading ? 'Loading…' : 'Select item…'}</option>{(items.data || []).map((i) => <option key={i._id} value={i._id}>{i.name} · {i.onHand} {i.baseUnit} on hand</option>)}</Select></Field>
        <Field label={`Quantity${sel ? ` (${sel.usageUnit})` : ''}`} required><Input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {items.error && <p className="text-sm text-red-600" role="alert">{items.error.message}</p>}
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      <Button loading={busy} disabled={!item || !(Number(qty) > 0)} onClick={submit}>Record use</Button>
    </div>
  );
}

export function SupplyList({ task, reloadKey }) {
  const st = useGet('/housekeeping/supplies', { task: task?._id }, [reloadKey]);
  if (!st.data?.length) return <p className="text-sm text-slate-400">No supplies recorded on this task yet.</p>;
  return <ul className="divide-y divide-slate-100 text-sm">{st.data.map((u) => <li key={u._id} className="flex justify-between gap-3 py-1.5"><span>{u.itemName} <span className="text-slate-400">· {u.kind}</span></span><span className="shrink-0 font-semibold">{u.quantity} {u.unit} <span className="text-xs font-normal text-slate-400">{fmtDateTime(u.at)}</span></span></li>)}</ul>;
}
