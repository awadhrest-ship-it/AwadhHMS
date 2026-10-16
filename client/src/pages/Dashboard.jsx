import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, ArrowRight } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { Async, Badge, Button, Card, EmptyState, Kpi, Pills, RoomStatusBadge, Table, cx } from '../components/ui';
import { ROOM_STATUS, ROOM_STATUS_LIST, PAY_TONE, RES_TONE, SEVERITY_TONE } from '../utils/constants';
import { compactMoney, fmtDateTime, fmtDay, fmtHotelDate, fmtShort, fullName, greeting, money, dayNum } from '../utils/format';

const KPI = ({ label, value, sub, tone, to }) => <Kpi label={label} value={value} sub={sub} tone={tone} to={to} />;

function ArrivalsTable({ rows, can, nav }) {
  return <Table rows={rows} empty={<EmptyState title="No arrivals today" text="New bookings for today will show up here." />} columns={[
    { header: 'Guest', render: (r) => <Link to={`/guests/${r.guest?._id}`} className="font-semibold text-slate-900 hover:text-brand-700">{fullName(r.guest)}{r.guest?.vip && <Badge tone="violet" className="ml-2">VIP</Badge>}</Link> },
    { header: 'Room', render: (r) => r.room?.roomNumber || '—' },
    { header: 'Type', render: (r) => r.roomCategory?.name },
    { header: 'Payment', render: (r) => <Badge tone={PAY_TONE[r.paymentStatus]}>{r.paymentStatus}</Badge> },
    { header: 'Action', render: (r) => <div className="flex gap-1.5">
      {r.status === 'Checked In' ? <Badge tone="indigo">Checked in</Badge> : can('reservations.checkin') && <Button size="sm" onClick={() => nav(`/check-in?res=${r._id}`)}>{r.room ? 'Check-in' : 'Assign room'}</Button>}
      <Button size="sm" variant="secondary" onClick={() => nav(`/reservations/${r._id}`)}>View</Button></div> },
  ]} />;
}
function DeparturesTable({ rows, can, nav }) {
  return <Table rows={rows} empty={<EmptyState title="No departures today" />} columns={[
    { header: 'Guest', render: (r) => <span className="font-semibold text-slate-900">{fullName(r.guest)}</span> },
    { header: 'Room', render: (r) => r.room?.roomNumber },
    { header: 'Bill', render: (r) => money(r.folio?.totalCharges) },
    { header: 'Payment', render: (r) => (r.folio?.outstanding > 0 ? <Badge tone="amber">Due {money(r.folio.outstanding)}</Badge> : <Badge tone="green">Settled</Badge>) },
    { header: 'Action', render: (r) => r.status === 'Checked Out' ? <Badge>Checked out</Badge> : <div className="flex gap-1.5">
      {r.folio?.outstanding > 0 ? can('bills.payment') && <Button size="sm" onClick={() => nav(`/bills/${r.folio._id}`)}>Collect payment</Button> : can('reservations.checkout') && <Button size="sm" onClick={() => nav(`/check-out?res=${r._id}`)}>Check-out</Button>}
      {can('bills.view') && r.folio && <Button size="sm" variant="secondary" onClick={() => nav(`/bills/${r.folio._id}`)}>View bill</Button>}</div> },
  ]} />;
}

