import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { toast } from '../../store/toast';
import { Button, Field, Input, Select, Switch, Textarea, TBC } from '../../components/ui';
import { Drawer } from '../../components/feedback';
import { InfoBox, unitOptions, useInvScope, useUnits } from './shared';

const blank = { sku: '', name: '', category: '', description: '', baseUnit: 'pcs', purchaseUnit: '', usageUnit: '', conversions: [], minStockLevel: '', minLevels: [], trackExpiry: false, openingStock: [] };
const num = (v) => (v === '' || v == null ? undefined : Number(v));

/** Create (item undefined) or edit (item = getItem payload) drawer. */
export default function ItemForm({ open, item, onClose, onSaved }) {
  const edit = !!item;
  const cats = useGet(open ? '/inventory/categories' : null); const { units } = useUnits(); const { allDepartments } = useInvScope();
  const [f, setF] = useState(blank); const [err, setErr] = useState({ message: '', fields: {} }); const [run, busy] = useAction();
  useEffect(() => {
    if (!open) return;
    setErr({ message: '', fields: {} });
    setF(item ? { sku: item.sku, name: item.name, category: item.category?._id || item.category || '', description: item.description || '', baseUnit: item.baseUnit, purchaseUnit: item.purchaseUnit || '', usageUnit: item.usageUnit || '',
      conversions: (item.conversions || []).map((c) => ({ unit: c.unit, factor: c.factor })), minStockLevel: item.minStockLevel || '', minLevels: (item.minLevels || []).map((m) => ({ department: m.department, minLevel: m.minLevel })), trackExpiry: !!item.trackExpiry, openingStock: [] } : blank);
  }, [open, item]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const probe = useMemo(() => ({ baseUnit: f.baseUnit, conversions: f.conversions.filter((c) => c.unit && Number(c.factor) > 0) }), [f.baseUnit, f.conversions]);
  const choices = unitOptions(probe, units);
  const baseDim = units.find((u) => u.code === f.baseUnit)?.dimension;
  const pickCategory = (id) => { const c = (cats.data || []).find((x) => x._id === id); setF((x) => ({ ...x, category: id, ...(!edit && c ? { trackExpiry: !!c.trackExpiryDefault } : {}) })); };

  const save = async () => {
    setErr({ message: '', fields: {} });
    const body = { sku: f.sku.trim(), name: f.name.trim(), category: f.category, description: f.description || undefined, baseUnit: f.baseUnit, purchaseUnit: f.purchaseUnit || undefined, usageUnit: f.usageUnit || undefined,
      conversions: f.conversions.filter((c) => c.unit).map((c) => ({ unit: c.unit, factor: Number(c.factor) })), minStockLevel: num(f.minStockLevel) ?? 0,
      minLevels: f.minLevels.filter((m) => m.department).map((m) => ({ department: m.department, minLevel: Number(m.minLevel) || 0 })), trackExpiry: f.trackExpiry };
    if (!edit && f.openingStock.length) body.openingStock = f.openingStock.map((o) => ({ department: o.department, quantity: Number(o.quantity), unit: o.unit || f.baseUnit, unitPrice: num(o.unitPrice), expiryDate: o.expiryDate || undefined, lotNo: o.lotNo || undefined }));
    try {
      const r = await run(() => (edit ? api.put(`/inventory/items/${item._id}`, body) : api.post('/inventory/items', body)));
      toast.success(edit ? 'Item updated' : 'Item created'); onSaved(r.data.data);
    } catch (e) { setErr({ message: e.message, fields: e.fields || {} }); }
  };
  const row = (list, i, patch) => setF((x) => ({ ...x, [list]: x[list].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const del = (list, i) => setF((x) => ({ ...x, [list]: x[list].filter((_, j) => j !== i) }));
  const fe = err.fields;
  return (
    <Drawer open={open} onClose={onClose} title={edit ? `Edit ${item.name}` : 'New inventory item'} subtitle={edit ? item.sku : 'Items are the products you stock'} width="max-w-2xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.sku || !f.name || !f.category}>{edit ? 'Save changes' : 'Create item'}</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item code (SKU)" required error={fe.sku} hint="Letters, numbers, . _ - (2–32). Cannot change once stock exists."><Input value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} error={fe.sku} /></Field>
          <Field label="Item name" required error={fe.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} error={fe.name} /></Field>
          <Field label="Category" required error={fe.category}><Select value={f.category} onChange={(e) => pickCategory(e.target.value)} error={fe.category}><option value="">Select category…</option>{(cats.data || []).filter((c) => c.active || c._id === f.category).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
          <Field label="Track expiry dates"><div className="pt-2"><Switch checked={f.trackExpiry} onChange={(v) => set('trackExpiry', v)} label="Each batch needs an expiry date" /></div></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        </div>

        <section aria-labelledby="units-h" className="rounded-xl border border-slate-200 p-4">
          <h4 id="units-h" className="mb-1 text-sm font-bold">Units &amp; conversions</h4>
          <p className="mb-3 text-xs text-slate-500">Stock is kept in the <b>stock unit</b>. Weights, volumes and counts convert automatically (kg↔g, l↔ml, dozen→pcs). Packages (bag, carton, box…) need a conversion below.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Stock unit" required error={fe.baseUnit}><Select value={f.baseUnit} onChange={(e) => set('baseUnit', e.target.value)} error={fe.baseUnit}>{units.filter((u) => u.active !== false).map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</Select></Field>
            <Field label="Purchase unit" hint="Default for Stock In"><Select value={f.purchaseUnit} onChange={(e) => set('purchaseUnit', e.target.value)}><option value="">Same as stock unit</option>{choices.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</Select></Field>
            <Field label="Usage unit" hint="Default for Stock Out"><Select value={f.usageUnit} onChange={(e) => set('usageUnit', e.target.value)}><option value="">Same as stock unit</option>{choices.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</Select></Field>
          </div>
          <div className="mt-3 space-y-2">
            {f.conversions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <span className="pb-2 text-sm">1</span>
                <Field label={i === 0 ? 'Unit' : undefined} className="w-36"><Select aria-label="Conversion unit" value={c.unit} onChange={(e) => row('conversions', i, { unit: e.target.value })}><option value="">Unit…</option>{units.filter((u) => u.code !== f.baseUnit && u.active !== false).map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</Select></Field>
                <span className="pb-2 text-sm">=</span>
                <Field label={i === 0 ? `Quantity in ${f.baseUnit}` : undefined} className="w-36"><Input aria-label="Conversion factor" type="number" min="0" step="any" inputMode="decimal" value={c.factor} onChange={(e) => row('conversions', i, { factor: e.target.value })} /></Field>
                <span className="pb-2 text-sm text-slate-500">{f.baseUnit}</span>
                <button type="button" aria-label="Remove conversion" className="mb-1 rounded p-2 text-slate-400 hover:bg-slate-100" onClick={() => del('conversions', i)}><Trash2 size={15} /></button>
              </div>
            ))}
            <Button variant="secondary" size="sm" type="button" onClick={() => set('conversions', [...f.conversions, { unit: '', factor: '' }])}><Plus size={14} />Add package conversion</Button>
            {baseDim === 'package' && <InfoBox tone="amber">A packaged stock unit (e.g. bottle) can only convert to other units through the conversions above.</InfoBox>}
            {fe.conversions && <p className="text-xs text-red-600">{fe.conversions}</p>}
          </div>
        </section>

        <section aria-labelledby="min-h" className="rounded-xl border border-slate-200 p-4">
          <h4 id="min-h" className="mb-1 text-sm font-bold">Minimum stock levels</h4>
          <p className="mb-3 text-xs text-slate-500">A low-stock alert is raised once when a department drops below its minimum (in {f.baseUnit}).</p>
          <div className="space-y-2">
            {f.minLevels.map((m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select aria-label="Department" className="w-44" value={m.department} onChange={(e) => row('minLevels', i, { department: e.target.value })}><option value="">Department…</option>{allDepartments.map((d) => <option key={d}>{d}</option>)}</Select>
                <Input aria-label="Minimum level" className="w-32" type="number" min="0" step="any" inputMode="decimal" value={m.minLevel} onChange={(e) => row('minLevels', i, { minLevel: e.target.value })} /><span className="text-sm text-slate-500">{f.baseUnit}</span>
                <button type="button" aria-label="Remove minimum level" className="rounded p-2 text-slate-400 hover:bg-slate-100" onClick={() => del('minLevels', i)}><Trash2 size={15} /></button>
              </div>
            ))}
            <Button variant="secondary" size="sm" type="button" onClick={() => set('minLevels', [...f.minLevels, { department: '', minLevel: '' }])}><Plus size={14} />Add department minimum</Button>
          </div>
          <Field label="Overall minimum (all departments together)" className="mt-3 sm:w-64"><Input type="number" min="0" step="any" value={f.minStockLevel} onChange={(e) => set('minStockLevel', e.target.value)} /></Field>
        </section>

        {!edit && (
          <section aria-labelledby="open-h" className="rounded-xl border border-slate-200 p-4">
            <h4 id="open-h" className="mb-1 text-sm font-bold">Opening stock <span className="font-normal text-slate-400">(optional)</span></h4>
            <p className="mb-3 text-xs text-slate-500">Stock already on the shelf today. It is recorded as an Opening Stock movement in the ledger.</p>
            <div className="space-y-3">
              {f.openingStock.map((o, i) => (
                <div key={i} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-6">
                  <Select aria-label="Department" className="sm:col-span-2" value={o.department} onChange={(e) => row('openingStock', i, { department: e.target.value })}><option value="">Department…</option>{allDepartments.map((d) => <option key={d}>{d}</option>)}</Select>
                  <Input aria-label="Quantity" type="number" min="0" step="any" inputMode="decimal" placeholder="Qty" value={o.quantity} onChange={(e) => row('openingStock', i, { quantity: e.target.value })} />
                  <Select aria-label="Unit" value={o.unit || f.baseUnit} onChange={(e) => row('openingStock', i, { unit: e.target.value })}>{choices.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</Select>
                  <Input aria-label="Price per unit" type="number" min="0" step="any" placeholder="Price / unit ₹" value={o.unitPrice || ''} onChange={(e) => row('openingStock', i, { unitPrice: e.target.value })} />
                  <button type="button" aria-label="Remove opening stock line" className="justify-self-end rounded p-2 text-slate-400 hover:bg-slate-200" onClick={() => del('openingStock', i)}><Trash2 size={15} /></button>
                  {f.trackExpiry && <><Input aria-label="Expiry date" className="sm:col-span-2" type="date" value={o.expiryDate || ''} onChange={(e) => row('openingStock', i, { expiryDate: e.target.value })} /><Input aria-label="Batch number" className="sm:col-span-2" placeholder="Batch no. (optional)" value={o.lotNo || ''} onChange={(e) => row('openingStock', i, { lotNo: e.target.value })} /></>}
                </div>
              ))}
              <Button variant="secondary" size="sm" type="button" onClick={() => set('openingStock', [...f.openingStock, { department: '', quantity: '', unit: f.baseUnit }])}><Plus size={14} />Add opening stock</Button>
              {f.trackExpiry && f.openingStock.length > 0 && <p className="text-xs text-slate-500">Expiry-tracked items need an expiry date on every opening line.</p>}
            </div>
          </section>
        )}
        {err.message && <p className="text-sm text-red-600" role="alert">{err.message}</p>}
        <p className="text-[11px] text-slate-400">Expiry-date alerts: <TBC>Notifications TBC</TBC> expiry is shown on screens; push notifications are off until confirmed in Units &amp; categories → settings.</p>
      </div>
    </Drawer>
  );
}
