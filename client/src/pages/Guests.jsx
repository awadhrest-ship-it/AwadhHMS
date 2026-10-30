import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { useGet, useDebounced } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { Async, Avatar, Badge, Button, EmptyState, Input, PageHeader, Pills, Table } from '../components/ui';
import GuestForm from '../components/GuestForm';
import { fmtHotelDate, fullName, maskPhone, money } from '../utils/format';

export default function Guests() {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || ''); const dq = useDebounced(q); const [flt, setFlt] = useState('all'); const [form, setForm] = useState(null);
  const params = { q: dq || undefined, vip: flt === 'vip' || undefined, repeat: flt === 'repeat' || undefined, outstanding: flt === 'due' || undefined, blacklist: flt === 'blacklist' || undefined };
  const st = useGet('/guests', params);
  return (<>
    <PageHeader title="Guests" subtitle="Profiles, stay history and preferences" actions={can('guests.create') && <Button onClick={() => setForm({})}><Plus size={16} />New guest</Button>} />
    <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
      <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="!pl-9" placeholder="Search name, phone or guest ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search guests" /></div>
      <Pills value={flt} onChange={setFlt} items={[{ key: 'all', label: 'All' }, { key: 'vip', label: 'VIP' }, { key: 'repeat', label: 'Repeat guests' }, { key: 'due', label: 'Outstanding balance' }, { key: 'blacklist', label: 'Blacklisted' }]} />
    </div>
    <div className="card">
      <Async state={st} empty={<EmptyState icon={Users} title="No guests found" text={dq ? 'Try a different name or phone number.' : 'Create your first guest profile to start taking bookings.'} action={can('guests.create') && <Button onClick={() => setForm({})}>New guest</Button>} />}>
        {(rows) => <Table rows={rows} onRow={(g) => nav(`/guests/${g._id}`)} columns={[
          { header: 'Guest', render: (g) => <div className="flex items-center gap-3"><Avatar guest={g} size={34} /><div><p className="font-semibold text-slate-900">{fullName(g)}</p><p className="text-xs text-slate-400">{g.guestId}{g.corporate?.name ? ` · ${g.corporate.name}` : ''}</p></div></div> },
          { header: 'Phone', render: (g) => maskPhone(g.phone) },
          { header: 'Flags', render: (g) => <div className="flex flex-wrap gap-1">{g.vip && <Badge tone="violet">VIP</Badge>}{g.isRepeat && <Badge tone="blue">Repeat</Badge>}{g.blacklist && <Badge tone="red">Blacklisted</Badge>}{g.marketingConsent && <Badge tone="green">Marketing</Badge>}</div> },
          { header: 'Outstanding', render: (g) => (g.outstandingBalance > 0 ? <span className="font-semibold text-red-600">{money(g.outstandingBalance)}</span> : '—') },
          { header: 'Last stay', render: (g) => (g.lastStay ? fmtHotelDate(g.lastStay) : '—') },
          { header: 'Actions', render: (g) => <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" onClick={() => nav(`/guests/${g._id}`)}>View</Button>{can('guests.edit') && <Button size="sm" variant="secondary" onClick={() => setForm(g)}>Edit</Button>}{can('reservations.create') && !g.blacklist && <Button size="sm" onClick={() => nav(`/reservations/new?guest=${g._id}`)}>New reservation</Button>}</div> },
        ]} />}
      </Async>
    </div>
    {form && <GuestForm guest={form._id ? form : null} onClose={() => setForm(null)} onSaved={(g) => { setForm(null); form._id ? st.reload() : nav(`/guests/${g._id}`); }} />}
  </>);
}
