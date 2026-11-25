import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAction, useGet } from '../hooks/useApi';
import { toast } from '../store/toast';
import { Button, Field, Input, Select, Switch, Textarea } from './ui';
import { Modal } from './feedback';

/** Create / edit a guest. Duplicate (configurable repeat-guest rule, TBC) returns 409 with the existing guest. */
export default function GuestForm({ guest, onClose, onSaved }) {
  const prop = useGet('/property');
  const [f, setF] = useState({
    firstName: guest?.firstName || '', lastName: guest?.lastName || '', phone: guest?.phone || '', email: guest?.email || '', address: guest?.address || '',
    corpName: guest?.corporate?.name || '', corpDesig: guest?.corporate?.designation || '', agentName: guest?.travelAgent?.name || '',
    preferences: (guest?.preferences || []).join(', '), vip: !!guest?.vip, blacklist: !!guest?.blacklist, blacklistReason: guest?.blacklistReason || '',
    marketingConsent: !!guest?.marketingConsent, whatsapp: !!guest?.communicationPreferences?.whatsapp, sms: !!guest?.communicationPreferences?.sms, emailPref: !!guest?.communicationPreferences?.email, notes: guest?.notes || '',
  });
  const [run, busy] = useAction(); const [errs, setErrs] = useState({}); const [dups, setDups] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (force) => {
    setErrs({}); setDups(null);
    const body = { firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.address,
      corporate: f.corpName || f.corpDesig ? { name: f.corpName, designation: f.corpDesig } : undefined, travelAgent: f.agentName ? { name: f.agentName } : undefined,
      preferences: f.preferences.split(',').map((x) => x.trim()).filter(Boolean), vip: f.vip, blacklist: f.blacklist, blacklistReason: f.blacklist ? f.blacklistReason : '',
      marketingConsent: f.marketingConsent, communicationPreferences: { whatsapp: f.whatsapp, sms: f.sms, email: f.emailPref }, notes: f.notes };
    try {
      const r = guest ? await run(() => api.put(`/guests/${guest._id}`, body)) : await run(() => api.post(`/guests${force ? '?force=true' : ''}`, body));
      toast.success(guest ? 'Guest updated' : 'Guest created'); onSaved(r.data.data);
    } catch (e) { if (e.status === 409 && e.details) setDups(e.details); else setErrs({ ...e.fields, _: e.message }); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={guest ? `Edit ${guest.firstName}` : 'New guest'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} loading={busy} disabled={!f.firstName || !f.phone}>{guest ? 'Save changes' : 'Create guest'}</Button></>}>
      {dups && <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" role="alert"><p className="font-semibold text-amber-900">This looks like a returning guest</p>
        <ul className="mt-1 space-y-1">{dups.map((d) => <li key={d.id}><Link className="font-semibold text-brand-700 underline" to={`/guests/${d.id}`} onClick={onClose}>{d.name}</Link> <span className="text-slate-500">· {d.guestId} · {d.phone}</span></li>)}</ul>
        <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={() => save(true)}>Create anyway</Button></div></div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required error={errs.firstName}><Input value={f.firstName} onChange={set('firstName')} error={errs.firstName} autoFocus /></Field>
        <Field label="Last name"><Input value={f.lastName} onChange={set('lastName')} /></Field>
        <Field label="Phone" required error={errs.phone}><Input inputMode="tel" value={f.phone} onChange={set('phone')} error={errs.phone} /></Field>
        <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} error={errs.email} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Company (corporate profile)"><Input value={f.corpName} onChange={set('corpName')} /></Field><Field label="Designation"><Input value={f.corpDesig} onChange={set('corpDesig')} /></Field>
        <Field label="Travel agent (agent profile)" className="sm:col-span-2"><Input value={f.agentName} onChange={set('agentName')} /></Field>
        <Field label="Preferences" hint="Comma separated, e.g. Ground floor, Extra pillows" className="sm:col-span-2"><Input value={f.preferences} onChange={set('preferences')} /></Field>
        <div className="space-y-3 sm:col-span-2"><div className="flex flex-wrap gap-x-8 gap-y-3"><Switch checked={f.vip} onChange={(v) => setF({ ...f, vip: v })} label="VIP" /><Switch checked={f.marketingConsent} onChange={(v) => setF({ ...f, marketingConsent: v })} label="Marketing consent" /></div>
          {f.marketingConsent && <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Preferred channels (data only — the system does not send messages):</span><Switch checked={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })} label="WhatsApp" /><Switch checked={f.sms} onChange={(v) => setF({ ...f, sms: v })} label="SMS" /><Switch checked={f.emailPref} onChange={(v) => setF({ ...f, emailPref: v })} label="Email" /></div>}
          <Switch checked={f.blacklist} onChange={(v) => setF({ ...f, blacklist: v })} label="Blacklisted (cannot be booked)" />{f.blacklist && <Field label="Blacklist reason"><Input value={f.blacklistReason} onChange={set('blacklistReason')} /></Field>}</div>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {errs._ && !dups && <p className="mt-3 text-sm text-red-600" role="alert">{errs._}</p>}
    </Modal>
  );
}
