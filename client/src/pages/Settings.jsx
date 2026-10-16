import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Switch, Table, TBC, cx } from '../components/ui';
import { Modal } from '../components/feedback';
import { DEPARTMENTS } from '../utils/constants';
import { fmtDateTime, money } from '../utils/format';

/* ---------------- Users ---------------- */
function UserForm({ user, roles, onClose, onSaved }) {
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', phone: user?.phone || '', role: user?.role?._id || roles[0]?._id || '', department: user?.department || 'Front Office', password: '', active: user?.active ?? true });
  const [run, busy] = useAction(); const [errs, setErrs] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { setErrs({}); const body = { ...f }; if (user && !body.password) delete body.password;
    try { user ? await run(() => api.put(`/users/${user._id}`, body)) : await run(() => api.post('/users', body)); toast.success(user ? 'User updated' : 'User created'); onSaved(); } catch (e) { setErrs({ ...e.fields, _: e.message }); } };
  return <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : 'New user'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name || !f.email || (!user && f.password.length < 8)}>{user ? 'Save changes' : 'Create user'}</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" required error={errs.name}><Input value={f.name} onChange={set('name')} error={errs.name} /></Field><Field label="Email (login)" required error={errs.email}><Input type="email" value={f.email} onChange={set('email')} error={errs.email} /></Field>
      <Field label="Role" required><Select value={f.role} onChange={set('role')}>{roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</Select></Field>
      <Field label="Department" required hint="Staff are restricted to their own department's modules"><Select value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
      <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
      <Field label={user ? 'New password (optional)' : 'Password'} required={!user} error={errs.password} hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errs.password} /></Field>
      {user && <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active (can sign in)" /></div>}</div>{errs._ && <p className="mt-3 text-sm text-red-600" role="alert">{errs._}</p>}</Modal>;
}
export function UsersPage() {
  const can = useAuth((s) => s.can); const st = useGet('/users'); const roles = useGet('/roles'); const [form, setForm] = useState(null);
  return (<>
    <PageHeader title="Users" subtitle="Every employee has their own login" actions={can('users.create') && roles.data && <Button onClick={() => setForm({})}><Plus size={16} />New user</Button>} />
    <div className="card"><Async state={st} empty={<EmptyState title="No users" />}>{(rows) => <Table rows={rows} columns={[{ header: 'Name', render: (u) => <><b>{u.name}</b><br /><span className="text-xs text-slate-400">{u.email}</span></> }, { header: 'Role', render: (u) => u.role?.name }, { header: 'Department', key: 'department' }, { header: 'Last sign-in', render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Never') }, { header: 'Status', render: (u) => <Badge tone={u.active ? 'green' : 'slate'}>{u.active ? 'Active' : 'Disabled'}</Badge> }, { header: '', render: (u) => can('users.edit') && <Button size="sm" variant="ghost" onClick={() => setForm(u)}><Pencil size={14} />Edit</Button> }]} />}</Async></div>
    {form && roles.data && <UserForm user={form._id ? form : null} roles={roles.data} onClose={() => setForm(null)} onSaved={() => { setForm(null); st.reload(); }} />}
  </>);
}

/* ---------------- Roles ---------------- */
function RoleForm({ role, perms, onClose, onSaved }) {
  const me = useAuth((s) => s.user); const mine = new Set(me.permissions);
  const [f, setF] = useState({ name: role?.name || '', description: role?.description || '', department: role?.department || 'Front Office', crossDepartment: !!role?.crossDepartment, permissions: new Set(role?.permissions || []) });
  const [run, busy] = useAction(); const [err, setErr] = useState('');
  const groups = perms.reduce((a, p) => ((a[p.module] = [...(a[p.module] || []), p]), a), {});
  const toggle = (c) => { const s = new Set(f.permissions); s.has(c) ? s.delete(c) : s.add(c); setF({ ...f, permissions: s }); };
  const save = async () => { const body = { name: f.name, description: f.description, department: f.department, crossDepartment: f.crossDepartment, permissions: [...f.permissions] };
    try { role ? await run(() => api.put(`/roles/${role._id}`, body)) : await run(() => api.post('/roles', body)); toast.success(role ? 'Role updated' : 'Role created'); onSaved(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} size="xl" title={role ? `Edit ${role.name}` : 'New custom role'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name}>Save role</Button></>}>
    <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">The exact rights per role are still to be confirmed with the hotel, so these are editable starting points. You can only grant permissions you hold yourself.</p>
    <div className="grid gap-4 sm:grid-cols-3"><Field label="Role name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={role?.isSystem} /></Field><Field label="Department"><Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field><div className="flex items-end"><Switch checked={f.crossDepartment} onChange={(v) => setF({ ...f, crossDepartment: v })} label="Can work across departments" /></div></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(groups).map(([m, list]) => <div key={m} className="rounded-xl border border-slate-200 p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{m}</p>{list.map((p) => <label key={p.code} className={cx('flex items-center gap-2 py-1 text-sm', !mine.has(p.code) && 'opacity-40')}><input type="checkbox" checked={f.permissions.has(p.code)} disabled={!mine.has(p.code)} onChange={() => toggle(p.code)} />{p.label}</label>)}</div>)}</div>
    {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}</Modal>;
}
export function RolesPage() {
  const can = useAuth((s) => s.can); const st = useGet('/roles'); const perms = useGet(can('roles.view') ? '/permissions' : null); const [form, setForm] = useState(null);
  return (<>
    <PageHeader title="Roles & permissions" subtitle="Managers can create custom roles" actions={<>{<TBC>Role matrix TBC</TBC>}{can('roles.create') && perms.data && <Button onClick={() => setForm({})}><Plus size={16} />Custom role</Button>}</>} />
    <div className="card"><Async state={st} empty={<EmptyState title="No roles" />}>{(rows) => <Table rows={rows} columns={[{ header: 'Role', render: (r) => <><b>{r.name}</b>{r.isSystem && <Badge className="ml-2">Standard</Badge>}</> }, { header: 'Department', key: 'department' }, { header: 'Cross-department', render: (r) => (r.crossDepartment ? 'Yes' : 'No') }, { header: 'Permissions', render: (r) => <span className="text-slate-600">{r.permissions.length}</span> }, { header: '', render: (r) => can('roles.edit') && r.key !== 'hotel_owner' && <Button size="sm" variant="ghost" onClick={() => setForm(r)}><Pencil size={14} />Edit</Button> }]} />}</Async></div>
    {form && perms.data && <RoleForm role={form._id ? form : null} perms={perms.data} onClose={() => setForm(null)} onSaved={() => { setForm(null); st.reload(); }} />}
  </>);
}

/* ---------------- Property & business rules ---------------- */
const ListEditor = ({ label, hint, value, onChange }) => <Field label={label} hint={hint}><Input value={value.join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>;
export function PropertyPage() {
  const can = useAuth((s) => s.can); const st = useGet('/property'); const roles = useGet('/roles'); const [run, busy] = useAction();
  const [f, setF] = useState(null); const edit = can('property.edit');
  if (st.data && !f) setTimeout(() => setF({ name: st.data.name, location: st.data.location, facilities: st.data.facilities, ...st.data.settings }), 0);
  const save = async () => { try { await run(() => api.put('/property', { name: f.name, location: f.location, facilities: f.facilities, settings: { taxRatePercent: Number(f.taxRatePercent), paymentMethods: f.paymentMethods, bookingSources: f.bookingSources, identityDocumentTypes: f.identityDocumentTypes, repeatGuestMatch: f.repeatGuestMatch, complaintCategories: f.complaintCategories, checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, approvalRules: f.approvalRules } })); toast.success('Property settings saved'); st.reload(); } catch (e) { toast.error(e.message); } };
  const rule = (t, patch) => setF({ ...f, approvalRules: { ...f.approvalRules, [t]: { ...f.approvalRules[t], ...patch } } });
  return (<Async state={st} isEmpty={() => false}>{() => !f ? null : (<>
    <PageHeader title="Property & rules" subtitle="One property · items marked TBC are configurable until the hotel confirms them" actions={edit && <Button onClick={save} loading={busy}>Save changes</Button>} />
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Property"><div className="grid gap-4"><Field label="Name"><Input value={f.name} disabled={!edit} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Location"><Input value={f.location} disabled={!edit} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field><ListEditor label="Facilities" hint="Comma separated" value={f.facilities} onChange={(v) => setF({ ...f, facilities: v })} /><div className="grid grid-cols-2 gap-4"><Field label="Check-in time"><Input value={f.checkInTime} onChange={(e) => setF({ ...f, checkInTime: e.target.value })} /></Field><Field label="Check-out time"><Input value={f.checkOutTime} onChange={(e) => setF({ ...f, checkOutTime: e.target.value })} /></Field></div></div></Card>
      <Card title="Billing & guests" badge={<TBC />}><div className="grid gap-4"><Field label="Tax rate on room charges (%)" hint="Not confirmed — 0 until configured"><Input type="number" min="0" max="100" value={f.taxRatePercent} disabled={!edit} onChange={(e) => setF({ ...f, taxRatePercent: e.target.value })} /></Field>
        <ListEditor label="Payment methods" value={f.paymentMethods} onChange={(v) => setF({ ...f, paymentMethods: v })} /><ListEditor label="Booking sources" value={f.bookingSources} onChange={(v) => setF({ ...f, bookingSources: v })} /><ListEditor label="Identity document types" value={f.identityDocumentTypes} onChange={(v) => setF({ ...f, identityDocumentTypes: v })} /><ListEditor label="Complaint categories" value={f.complaintCategories} onChange={(v) => setF({ ...f, complaintCategories: v })} />
        <Field label="Repeat-guest matching" hint="How a returning guest is recognised"><div className="flex flex-wrap gap-3">{['phone', 'email', 'name', 'document'].map((m) => <label key={m} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!edit} checked={f.repeatGuestMatch.includes(m)} onChange={() => setF({ ...f, repeatGuestMatch: f.repeatGuestMatch.includes(m) ? f.repeatGuestMatch.filter((x) => x !== m) : [...f.repeatGuestMatch, m] })} />{m}</label>)}</div></Field></div></Card>
    </div>
    <Card className="mt-4" title="Approval rules" badge={<TBC>Thresholds TBC</TBC>} pad={false}>
      <div className="scroll-thin overflow-x-auto"><table className="min-w-full"><thead><tr><th className="th">Action</th><th className="th">Needs approval</th><th className="th">Approver roles</th><th className="th">Value threshold</th></tr></thead><tbody className="divide-y divide-slate-100">
        {Object.entries(f.approvalRules).map(([t, r]) => <tr key={t}><td className="td font-semibold">{t}</td><td className="td"><Switch checked={r.required} disabled={!edit} onChange={(v) => rule(t, { required: v })} /></td>
          <td className="td"><div className="flex flex-wrap gap-1.5">{(roles.data || []).filter((x) => x.permissions.includes('approvals.approve')).map((x) => <button key={x.key} disabled={!edit} onClick={() => rule(t, { approverRoles: r.approverRoles.includes(x.key) ? r.approverRoles.filter((k) => k !== x.key) : [...r.approverRoles, x.key] })} className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', r.approverRoles.includes(x.key) ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500')}>{x.name}</button>)}</div></td>
          <td className="td text-xs text-slate-500">{r.thresholds?.length ? r.thresholds.map((th) => `${money(th.minAmount)}+`).join(', ') : 'None set'}</td></tr>)}</tbody></table></div>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Only cancellation and price-change approvals are wired into Phases 1–3 workflows. The other types are listed so later phases can use the same framework.</p>
    </Card>
  </>)}</Async>);
}