function Management({ d, can, nav, user }) {
  const k = d.kpis; const trend = d.occupancyTrend || [];
  const total = Object.values(d.roomStatus).reduce((a, b) => a + b, 0) || 1;
  return (<>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">{greeting()}, {user.name.split(' ')[0]}</h1><p className="text-sm text-slate-500">{fmtHotelDate(d.today)} · Awadh Palace</p></div>
      <div className="flex flex-wrap gap-2">{can('reservations.create') && <Button onClick={() => nav('/reservations/new')}><Plus size={16} />New booking</Button>}
        {can('approvals.view') && <Button variant="secondary" onClick={() => nav('/approvals')}>Approvals · {k.pendingApprovals}</Button>}</div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KPI label="Today's revenue" value={money(k.todayRevenue)} sub={k.revenueVsYesterdayPct == null ? 'Payments received today' : `${k.revenueVsYesterdayPct >= 0 ? '▲' : '▼'} ${Math.abs(k.revenueVsYesterdayPct)}% vs yesterday`} tone={k.revenueVsYesterdayPct < 0 ? 'red' : 'green'} />
      <KPI label="Monthly revenue" value={compactMoney(k.monthlyRevenue)} sub="Payments received this month" tone="green" />
      <KPI label="Occupancy" value={`${k.occupancyPct}%`} sub={`${k.occupiedRooms} of ${k.totalRooms} rooms`} tone="blue" />
      <KPI label="Available rooms" value={k.availableRooms} sub={`${k.vacantClean} vacant & clean`} to="/rooms" />
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KPI label="Arrivals" value={k.arrivals} sub={`${k.arrivalsCheckedIn} checked in`} tone="blue" to="/reservations?arrivals=today" />
      <KPI label="Departures" value={k.departures} sub={`${k.departuresPendingBill} pending bill`} tone="amber" to="/reservations?departures=today" />
      <KPI label="Pending payments" value={compactMoney(k.pendingPayments)} sub={`${k.pendingPaymentGuests} guests`} tone="red" to="/bills?due=true" />
      <KPI label="Complaints" value={k.complaintsOpen} sub={`${k.complaintsNew} open`} tone="red" to="/complaints" />
      <KPI label="Pending approvals" value={k.pendingApprovals} sub="Awaiting decision" tone="amber" to="/approvals" />
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      <Card title="Room status" className="xl:col-span-1" action={<Link to="/rooms" className="text-xs font-semibold text-brand-700">Open rooms</Link>}>
        <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>{ROOM_STATUS_LIST.filter((s) => d.roomStatus[s]).map((s) => <div key={s} className={ROOM_STATUS[s].dot} style={{ width: `${(d.roomStatus[s] / total) * 100}%` }} title={`${s}: ${d.roomStatus[s]}`} />)}</div>
        <ul className="space-y-1.5">{ROOM_STATUS_LIST.filter((s) => d.roomStatus[s]).map((s) => <li key={s} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><span className={cx('h-2.5 w-2.5 rounded-sm', ROOM_STATUS[s].dot)} />{s}</span><span className="font-bold text-slate-900">{d.roomStatus[s]}</span></li>)}</ul>
      </Card>
      <Card title="Booked rooms — next 7 days" badge={<Badge tone="indigo">From reservations</Badge>} className="xl:col-span-1">
        <div className="flex h-40 items-end gap-2">{trend.map((t, i) => <div key={i} className="flex flex-1 flex-col items-center gap-1"><span className="text-[11px] font-bold text-slate-700">{t.booked}</span><div className={cx('w-full rounded-t-lg', i === 0 ? 'bg-brand-700' : 'bg-brand-300')} style={{ height: `${Math.max(4, t.occupancyPct * 1.2)}px` }} title={`${t.occupancyPct}%`} /><span className="text-[10px] text-slate-500">{fmtDay(t.date)}</span><span className="text-[10px] font-semibold text-slate-400">{dayNum(t.date)}</span></div>)}</div>
      </Card>
      <Card title="Alerts & pending approvals" badge={<Badge tone="indigo">Live</Badge>}>
        <ul className="space-y-2.5">
          {d.alerts.length === 0 && d.pendingApprovalList.length === 0 && <li className="py-6 text-center text-sm text-slate-500">Nothing needs attention.</li>}
          {d.pendingApprovalList.map((a) => <li key={a._id} className="flex items-center gap-3"><Badge tone="amber">Approval</Badge><span className="min-w-0 flex-1 truncate text-sm">{a.type} · {a.referenceLabel}</span></li>)}
          {d.alerts.slice(0, 4).map((a) => <li key={a._id} className="flex items-center gap-3"><Badge tone={SEVERITY_TONE[a.severity]}>{a.severity === 'urgent' ? 'Urgent' : a.severity === 'warning' ? 'Attention' : 'Info'}</Badge><span className="min-w-0 flex-1 truncate text-sm">{a.title}</span></li>)}
        </ul>
      </Card>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <Card title="Upcoming arrivals" pad={false} action={<Link to="/reservations" className="text-xs font-semibold text-brand-700">All reservations</Link>}>
        <Table dense rows={d.upcomingArrivals} empty={<EmptyState title="No arrivals in the next 3 days" />} onRow={(r) => nav(`/reservations/${r._id}`)} columns={[{ header: 'Guest', render: (r) => fullName(r.guest) }, { header: 'Arrives', render: (r) => fmtShort(r.checkIn) }, { header: 'Room', render: (r) => r.room?.roomNumber || 'Unassigned' }, { header: 'Status', render: (r) => <Badge tone={RES_TONE[r.status]}>{r.status}</Badge> }]} />
      </Card>
      <Card title="Recent reservations" pad={false}>
        <Table dense rows={d.recentReservations} onRow={(r) => nav(`/reservations/${r._id}`)} columns={[{ header: 'Booking', key: 'reservationNumber' }, { header: 'Guest', render: (r) => fullName(r.guest) }, { header: 'Stay', render: (r) => `${fmtShort(r.checkIn)} → ${fmtShort(r.checkOut)}` }, { header: 'Total', render: (r) => money(r.totalAmount) }]} />
      </Card>
    </div>
    {can('audit.view') && <Card title="Recent activity" className="mt-4" pad={false} action={<Link to="/audit-log" className="flex items-center gap-1 text-xs font-semibold text-brand-700">Audit log <ArrowRight size={12} /></Link>}>
      <ul className="divide-y divide-slate-100">{d.recentActivity.map((a) => <li key={a._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm"><Badge tone="slate">{a.action}</Badge><span className="font-medium">{a.userName}</span><span className="text-slate-500">{a.module} · {a.entityLabel}</span><span className="ml-auto text-xs text-slate-400">{fmtDateTime(a.timestamp)}</span></li>)}</ul>
    </Card>}
  </>);
}

function FrontOffice({ d, can, nav }) {
  const k = d.kpis;
  return (<>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Reception</h1><p className="text-sm text-slate-500">{fmtHotelDate(d.today)}</p></div>
      {can('reservations.create') && <Button onClick={() => nav('/reservations/new')}><Plus size={16} />New reservation</Button>}</div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KPI label="Arrivals today" value={k.arrivals} sub={`${k.arrivalsCheckedIn} checked in`} tone="blue" /><KPI label="Departures" value={k.departures} sub={`${k.departuresPendingBill} bill pending`} tone="amber" />
      <KPI label="Available rooms" value={k.availableRooms} sub="Ready to sell" tone="green" to="/rooms" /><KPI label="Pending check-ins" value={k.pendingCheckins} sub="Awaiting check-in" tone="blue" /><KPI label="Pending bills" value={compactMoney(k.pendingPayments)} sub={`${k.pendingPaymentGuests} guests`} tone="red" to="/bills?due=true" />
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <Card title="Today's arrivals" pad={false}><ArrivalsTable rows={d.todaysArrivals} can={can} nav={nav} /></Card>
      <Card title="Departures" pad={false}><DeparturesTable rows={d.todaysDepartures} can={can} nav={nav} /></Card>
    </div>
    <Card title="Guest journey" className="mt-4"><ol className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">{['Reservation', 'Guest', 'Room assignment', 'Check-in', 'Stay', 'Check-out'].map((s, i, a) => <li key={s} className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1">{s}</span>{i < a.length - 1 && <ArrowRight size={14} className="text-slate-300" />}</li>)}</ol></Card>
  </>);
}

export default function Dashboard() {
  const user = useAuth((s) => s.user); const can = useAuth((s) => s.can); const nav = useNavigate();
  const both = can('dashboard.owner') && can('dashboard.frontoffice');
  const [view, setView] = useState(can('dashboard.owner') ? 'overview' : 'front');
  const st = useGet('/dashboard');
  return (
    <Async state={st} isEmpty={() => false}>{(d) => (<>
      {both && <Pills className="mb-4" items={[{ key: 'overview', label: 'Overview' }, { key: 'front', label: 'Front desk' }]} value={view} onChange={setView} />}
      {view === 'overview' && can('dashboard.owner') ? <Management d={d} can={can} nav={nav} user={user} /> : <FrontOffice d={d} can={can} nav={nav} />}
    </>)}</Async>
  );
}
