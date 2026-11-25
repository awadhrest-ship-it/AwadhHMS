import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, Field, Input, PageHeader, Select, Switch, Tabs, Textarea, Table } from '../../components/ui';
import { toast } from '../../store/toast';
import { SubNav, rs } from './shared';
import { CostBadge } from './Recipes';

const blank = { menuItem: '', name: '', description: '', instructions: '', yield: { quantity: 1, label: 'serving' }, ingredients: [], changeNote: '' };
export default function RecipeEditor() {
  const { id } = useParams(); const isNew = !id || id === 'new'; const nav = useNavigate(); const [sp] = useSearchParams(); const can = useAuth((s) => s.can); const mayEdit = can('kitchen.recipes.edit');
  const rec = useGet(isNew ? null : `/kitchen/recipes/${id}`); const missing = useGet(isNew ? '/kitchen/recipes-missing' : null); const versions = useGet(isNew ? null : `/kitchen/recipes/${id}/versions`);
  const [f, setF] = useState(blank); const [tab, setTab] = useState('recipe'); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [iq, setIq] = useState(''); const diq = useDebounced(iq, 250); const picker = useGet(mayEdit && iq.length > 0 ? '/kitchen/ingredients' : null, { q: diq });
  useEffect(() => { if (isNew && sp.get('menuItem')) setF((x) => ({ ...x, menuItem: sp.get('menuItem') })); }, [isNew, sp]);
  useEffect(() => { const r = rec.data; if (r) setF({ menuItem: r.menuItem?._id, name: r.name, description: r.description || '', instructions: r.instructions || '', yield: { quantity: r.yield?.quantity || 1, label: r.yield?.label || 'serving' }, changeNote: '',
    ingredients: r.ingredients.map((g) => ({ item: g.item, itemName: g.itemName, sku: g.sku, quantity: g.quantity, unit: g.unit, note: g.note || '', units: g.convertibleUnits || [g.unit] })) }); }, [rec.data]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const upd = (i, k, v) => set('ingredients', f.ingredients.map((g, n) => (n === i ? { ...g, [k]: v } : g)));
  const add = (it) => { if (f.ingredients.some((g) => g.item === it._id)) return toast.info(`${it.name} is already in the list`); set('ingredients', [...f.ingredients, { item: it._id, itemName: it.name, sku: it.sku, quantity: '', unit: it.usageUnit || it.baseUnit, note: '', units: it.units }]); setIq(''); };
  const payload = () => ({ ...(isNew ? { menuItem: f.menuItem } : {}), name: f.name || undefined, description: f.description, instructions: f.instructions, yield: { quantity: Number(f.yield.quantity) || 1, label: f.yield.label || 'serving' }, ...(isNew ? {} : { changeNote: f.changeNote || undefined }),
    ingredients: f.ingredients.map((g) => ({ item: g.item, quantity: Number(g.quantity), unit: g.unit, note: g.note || undefined })) });
  const save = async () => {
    setErr(''); if (isNew && !f.menuItem) return setErr('Choose the menu item this recipe is for'); if (f.ingredients.some((g) => !(Number(g.quantity) > 0))) return setErr('Every ingredient needs a quantity above zero');
    try { const r = await run(() => (isNew ? api.post('/kitchen/recipes', payload()) : api.put(`/kitchen/recipes/${id}`, payload()))); toast.success(isNew ? 'Recipe created' : `Recipe saved (version ${r.data.data.version})`); if (isNew) nav(`/kitchen/recipes/${r.data.data._id}`, { replace: true }); else { rec.reload(); versions.reload(); } } catch (e) { setErr(e.message); }
  };
  const setActive = async (active) => { try { await run(() => api.post(`/kitchen/recipes/${id}/active`, { active })); toast.success(active ? 'Recipe activated' : 'Recipe deactivated - its menu item will consume no stock until reactivated'); rec.reload(); versions.reload(); } catch (e) { toast.error(e.message); } };
  const cost = rec.data?.cost; const r = rec.data;
  return (
    <div><SubNav can={can} />
      <PageHeader back={<Link to="/kitchen/recipes" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft size={13} />All recipes</Link>} title={isNew ? 'New recipe' : r?.name || 'Recipe'} subtitle={r ? `${r.menuItem?.name} · version ${r.version}` : 'Link a menu item to the inventory ingredients it uses'}
        actions={<>{r && <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Inactive'}</Badge>}{!isNew && mayEdit && <Switch checked={!!r?.active} onChange={setActive} label="Active" />}{mayEdit && <Button loading={busy} onClick={save}><Save size={15} />Save</Button>}</>} />
      {!isNew && <Tabs items={[{ key: 'recipe', label: 'Recipe' }, { key: 'versions', label: 'Version history', count: versions.data?.length }]} value={tab} onChange={setTab} />}
      {err && <div className="my-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{err}</div>}
      {tab === 'recipe' && (rec.loading && !isNew && !r ? <Async state={rec}>{() => null}</Async> : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <Card title="Details"><div className="grid gap-3 sm:grid-cols-2">
              {isNew ? <Field label="Menu item" required><Select value={f.menuItem} onChange={(e) => set('menuItem', e.target.value)}><option value="">Choose…</option>{(missing.data || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</Select></Field> : <Field label="Menu item"><Input disabled value={r?.menuItem?.name || ''} /></Field>}
              <Field label="Recipe name" hint="Defaults to the menu item name"><Input disabled={!mayEdit} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Makes" hint="Ingredient quantities below are for this whole batch"><div className="flex gap-2"><Input disabled={!mayEdit} type="number" min="0.01" step="any" className="!w-24" aria-label="Yield quantity" value={f.yield.quantity} onChange={(e) => set('yield', { ...f.yield, quantity: e.target.value })} /><Input disabled={!mayEdit} aria-label="Yield label" value={f.yield.label} onChange={(e) => set('yield', { ...f.yield, label: e.target.value })} /></div></Field>
              <Field label="Description"><Input disabled={!mayEdit} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
              <Field label="Preparation instructions" className="sm:col-span-2"><Textarea disabled={!mayEdit} rows={4} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} /></Field>
              {!isNew && mayEdit && <Field label="What changed? (optional)" className="sm:col-span-2" hint="Kept in the version history"><Input value={f.changeNote} onChange={(e) => set('changeNote', e.target.value)} /></Field>}
            </div></Card>
            <Card title="Ingredients" pad={false} action={<span className="text-xs text-slate-500">from the inventory (Phase 4) - units are converted automatically</span>}>
              {mayEdit && <div className="relative border-b border-slate-100 p-3"><Input placeholder="Search inventory item to add (name or SKU)…" aria-label="Search inventory items" value={iq} onChange={(e) => setIq(e.target.value)} />
                {iq && <div className="absolute left-3 right-3 z-10 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-pop">{picker.loading && !picker.data ? <p className="p-3 text-sm text-slate-500">Searching…</p> : (picker.data || []).length ? picker.data.map((it) => <button key={it._id} type="button" onClick={() => add(it)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"><span><b>{it.name}</b> <span className="font-mono text-xs text-slate-400">{it.sku}</span></span><span className="text-xs text-slate-500">base: {it.baseUnit}</span></button>) : <p className="p-3 text-sm text-slate-500">No inventory item matches.</p>}</div>}</div>}
              {f.ingredients.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No ingredients yet - search the inventory above.</p> : (
                <Table dense rowKey="item" rows={f.ingredients} columns={[
                  { header: 'Ingredient', render: (g) => <span className="font-semibold">{g.itemName}<span className="ml-1 font-mono text-[11px] font-normal text-slate-400">{g.sku}</span></span> },
                  { header: 'Quantity', render: (g) => <Input disabled={!mayEdit} type="number" min="0" step="any" aria-label={`Quantity of ${g.itemName}`} className="!w-28" value={g.quantity} onChange={(e) => upd(f.ingredients.indexOf(g), 'quantity', e.target.value)} /> },
                  { header: 'Unit', render: (g) => <Select disabled={!mayEdit} aria-label={`Unit of ${g.itemName}`} className="!w-28" value={g.unit} onChange={(e) => upd(f.ingredients.indexOf(g), 'unit', e.target.value)}>{[...new Set([g.unit, ...g.units])].map((u) => <option key={u}>{u}</option>)}</Select> },
                  { header: 'Cost', className: 'text-right', render: (g) => { const c = cost?.ingredients.find((x) => String(x.item) === String(g.item)); return c ? (c.cost != null ? rs(c.cost) : <span className="text-xs font-semibold text-amber-700">no cost on record</span>) : <span className="text-xs text-slate-400">save to cost</span>; } },
                  { header: '', render: (g) => mayEdit && <Button size="sm" variant="ghost" aria-label={`Remove ${g.itemName}`} onClick={() => set('ingredients', f.ingredients.filter((x) => x !== g))}><Trash2 size={14} /></Button> }]} />)}
            </Card>
            {mayEdit && <Button variant="secondary" onClick={() => setIq(' ')} className="md:hidden"><Plus size={15} />Add ingredient</Button>}
          </div>
          <div className="space-y-4">
            <Card title="Food cost">
              {!cost ? <p className="text-sm text-slate-500">Save the recipe to see its cost from inventory prices.</p> : (<dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Ingredient cost (batch)</dt><dd className="font-semibold">{rs(cost.totalCost)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Cost per {cost.yield.label}</dt><dd className="font-semibold">{rs(cost.costPerServing)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Selling price</dt><dd className="font-semibold">{cost.sellingPrice != null ? rs(cost.sellingPrice) : '-'}</dd></div>
                <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Food cost %</dt><dd className="text-lg font-extrabold"><CostBadge cost={cost} /></dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Gross contribution</dt><dd className="font-semibold">{cost.grossContribution != null ? rs(cost.grossContribution) : '-'}</dd></div></dl>)}
              {cost && !cost.complete && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">Incomplete: no cost on record for {cost.missing.join(', ')}. A purchase (stock-in with a price) fixes this - the system never guesses a cost.</p>}
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Food cost % = ingredient cost ÷ selling price × 100 (selling price excludes tax). It covers ingredients only - not salaries, utilities or overheads, and it is not profit. Cost uses the item's latest purchase price, else the cost of stock on hand.</p>
            </Card>
          </div>
        </div>))}
      {tab === 'versions' && <div className="mt-4"><Async state={versions}>{(rows) => <div className="space-y-3">{rows.map((v) => <Card key={v._id} title={`Version ${v.version}${v.version === r?.version ? ' (current)' : ''}`} action={<span className="text-xs text-slate-500">{v.createdByName} · {new Date(v.createdAt).toLocaleString('en-IN')}</span>}>
        <p className="text-sm text-slate-600">{v.changeNote || '-'}{v.active === false ? ' · inactive' : ''}</p><p className="mt-1 text-xs text-slate-500">Makes {v.yield?.quantity} {v.yield?.label}</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{v.ingredients.map((g, i) => <li key={i} className="rounded bg-slate-50 px-2 py-1">{g.quantity} {g.unit} - {g.itemName}</li>)}</ul></Card>)}<p className="text-xs text-slate-500">History is immutable. Past sales keep the recipe snapshot they were sold with, so editing a recipe never changes old food-cost figures.</p></div>}</Async></div>}
    </div>
  );
}
