import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Search } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useDebounced, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Input, PageHeader, Pills, Table } from '../../components/ui';
import { SubNav, rs, pct } from './shared';

export const CostBadge = ({ cost }) => !cost ? null : cost.complete ? <span className="font-semibold">{pct(cost.foodCostPercent)}</span>
  : <span className="text-amber-700" title="Some ingredients have no cost on record, so the food-cost result is incomplete">{cost.knownFoodCostPercent != null ? `≥ ${cost.knownFoodCostPercent}%` : '-'} <Badge tone="amber">incomplete</Badge></span>;

export default function Recipes() {
  const can = useAuth((s) => s.can); const [show, setShow] = useState('all'); const [q, setQ] = useState(''); const dq = useDebounced(q, 250);
  const rec = useGet('/kitchen/recipes', { q: dq || undefined, active: show === 'all' ? undefined : show === 'active' ? 'true' : 'false' }); const missing = useGet('/kitchen/recipes-missing'); const mayEdit = can('kitchen.recipes.edit');
  return (
    <div><SubNav can={can} />
      <PageHeader title="Recipes & food cost" subtitle="What each menu item uses from stock. Selling a menu item consumes its recipe ingredients (when the bill is finalised)." actions={mayEdit && <Link to="/kitchen/recipes/new"><Button><Plus size={16} />New recipe</Button></Link>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <Card pad={false}>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="pl-9" placeholder="Search recipe or menu item" aria-label="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Pills items={[{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }]} value={show} onChange={setShow} /></div>
          <Async state={rec} empty={<EmptyState icon={BookOpen} title="No recipes yet" text="Create a recipe to link a menu item to the inventory ingredients it uses." />}>{(rows) => (
            <Table rows={rows} columns={[
              { header: 'Recipe', render: (r) => <Link to={`/kitchen/recipes/${r._id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link> },
              { header: 'Menu item', render: (r) => <span>{r.menuItem?.name}<span className="block text-xs text-slate-400">{r.menuItem?.category?.name}</span></span> },
              { header: 'Ingredients', render: (r) => r.ingredientCount }, { header: 'Cost / serving', className: 'text-right', render: (r) => r.cost.costPerServing != null ? rs(r.cost.costPerServing) : '-' },
              { header: 'Price', className: 'text-right', render: (r) => rs(r.menuItem?.price) }, { header: 'Food cost %', className: 'text-right', render: (r) => <CostBadge cost={r.cost} /> },
              { header: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Inactive'} · v{r.version}</Badge> }]} />)}</Async>
        </Card>
        <Card title="Menu items without a recipe" badge={missing.data ? <Badge tone="amber">{missing.data.length}</Badge> : null}>
          <p className="mb-2 text-xs text-slate-500">These sell normally but use no stock until a recipe exists.</p>
          <Async state={missing} empty={<p className="text-sm font-semibold text-emerald-700">Every active menu item has a recipe.</p>}>{(rows) => <ul className="max-h-96 divide-y divide-slate-100 overflow-auto text-sm">{rows.map((m) => <li key={m._id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate">{m.name}</span>{mayEdit && <Link className="shrink-0 text-xs font-bold text-brand-700" to={`/kitchen/recipes/new?menuItem=${m._id}`}>Add</Link>}</li>)}</ul>}</Async>
        </Card>
      </div>
    </div>
  );
}
