import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Plus, Search } from 'lucide-react';
import { useGet, useDebounced } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { Async, Badge, Button, EmptyState, Field, Input, PageHeader, Pills, Select, Table } from '../components/ui';
import { PAY_TONE, RES_TONE } from '../utils/constants';
import { fullName, money, stayRange } from '../utils/format';

export default function Reservations() {
  const can = useAuth((s) => s.can); const nav = useNavigate(); const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || ''); const dq = useDebounced(q); const [status, setStatus] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [room, setRoom] = useState('');
  const quick = sp.get('arrivals') ? { arrivals: 'today' } : sp.get('departures') ? { departures: 'today' } : {};
  const rooms = useGet('/rooms');
  const st = useGet('/reservations', { q: dq || undefined, status: status || undefined, from: from || undefined, to: to || undefined, room: room || undefined, ...quick });
  return (<>
    <PageHeader title="Reservations" subtitle={quick.arrivals ? "Today's arrivals" : quick.departures ? "Today's departures" : 'All bookings'} actions={can('reservations.create') && <Button onClick={() => nav('/reservations/new')}><Plus size={16} />New reservation</Button>} />
    <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
      <Field label="Search"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="!pl-9" placeholder="Guest, phone or booking #" value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
      <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['Pending', 'Confirmed', 'Checked In', 'Checked Out', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Room"><Select value={room} onChange={(e) => setRoom(e.target.value)}><option value="">All rooms</option>{(rooms.data || []).map((r) => <option key={r._id} value={r._id}>{r.roomNumber}</option>)}</Select></Field>
      <Field label="Arrives from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Arrives to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </div>
    <div className="card"><Async state={st} empty={<EmptyState icon={CalendarCheck} title="No reservations found" text="Change the filters or create a new reservation." action={can('reservations.create') && <Button onClick={() => nav('/reservations/new')}>New reservation</Button>} />}>
      {(rows) => <Table rows={rows} onRow={(r) => nav(`/reservations/${r._id}`)} columns={[
        { header: 'Booking', render: (r) => <span className="font-bold text-slate-900">{r.reservationNumber}</span> },
        { header: 'Guest', render: (r) => <>{fullName(r.guest)}{r.guest?.vip && <Badge tone="violet" className="ml-2">VIP</Badge>}</> },
        { header: 'Room', render: (r) => (r.room ? `${r.room.roomNumber} · ${r.roomCategory?.name}` : <Badge tone="amber">Unassigned · {r.roomCategory?.name}</Badge>) },
        { header: 'Stay', render: (r) => <>{stayRange(r.checkIn, r.checkOut)} <span className="text-slate-400">({r.numberOfNights}n)</span></> },
        { header: 'Total', render: (r) => money(r.totalAmount) },
        { header: 'Payment', render: (r) => <Badge tone={PAY_TONE[r.paymentStatus]}>{r.paymentStatus}</Badge> },
        { header: 'Status', render: (r) => <div className="flex gap-1"><Badge tone={RES_TONE[r.status]}>{r.status}</Badge>{r.pendingApproval && <Badge tone="amber">Approval pending</Badge>}</div> },
      ]} />}
    </Async></div>
  </>);
}
