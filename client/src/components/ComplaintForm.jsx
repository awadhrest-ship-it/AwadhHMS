import { useState } from 'react';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { toast } from '../store/toast';
import { Button, Field, Select, Textarea } from './ui';
import { Modal } from './feedback';
import GuestPicker from './GuestPicker';

/** Register a complaint. Pass `guest` to fix the guest (e.g. from a profile). Categories come from property settings (TBC). */
export default function ComplaintForm({ guest: fixed, onClose, onSaved }) {
  const prop = useGet('/property'); const rooms = useGet('/rooms');
  const [guest, setGuest] = useState(fixed || null); const [f, setF] = useState({ room: '', category: 'Other', priority: 'Medium', description: '' });
  const [run, busy] = useAction(); const [errs, setErrs] = useState({});
  const save = async () => { setErrs({}); try { await run(() => api.post('/complaints', { guest: guest._id, room: f.room || null, category: f.category, priority: f.priority, description: f.description })); toast.success('Complaint registered'); onSaved(); } catch (e) { setErrs({ ...e.fields, _: e.message }); } };
  return (
    <Modal open onClose={onClose} title="Register complaint" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!guest || f.description.trim().length < 5}>Register complaint</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Guest" required>{fixed ? <p className="text-sm font-semibold">{fixed.firstName} {fixed.lastName}</p> : <GuestPicker value={guest} onChange={setGuest} />}</Field></div>
        <Field label="Room"><Select value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })}><option value="">Not room-specific</option>{(rooms.data || []).map((r) => <option key={r._id} value={r._id}>{r.roomNumber} · {r.category?.name}</option>)}</Select></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(prop.data?.settings?.complaintCategories || ['Other']).map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['Low', 'Medium', 'High', 'Urgent'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <div className="sm:col-span-2"><Field label="What happened?" required error={errs.description}><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={errs.description} placeholder="Describe the complaint in the guest's words" /></Field></div>
      </div>{errs._ && !errs.description && <p className="mt-3 text-sm text-red-600" role="alert">{errs._}</p>}
    </Modal>
  );
}
