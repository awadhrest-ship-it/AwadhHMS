import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, FileText, Upload } from 'lucide-react';
import api from '../services/api';
import { useGet, useAction } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Async, Avatar, Badge, Button, Card, EmptyState, Field, Input, Select, Table, Tabs, TBC } from '../components/ui';
import { Modal } from '../components/feedback';
import GuestForm from '../components/GuestForm';
import ComplaintForm from '../components/ComplaintForm';
import { COMPLAINT_TONE, PAY_TONE, PRIORITY_TONE, RES_TONE } from '../utils/constants';
import { fmtDate, fmtDateTime, fmtShort, fullName, money, stayRange } from '../utils/format';

function DocForm({ guest, onClose, onSaved }) {
  const prop = useGet('/property'); const [f, setF] = useState({ type: '', number: '', fileName: '' }); const [run, busy] = useAction();
  const save = async () => { try { await run(() => api.put(`/guests/${guest._id}`, { documents: [...guest.documents.map(({ type, number, fileName, notes }) => ({ type, number, fileName, notes })), f] })); toast.success('Document recorded'); onSaved(); } catch (e) { toast.error(e.message); } };
  const types = prop.data?.settings?.identityDocumentTypes || [];
  return <Modal open onClose={onClose} title="Record identity document" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.type}>Save document</Button></>}>
    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Accepted document types are still to be confirmed with the hotel, so this list is configurable. Only the document details are stored here, not the scan.</p>
    <div className="grid gap-4"><Field label="Document type" required><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{types.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Document number / last digits"><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field><Field label="File name or reference"><Input value={f.fileName} onChange={(e) => setF({ ...f, fileName: e.target.value })} /></Field></div></Modal>;
}

