import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import api, { apiError } from '../../services/api';
import { useDebounced, useGet } from '../../hooks/useApi';
import { Badge, Select, cx } from '../../components/ui';
import { STOCK_DEPARTMENTS } from '../../utils/constants';
import { toast } from '../../store/toast';

/** 1,234.5 (up to 4 decimals, Indian grouping). */
export const qtyFmt = (n, max = 4) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: max }));
export const rupee = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const dateOnly = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

/** One Idempotency-Key per open form: the same key is re-sent on every retry, and renewed only after a success (or when the form is reopened). */
export function useIdemKey() {
  const ref = useRef(null);
  const get = useCallback(() => { if (!ref.current) ref.current = (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`); return ref.current; }, []);
  const reset = useCallback(() => { ref.current = null; }, []);
  return { get, reset };
}

/** Stock departments the signed-in user may work with (server enforces; this just avoids offering what will be refused). */
export function useInvScope() {
  const s = useGet('/inventory/settings'); const sm = useGet('/inventory/summary');
  const all = s.data?.stockDepartments || STOCK_DEPARTMENTS;
  const scope = sm.data?.scope;
  const ownOnly = !!scope && scope !== 'all';
  return { departments: ownOnly ? [scope] : all, allDepartments: all, ownOnly, own: ownOnly ? scope : null, settings: s.data, loading: s.loading || sm.loading };
}

export function useUnits() { const u = useGet('/inventory/units'); return { units: u.data || [], byCode: new Map((u.data || []).map((x) => [x.code, x])), loading: u.loading }; }
/** Units an item can be entered in: base + its package conversions + other units of the same measure (kg <-> g, l <-> ml, ...). */
export function unitOptions(item, units) {
  if (!item) return [];
  const byCode = new Map(units.map((u) => [u.code, u]));
  const out = new Set([item.baseUnit, ...(item.conversions || []).map((c) => c.unit)]);
  const b = byCode.get(item.baseUnit);
  if (b && b.dimension !== 'package') units.forEach((u) => { if (u.active !== false && u.dimension === b.dimension) out.add(u.code); });
  return [...out].map((c) => ({ code: c, name: byCode.get(c)?.name || c }));
}

export async function downloadFile(url, params, filename) {
  try {
    const r = await api.get(url, { params, responseType: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { toast.error(apiError(e).message); }
}

export function DeptSelect({ value, onChange, departments, all, label = 'Department', ...p }) {
  const list = departments || STOCK_DEPARTMENTS;
  return <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} {...p}>{all ? <option value="">{all}</option> : <option value="" disabled>Select…</option>}{list.map((d) => <option key={d} value={d}>{d}</option>)}</Select>;
}

export function StockBadges({ stock }) {
  if (!stock) return null;
  return <>{stock.out && <Badge tone="slate">Out of stock</Badge>}{stock.low && <Badge tone="red">Low</Badge>}{stock.expired && <Badge tone="red">Expired</Badge>}{stock.expiringSoon && <Badge tone="amber">Expiring</Badge>}</>;
}

/** Type-ahead item search (GET /inventory/items?q=). onChange receives the whole item row. */
export function ItemPicker({ value, onChange, label = 'Item', disabled, autoFocus, inputId }) {
  const [text, setText] = useState(''); const [open, setOpen] = useState(false); const [rows, setRows] = useState([]); const [busy, setBusy] = useState(false);
  const q = useDebounced(text, 250); const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined; let dead = false; setBusy(true);
    api.get('/inventory/items', { params: { q, limit: 12 } }).then((r) => { if (!dead) setRows(r.data.data || []); }).catch(() => { if (!dead) setRows([]); }).finally(() => { if (!dead) setBusy(false); });
    return () => { dead = true; };
  }, [q, open]);
  useEffect(() => { const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  if (value) return (
    <div className="flex min-h-[40px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm">
      <span className="min-w-0 truncate"><span className="font-semibold">{value.name}</span> <span className="text-slate-400">{value.sku}</span></span>
      {!disabled && <button type="button" aria-label={`Clear ${label}`} onClick={() => { onChange(null); setText(''); }} className="rounded p-1 text-slate-400 hover:bg-slate-200"><X size={14} /></button>}
    </div>
  );
  return (
    <div ref={box} className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
      <input id={inputId} className="input pl-9" role="combobox" aria-expanded={open} aria-label={label} placeholder="Search item name or code…" value={text} autoFocus={autoFocus} disabled={disabled}
        onFocus={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setOpen(true); }} />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-pop" role="listbox">
          {busy && <li className="px-3 py-2 text-xs text-slate-400">Searching…</li>}
          {!busy && !rows.length && <li className="px-3 py-2 text-xs text-slate-400">No matching items</li>}
          {rows.map((r) => (
            <li key={r._id} role="option"><button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange(r); setOpen(false); setText(''); }}>
              <span className="min-w-0 truncate font-medium">{r.name} <span className="text-xs font-normal text-slate-400">{r.sku}</span></span><span className="shrink-0 text-xs text-slate-500">{qtyFmt(r.stock?.total)} {r.baseUnit}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "= 50 kg" preview from the server's conversion rules, so what the user types is what gets stored. */
export function ConvertPreview({ item, quantity, unit }) {
  const q = useDebounced(`${item?._id}|${quantity}|${unit}`, 300); const [res, setRes] = useState(null);
  useEffect(() => {
    const [id, qt, un] = q.split('|'); const n = Number(qt);
    if (!id || id === 'undefined' || !(n > 0) || !un) { setRes(null); return undefined; }
    if (un === item?.baseUnit) { setRes(null); return undefined; }
    let dead = false;
    api.post('/inventory/convert', { item: id, quantity: n, unit: un }).then((r) => !dead && setRes({ ok: true, ...r.data.data })).catch((e) => !dead && setRes({ ok: false, message: apiError(e).message }));
    return () => { dead = true; };
  }, [q, item?.baseUnit]);
  if (!res) return null;
  return res.ok ? <p className="mt-1 text-xs text-slate-500" aria-live="polite">= <b>{qtyFmt(res.baseQty)} {res.baseUnit}</b> in stock units</p> : <p className="mt-1 text-xs text-red-600" role="alert">{res.message}</p>;
}

export function Replayed({ show }) { return show ? <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">This request was already received earlier (same reference). Nothing was applied twice.</p> : null; }
export const InfoBox = ({ tone = 'blue', children }) => <div className={cx('rounded-lg px-3 py-2 text-xs', { blue: 'bg-blue-50 text-blue-800', amber: 'bg-amber-50 text-amber-800', green: 'bg-green-50 text-green-800' }[tone])}>{children}</div>;
