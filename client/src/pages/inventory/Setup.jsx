import { useState } from 'react';
import api from '../../services/api';
import { useAction, useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toast';
import { Async, Badge, Button, Card, Field, Input, PageHeader, Select, Switch, Table, Tabs, TBC, Textarea } from '../../components/ui';
import { Drawer } from '../../components/feedback';
import { STOCK_DEPARTMENTS } from '../../utils/constants';

function CategoryDrawer({ cat, onClose, onSaved }) {
  const [f, setF] = useState({ name: cat?.name || '', description: cat?.description || '', defaultDepartment: cat?.defaultDepartment || '', trackExpiryDefault: !!cat?.trackExpiryDefault, active: cat?.active !== false });
  const [run, busy] = useAction(); const [err, setErr] = useState('');
  const save = async () => { setErr(''); try { const body = { ...f, defaultDepartment: f.defaultDepartment || undefined }; await run(() => (cat?._id ? api.put(`/inventory/categories/${cat._id}`, body) : api.post('/inventory/categories', body))); toast.success('Category saved'); onSaved(); } catch (e) { setErr(e.message); } };
  return (
    <Drawer open onClose={onClose} title={cat?._id ? 'Edit category' : 'New category'} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={f.name.trim().length < 2}>Save</Button></div>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Usually held by" hint="A suggestion only; stock can be held by any stock department."><Select value={f.defaultDepartment} onChange={(e) => setF({ ...f, defaultDepartment: e.target.value })}><option value="">No suggestion</option>{STOCK_DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Switch checked={f.trackExpiryDefault} onChange={(v) => setF({ ...f, trackExpiryDefault: v })} label="New items in this category track expiry dates" />
        {cat?._id && <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </div>
    </Drawer>
  );
}

function UnitDrawer({ onClose, onSaved }) {
  const [f, setF] = useState({ code: '', name: '', dimension: 'package', toBase: '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const measured = f.dimension !== 'package';
  const save = async () => { setErr(''); try { await run(() => api.post('/inventory/units', { code: f.code.trim().toLowerCase(), name: f.name.trim(), dimension: f.dimension, ...(measured ? { toBase: Number(f.toBase) } : {}) })); toast.success('Unit added'); onSaved(); } catch (e) { setErr(e.message); } };
  return (
    <Drawer open onClose={onClose} title="New unit" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={!f.code.trim() || f.name.trim().length < 2 || (measured && !(Number(f.toBase) > 0))}>Add unit</Button></div>}>
      <div className="space-y-4">
        <Field label="Code" required hint="Short, e.g. tray"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type" hint="Package units (bag, carton…) get their size on each item, because a bag of rice and a bag of sugar differ."><Select value={f.dimension} onChange={(e) => setF({ ...f, dimension: e.target.value })}>{['package', 'count', 'weight', 'volume'].map((d) => <option key={d}>{d}</option>)}</Select></Field>
        {measured && <Field label={`Equals how many ${{ count: 'pieces', weight: 'grams', volume: 'millilitres' }[f.dimension]}?`} required><Input type="number" min="0" step="any" value={f.toBase} onChange={(e) => setF({ ...f, toBase: e.target.value })} /></Field>}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </div>
    </Drawer>
  );
}

function SettingsCard() {
  const can = useAuth((s) => s.can); const st = useGet('/inventory/settings'); const [run, busy] = useAction(); const [f, setF] = useState(null);
  const cur = f || st.data;
  const save = async () => { try { await run(() => api.put('/inventory/settings', { expiryWarningDays: Number(cur.expiryWarningDays), expiryNotifications: !!cur.expiryNotifications })); toast.success('Settings saved'); setF(null); st.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <Card title="Stock rules">
      <Async state={st} isEmpty={() => false}>{() => (
        <div className="max-w-md space-y-4">
          <Field label="Warn about expiry (days before)" hint="Batches expiring inside this window are flagged."><Input type="number" min="0" max="365" disabled={!can('property.edit')} value={cur.expiryWarningDays} onChange={(e) => setF({ ...cur, expiryWarningDays: e.target.value })} /></Field>
          <div><Switch disabled={!can('property.edit')} checked={!!cur.expiryNotifications} onChange={(v) => setF({ ...cur, expiryNotifications: v })} label="Send expiry notifications" /><p className="mt-1 text-xs text-slate-500">The PDF leaves expiry alerts to be confirmed, so this is off by default. <TBC>TBC</TBC></p></div>
          <p className="text-xs text-slate-500">Departments that hold stock: {(cur.stockDepartments || []).join(', ')}. Users of {(cur.allAccessDepartments || []).join(', ')} (and cross-department roles) can work with every department's stock; everyone else only with their own.</p>
          {can('property.edit') ? <Button loading={busy} disabled={!f} onClick={save}>Save rules</Button> : <p className="text-xs text-slate-400">Changing these needs the property-settings permission.</p>}
        </div>
      )}</Async>
    </Card>
  );
}

export default function Setup() {
  const can = useAuth((s) => s.can); const [tab, setTab] = useState('categories'); const cats = useGet('/inventory/categories'); const units = useGet('/inventory/units'); const [cd, setCd] = useState(null); const [ud, setUd] = useState(false);
  return (
    <>
      <PageHeader title="Units & categories" subtitle="How stock is grouped and measured" actions={tab === 'categories' ? can('inventory.create') && <Button onClick={() => setCd({})}>New category</Button> : tab === 'units' ? can('inventory.create') && <Button onClick={() => setUd(true)}>New unit</Button> : null} />
      <Tabs items={[{ key: 'categories', label: 'Categories' }, { key: 'units', label: 'Units' }, { key: 'rules', label: 'Rules' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'categories' && <Card pad={false}><Async state={cats} isEmpty={() => false}>{(rows) => <Table rows={rows} onRow={can('inventory.edit') ? setCd : undefined} columns={[{ header: 'Category', render: (r) => <span className="font-semibold">{r.name}</span> }, { header: 'Usually held by', render: (r) => r.defaultDepartment || '—' }, { header: 'Expiry', render: (r) => (r.trackExpiryDefault ? 'Tracked' : '—') }, { header: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Inactive'}</Badge> }]} />}</Async></Card>}
        {tab === 'units' && <Card pad={false}><Async state={units} isEmpty={() => false}>{(rows) => <Table rows={rows} columns={[{ header: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> }, { header: 'Name', key: 'name' }, { header: 'Type', render: (r) => <Badge>{r.dimension}</Badge> }, { header: 'Equals', render: (r) => (r.dimension === 'package' ? 'Set per item' : `${r.toBase} ${{ count: 'pcs', weight: 'g', volume: 'ml' }[r.dimension]}`) }]} />}</Async></Card>}
        {tab === 'rules' && <SettingsCard />}
      </div>
      {cd && <CategoryDrawer cat={cd._id ? cd : null} onClose={() => setCd(null)} onSaved={() => { setCd(null); cats.reload(); }} />}
      {ud && <UnitDrawer onClose={() => setUd(false)} onSaved={() => { setUd(false); units.reload(); }} />}
    </>
  );
}