export default function GuestProfile() {
  const { id } = useParams(); const nav = useNavigate(); const can = useAuth((s) => s.can);
  const st = useGet(`/guests/${id}`); const [tab, setTab] = useState('info'); const [edit, setEdit] = useState(false); const [doc, setDoc] = useState(false); const [cmp, setCmp] = useState(false);
  return (<Async state={st} isEmpty={() => false}>{(g) => (<>
    <Link to="/guests" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-brand-700"><ArrowLeft size={15} />Guests</Link>
    <div className="card mb-4 flex flex-wrap items-center gap-4 p-5">
      <Avatar guest={g} size={64} /><div className="min-w-0 flex-1"><h1 className="text-2xl font-bold text-slate-900">{fullName(g)}</h1>
        <p className="text-sm text-slate-500">{g.guestId}{g.corporate?.name ? ` · ${g.corporate.name}` : ''}{g.travelAgent?.name ? ` · Agent: ${g.travelAgent.name}` : ''}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{g.vip && <Badge tone="violet">VIP</Badge>}{g.isRepeat && <Badge tone="blue">Repeat guest</Badge>}{g.marketingConsent && <Badge tone="green">Marketing consent</Badge>}{g.blacklist && <Badge tone="red">Blacklisted</Badge>}</div></div>
      <div className="flex flex-wrap gap-2">{can('guests.edit') && <Button variant="secondary" onClick={() => setEdit(true)}><Pencil size={14} />Edit</Button>}{can('reservations.create') && !g.blacklist && <Button onClick={() => nav(`/reservations/new?guest=${g._id}`)}><Plus size={14} />New reservation</Button>}</div>
    </div>
    {g.blacklist && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Blacklisted{g.blacklistReason ? `: ${g.blacklistReason}` : ''}. New bookings are blocked.</p>}
    <Tabs value={tab} onChange={setTab} items={[{ key: 'info', label: 'Info' }, { key: 'stays', label: 'Stays', count: g.stays.length }, { key: 'prefs', label: 'Preferences' }, { key: 'docs', label: 'Documents', count: g.documents.length }, { key: 'pay', label: 'Payments' }, { key: 'cmp', label: 'Complaints', count: g.complaints.length }]} />
    <div className="mt-4">
      {tab === 'info' && <div className="grid gap-4 md:grid-cols-2"><Card title="Contact"><dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm"><dt className="text-slate-500">Phone</dt><dd className="font-medium">{g.phone}</dd><dt className="text-slate-500">Email</dt><dd className="font-medium">{g.email || '—'}</dd><dt className="text-slate-500">Address</dt><dd className="font-medium">{g.address || '—'}</dd><dt className="text-slate-500">Company</dt><dd className="font-medium">{g.corporate?.name || '—'}{g.corporate?.designation ? `, ${g.corporate.designation}` : ''}</dd><dt className="text-slate-500">Travel agent</dt><dd className="font-medium">{g.travelAgent?.name || '—'}</dd></dl></Card>
        <Card title="Marketing & communication" badge={<TBC>Sending TBC</TBC>}><p className="text-sm">Marketing consent: <b>{g.marketingConsent ? 'Given' : 'Not given'}</b></p><div className="mt-2 flex gap-1.5">{['whatsapp', 'sms', 'email'].map((c) => <Badge key={c} tone={g.communicationPreferences?.[c] ? 'green' : 'slate'}>{c}</Badge>)}</div><p className="mt-3 text-xs text-slate-400">Only consent and contact data are stored. No messages are sent from this system.</p>{g.notes && <p className="mt-3 text-sm text-slate-600">{g.notes}</p>}</Card></div>}
      {tab === 'stays' && <Card pad={false} title="Stay history"><Table rows={g.stays} empty={<EmptyState title="No stays yet" />} onRow={(s) => nav(`/reservations/${s._id}`)} columns={[{ header: 'Dates', render: (s) => stayRange(s.checkIn, s.checkOut) }, { header: 'Booking', key: 'reservationNumber' }, { header: 'Room', render: (s) => (s.room ? `${s.roomCategory?.name || ''} ${s.room.roomNumber}` : 'Unassigned') }, { header: 'Total', render: (s) => money(s.totalAmount) }, { header: 'Status', render: (s) => <Badge tone={RES_TONE[s.status]}>{s.status}</Badge> }, { header: 'Payment', render: (s) => <Badge tone={PAY_TONE[s.paymentStatus]}>{s.paymentStatus}</Badge> }]} /></Card>}
      {tab === 'prefs' && <Card title="Preferences">{g.preferences.length ? <div className="flex flex-wrap gap-2">{g.preferences.map((p) => <Badge key={p} className="!px-3 !py-1.5 !text-xs">{p}</Badge>)}</div> : <p className="text-sm text-slate-500">No preferences recorded. Add them with Edit.</p>}</Card>}
      {tab === 'docs' && <Card title="Identity documents" badge={<TBC>Types TBC</TBC>} action={can('guests.edit') && <Button size="sm" variant="secondary" onClick={() => setDoc(true)}><Upload size={14} />Record document</Button>}>
        {g.documents.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{g.documents.map((d, i) => <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><FileText className="text-slate-400" /><div><p className="text-sm font-bold">{d.type}</p><p className="text-xs text-slate-500">{d.number || d.fileName || '—'} · {fmtDate(d.addedAt)}</p></div><Badge tone="green" className="ml-auto">On file</Badge></div>)}</div> : <p className="text-sm text-slate-500">No documents on file.</p>}</Card>}
      {tab === 'pay' && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Card><p className="label">Outstanding</p><p className={`text-2xl font-extrabold ${g.outstandingBalance > 0 ? 'text-red-600' : ''}`}>{money(g.outstandingBalance)}</p></Card><Card><p className="label">Total paid</p><p className="text-2xl font-extrabold">{money(g.payments.paid)}</p></Card><Card><p className="label">Open bill balance</p><p className="text-2xl font-extrabold">{money(g.payments.openFolioDue)}</p></Card></div>
        {can('bills.view') && <Card title="Bills" pad={false}><Table rows={g.payments.folios} empty={<EmptyState title="No bills yet" />} onRow={(f) => nav(`/bills/${f._id}`)} columns={[{ header: 'Bill', key: 'folioNumber' }, { header: 'Booking', render: (f) => f.reservation?.reservationNumber }, { header: 'Charges', render: (f) => money(f.totalCharges) }, { header: 'Paid', render: (f) => money(f.totalPaid) }, { header: 'Due', render: (f) => money(f.outstanding) }, { header: 'Status', render: (f) => <Badge tone={f.status === 'Open' ? 'amber' : 'green'}>{f.status}</Badge> }]} /></Card>}</div>}
      {tab === 'cmp' && <Card title="Complaint history" pad={false} action={can('complaints.create') && <Button size="sm" onClick={() => setCmp(true)}><Plus size={14} />Register complaint</Button>}><Table rows={g.complaints} empty={<EmptyState title="No complaints" text="This guest has not raised any complaints." />} onRow={(c) => nav(`/complaints/${c._id}`)} columns={[{ header: 'Complaint', key: 'complaintNumber' }, { header: 'Category', key: 'category' }, { header: 'Description', render: (c) => <span className="line-clamp-1 max-w-xs">{c.description}</span> }, { header: 'Priority', render: (c) => <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge> }, { header: 'Status', render: (c) => <Badge tone={COMPLAINT_TONE[c.status]}>{c.status}</Badge> }, { header: 'Raised', render: (c) => fmtDateTime(c.createdAt) }]} /></Card>}
    </div>
    {edit && <GuestForm guest={g} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); st.reload(); }} />}
    {doc && <DocForm guest={g} onClose={() => setDoc(false)} onSaved={() => { setDoc(false); st.reload(); }} />}
    {cmp && <ComplaintForm guest={g} onClose={() => setCmp(false)} onSaved={() => { setCmp(false); st.reload(); }} />}
  </>)}</Async>);
}
