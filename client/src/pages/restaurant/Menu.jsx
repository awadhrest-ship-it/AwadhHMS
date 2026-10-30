import { useState } from 'react';
import { Pencil, Plus, RotateCcw, Search, UtensilsCrossed } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pills, Select, Switch, Table, Textarea } from '../../components/ui';
import { ConfirmDialog, Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { SubNav, VegDot, rs } from './shared';

export default function Menu() {
  const can = useAuth((s) => s.can); const [cat, setCat] = useState('all'); const [q, setQ] = useState(''); const [show, setShow] = useState('active'); const dq = useDebounced(q, 250);
  const cats = useGet('/restaurant/menu/categories', { all: 'true' }); const items = useGet('/restaurant/menu/items', { active: show === 'active' ? 'true' : 'all', category: cat === 'all' ? undefined : cat, q: dq || undefined });
  const [itemForm, setItemForm] = useState(null); const [catForm, setCatForm] = useState(null); const [run, busy] = useAction(); const [reset, setReset] = useState(false);
  const mayMenu = can('restaurant.menu'); const mayAvail = can('restaurant.availability') || mayMenu;
  const toggle = async (it, available) => { let reason; if (!available) reason = window.prompt(`Why is ${it.name} unavailable? (optional)`) || undefined; try { await run(() => api.patch(`/restaurant/menu/items/${it._id}/availability`, { available, reason })); items.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div><PageHeader title="Menu" subtitle="What the restaurant sells and what is available today" actions={<>{mayAvail && <Button variant="secondary" onClick={() => setReset(true)}><RotateCcw size={15} />Reset availability</Button>}{mayMenu && <><Button variant="secondary" onClick={() => setCatForm({})}>Category</Button><Button onClick={() => setItemForm({})}><Plus size={16} />Add item</Button></>}</>} /><SubNav can={can} />
      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <Card title="Categories" pad={false}><Async state={cats}>{(rows) => <ul className="p-2"><li><button onClick={() => setCat('all')} className={`flex w-full justify-between rounded-lg px-3 py-2 text-sm ${cat === 'all' ? 'bg-brand-50 font-bold text-brand-800' : 'hover:bg-slate-50'}`}>All items</button></li>{rows.map((c) => <li key={c._id} className="group flex items-center"><button onClick={() => setCat(c._id)} className={`flex flex-1 justify-between rounded-lg px-3 py-2 text-sm ${cat === c._id ? 'bg-brand-50 font-bold text-brand-800' : 'hover:bg-slate-50'} ${c.active ? '' : 'opacity-50'}`}><span>{c.name}</span><span className="text-xs text-slate-400">{c.itemCount}</span></button>{mayMenu && <button className="p-1 text-slate-300 hover:text-slate-600" onClick={() => setCatForm(c)} aria-label={`Edit ${c.name}`}><Pencil size={13} /></button>}</li>)}</ul>}</Async></Card>
        <Card pad={false}>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="pl-9" placeholder="Search name, code, description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search menu" /></div><Pills items={[{ key: 'active', label: 'Active' }, { key: 'all', label: 'Include retired' }]} value={show} onChange={setShow} /></div>
          <Async state={items} empty={<EmptyState icon={UtensilsCrossed} title="No items" text="Add a menu item or change the filter." />}>{(rows) => (
            <Table columns={[{ header: 'Item', render: (i) => <div className={i.active ? '' : 'opacity-50'}><span className="flex items-center gap-2 font-semibold"><VegDot veg={i.isVeg} />{i.name}{i.code && <span className="font-mono text-[11px] font-normal text-slate-400">{i.code}</span>}</span><span className="text-xs text-slate-500">{i.category?.name}{i.description ? ` · ${i.description}` : ''}</span></div> },
              { header: 'Price', className: 'text-right', render: (i) => <div>{rs(i.price)}{!i.taxable && <div className="text-[10px] text-slate-400">no tax</div>}</div> },
              { header: 'Available today', render: (i) => (i.active ? (mayAvail ? <Switch checked={i.available} onChange={(v) => toggle(i, v)} label={i.available ? 'Available' : 'Unavailable'} /> : <Badge tone={i.available ? 'green' : 'red'}>{i.available ? 'Available' : 'Unavailable'}</Badge>) : <Badge>Retired</Badge>) },
              { header: '', render: (i) => mayMenu && <Button size="sm" variant="ghost" onClick={() => setItemForm(i)}>Edit</Button> }]} rows={rows} />)}</Async></Card></div>
      <ItemForm item={itemForm} cats={(cats.data || []).filter((c) => c.active)} onClose={() => setItemForm(null)} onDone={() => { items.reload(); cats.reload(); }} />
      <CategoryForm item={catForm} onClose={() => setCatForm(null)} onDone={() => { cats.reload(); items.reload(); }} />
      <ConfirmDialog open={reset} onClose={() => setReset(false)} title="Reset availability?" message="Marks every active item as available again - normally done at the start of the day." confirmLabel="Reset" busy={busy} onConfirm={async () => { try { const r = await run(() => api.post('/restaurant/menu/reset-availability')); toast.success(`${r.data.data.reset} item(s) available again`); items.reload(); setReset(false); } catch (e) { toast.error(e.message); } }} />
    </div>);
}

function ItemForm({ item, cats, onClose, onDone }) {
  const [f, setF] = useState({}); const [seen, setSeen] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [fe, setFe] = useState({});
  if (item && seen !== item) { setSeen(item); setErr(''); setFe({}); setF({ name: item.name || '', code: item.code || '', description: item.description || '', category: item.category?._id || '', price: item.price ?? '', taxable: item.taxable !== false, isVeg: item.isVeg == null ? '' : String(item.isVeg), active: item.active !== false }); }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const isNew = item && !item._id;
  const go = async () => { setErr(''); setFe({}); try { const body = { name: f.name, code: f.code || '', description: f.description, category: f.category, price: Number(f.price), taxable: f.taxable, isVeg: f.isVeg === '' ? null : f.isVeg === 'true' }; if (isNew) await run(() => api.post('/restaurant/menu/items', body)); else await run(() => api.put(`/restaurant/menu/items/${item._id}`, { ...body, active: f.active })); toast.success('Menu item saved'); onClose(); setSeen(null); onDone(); } catch (e) { setErr(e.message); setFe(e.fields || {}); } };
  return <Modal open={!!item} onClose={() => { onClose(); setSeen(null); }} title={isNew ? 'Add menu item' : `Edit ${item?.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.name || !f.category || f.price === ''} onClick={go}>Save item</Button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Name" required className="col-span-2" error={fe.name}><Input value={f.name || ''} onChange={set('name')} /></Field><Field label="Category" required><Select value={f.category || ''} onChange={set('category')}><option value="">Select…</option>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field><Field label="Price (₹)" required error={fe.price} hint="Max 2 decimals. Existing orders keep their old price."><Input type="number" min="0" step="0.01" value={f.price} onChange={set('price')} /></Field>
      <Field label="Code (optional)" error={fe.code}><Input value={f.code || ''} onChange={set('code')} maxLength={12} /></Field><Field label="Veg / non-veg"><Select value={f.isVeg} onChange={set('isVeg')}><option value="">Not specified</option><option value="true">Vegetarian</option><option value="false">Non-vegetarian</option></Select></Field><Field label="Description" className="col-span-2"><Textarea rows={2} value={f.description || ''} onChange={set('description')} /></Field></div>
    <div className="mt-4 space-y-3"><Switch checked={f.taxable} onChange={(v) => setF({ ...f, taxable: v })} label="Restaurant tax applies to this item" />{!isNew && <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active (retired items cannot be ordered, but stay on past orders)" />}</div>
    {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
function CategoryForm({ item, onClose, onDone }) {
  const [f, setF] = useState({}); const [seen, setSeen] = useState(null); const [run, busy] = useAction(); const [err, setErr] = useState('');
  if (item && seen !== item) { setSeen(item); setErr(''); setF({ name: item.name || '', sortOrder: item.sortOrder ?? 0, active: item.active !== false }); }
  const isNew = item && !item._id;
  const go = async () => { setErr(''); try { if (isNew) await run(() => api.post('/restaurant/menu/categories', { name: f.name, sortOrder: Number(f.sortOrder) })); else await run(() => api.put(`/restaurant/menu/categories/${item._id}`, { name: f.name, sortOrder: Number(f.sortOrder), active: f.active })); toast.success('Category saved'); onClose(); setSeen(null); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal open={!!item} onClose={() => { onClose(); setSeen(null); }} size="sm" title={isNew ? 'Add category' : 'Edit category'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.name} onClick={go}>Save</Button></>}>
    <Field label="Name" required><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Sort order" className="mt-3"><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>{!isNew && <div className="mt-3"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /></div>}{err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
