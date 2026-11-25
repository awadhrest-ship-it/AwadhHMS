import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BellRing, Clock, Maximize2, Minimize2, Package, Play, CheckCircle2, UserPlus, Volume2, VolumeX, Users, Hand } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction } from '../../hooks/useApi';
import { Badge, Button, Select, Switch, Spinner, EmptyState, Pills, cx } from '../../components/ui';
import { Drawer, Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { cardState, filterCards, fmtMin, laneOf } from '../../utils/kitchenMath';
import { SubNav, STATIONS, StationBadge, TYPE_TONE, usePollGet } from './shared';

const LANES = [{ key: 'new', title: 'New', tone: 'bg-sky-600' }, { key: 'preparing', title: 'Preparing', tone: 'bg-amber-500' }, { key: 'ready', title: 'Ready', tone: 'bg-emerald-600' }];
const RING = { new: 'ring-2 ring-sky-400 border-sky-300', queued: 'border-slate-300', preparing: 'border-amber-400', ready: 'border-emerald-400', delayed: 'ring-2 ring-red-500 border-red-500', cancelled: 'border-red-200 opacity-70' };
const beep = () => { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.18, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5); o.start(); o.stop(a.currentTime + 0.5); } catch { /* sound is optional */ } };

export default function Display() {
  const can = useAuth((s) => s.can); const [station, setStation] = useState('all'); const [orderType, setOrderType] = useState('all'); const [delayedOnly, setDelayedOnly] = useState(false); const [newOnly, setNewOnly] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem('kds_sound') === '1'); const [full, setFull] = useState(false); const [avail, setAvail] = useState(false); const [assign, setAssign] = useState(null); const [now, setNow] = useState(Date.now());
  const [pollMs, setPollMs] = useState(5000); const g = usePollGet('/kitchen/board', undefined, pollMs); const b = g.data;
  useEffect(() => { if (b?.settings?.pollSeconds) setPollMs(b.settings.pollSeconds * 1000); }, [b?.settings?.pollSeconds]); const [run] = useAction(); const [busy, setBusy] = useState({});
  const skew = useRef(0); const seen = useRef(null); const root = useRef(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + skew.current), 10000); return () => clearInterval(t); }, []);
  useEffect(() => { if (b?.now) { skew.current = new Date(b.now).getTime() - Date.now(); setNow(Date.now() + skew.current); } }, [b?.now]);
  // announce tickets that were not on the screen before (first load only records what is already there - a reconnect never re-announces)
  useEffect(() => {
    if (!b) return; const keys = new Set(b.cards.filter((c) => c.status === 'Queued').map((c) => c.key));
    if (seen.current) { const fresh = [...keys].filter((k) => !seen.current.has(k)); if (fresh.length) { if (sound) beep(); toast.info(`${fresh.length} new kitchen ticket${fresh.length > 1 ? 's' : ''}`); } }
    seen.current = keys;
  }, [b, sound]);
  useEffect(() => { let lock; (async () => { try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch { /* optional */ } })(); return () => { try { lock?.release(); } catch { /* */ } }; }, []);
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else root.current?.requestFullscreen?.().catch(() => toast.error('Full screen is not available on this device')); };
  const act = useCallback(async (key, fn, okMsg) => { setBusy((x) => ({ ...x, [key]: true })); try { await run(fn); if (okMsg) toast.success(okMsg); g.reload(); } catch (e) { toast.error(e.message); g.reload(); } finally { setBusy((x) => ({ ...x, [key]: false })); } }, [run, g]);
  const move = (c, to, itemIds) => act(`${c.key}:${to}:${itemIds || ''}`, () => api.post(`/kitchen/tickets/${c.ticketId}/items/status`, itemIds ? { to, itemIds } : { to, station: c.station }));

  const cards = useMemo(() => (b ? filterCards(b.cards, { station, orderType, delayedOnly, newOnly }, now) : []), [b, station, orderType, delayedOnly, newOnly, now]);
  const by = (lane) => cards.filter((c) => laneOf(c) === lane).sort((a, c) => (cardState(c, now).delayed - cardState(a, now).delayed) || new Date(a.queuedAt) - new Date(c.queuedAt));
  const done = cards.filter((c) => laneOf(c) === 'done');
  const stationItems = ['all', ...(b?.stations || [])];

  return (
    <div ref={root} className={cx(full && 'min-h-screen overflow-auto bg-slate-100 p-4')}>
      {!full && <SubNav can={can} />}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3"><h1 className="text-2xl font-bold tracking-tight text-slate-900">Kitchen display</h1>
          {b && <div className="flex gap-1.5 text-xs font-bold"><Badge tone="blue">{b.totals.queued} new</Badge><Badge tone="amber">{b.totals.preparing} preparing</Badge><Badge tone="green">{b.totals.ready} ready</Badge>{b.totals.delayed > 0 && <Badge tone="red">{b.totals.delayed} delayed</Badge>}</div>}
          {g.error && b && <Badge tone="red">Connection problem - showing last update</Badge>}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => { const v = !sound; setSound(v); localStorage.setItem('kds_sound', v ? '1' : '0'); if (v) beep(); }} aria-pressed={sound}>{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}{sound ? 'Sound on' : 'Sound off'}</Button>
          <Button variant="secondary" size="sm" onClick={() => setAvail(true)}><Package size={15} />Availability{b?.unavailable?.length ? <Badge tone="red">{b.unavailable.length}</Badge> : null}</Button>
          <Button variant="secondary" size="sm" onClick={toggleFull}>{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{full ? 'Exit' : 'Full screen'}</Button>
        </div>
      </div>
      <div className="mb-3 flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 lg:flex-row lg:items-center lg:justify-between">
        <Pills items={stationItems.map((s) => ({ key: s, label: s === 'all' ? 'All stations' : `${s}${b?.counts?.[s] ? ` (${b.counts[s].Queued + b.counts[s].Preparing + b.counts[s].Ready})` : ''}` }))} value={station} onChange={setStation} />
        <div className="flex flex-wrap items-center gap-3">
          <Select aria-label="Order type" className="!w-auto !py-1.5" value={orderType} onChange={(e) => setOrderType(e.target.value)}><option value="all">All order types</option>{['Dine-in', 'Takeaway', 'Delivery', 'Room Service'].map((t) => <option key={t}>{t}</option>)}</Select>
          <Switch checked={delayedOnly} onChange={setDelayedOnly} label="Delayed only" /><Switch checked={newOnly} onChange={setNewOnly} label="New only" />
        </div>
      </div>
      {b?.unassignedMenuItems > 0 && b.scope.unassigned && <div className="mb-3 flex items-start gap-2 rounded-lg bg-violet-50 p-3 text-sm text-violet-900 ring-1 ring-violet-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><b>{b.unassignedMenuItems} menu item{b.unassignedMenuItems > 1 ? 's have' : ' has'} no kitchen station.</b> Their tickets show under “Unassigned” so nothing is lost - assign stations in Kitchen → Settings.</span></div>}
      {!b && g.loading && <div className="flex justify-center py-20"><Spinner size={28} /></div>}
      {!b && g.error && <EmptyState icon={AlertTriangle} title={g.error.message} text="The kitchen display needs a connection. It will keep retrying." action={<Button onClick={g.reload}>Retry now</Button>} />}
      {b && (
        <div className="grid gap-3 lg:grid-cols-3">
          {LANES.map((ln) => { const list = by(ln.key); return (
            <section key={ln.key} aria-label={ln.title} className="min-w-0 rounded-xl bg-slate-200/60 p-2">
              <h2 className={cx('mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-extrabold uppercase tracking-wide text-white', ln.tone)}>{ln.title}<span className="rounded-full bg-white/25 px-2 text-xs">{list.length}</span></h2>
              <div className="space-y-2.5">
                {list.map((c) => <TicketCard key={c.key} c={c} now={now} busy={busy} can={can} scope={b.scope} onMove={move} onAssign={() => setAssign(c)} onClaim={() => act(`${c.key}:claim`, () => api.post(`/kitchen/tickets/${c.ticketId}/claim`, { station: c.station }), 'Ticket claimed')}
                  onRoute={(itemId, st) => act(`${c.key}:route`, () => api.patch(`/kitchen/tickets/${c.ticketId}/items/${itemId}/station`, { station: st }), `Sent to ${st}`)} />)}
                {!list.length && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs font-semibold text-slate-400">{ln.key === 'new' ? 'No new tickets' : ln.key === 'preparing' ? 'Nothing being prepared' : 'Nothing waiting for service'}</p>}
              </div>
            </section>); })}
        </div>
      )}
      {done.length > 0 && <details className="mt-4 rounded-xl bg-white p-3 ring-1 ring-slate-200"><summary className="cursor-pointer text-sm font-bold text-slate-700">Recently served or cancelled ({done.length})</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{done.map((c) => <div key={c.key} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex items-center justify-between"><b>{c.orderNumber}</b><Badge tone={c.status === 'Cancelled' ? 'red' : 'indigo'}>{c.status}</Badge></div><div className="mt-1 text-xs text-slate-500"><StationBadge station={c.station} /> {c.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div></div>)}</div></details>}
      <AvailabilityDrawer open={avail} onClose={() => setAvail(false)} can={can} unavailable={b?.unavailable || []} onChanged={g.reload} />
      <AssignModal card={assign} onClose={() => setAssign(null)} onDone={g.reload} />
    </div>
  );
}

function TicketCard({ c, now, busy, can, scope, onMove, onAssign, onClaim, onRoute }) {
  const st = cardState(c, now); const live = c.items.filter((i) => !i.cancelled); const mayUpdate = can('kitchen.update'); const mayRoute = can('kitchen.stations'); const where = c.tableNumber ? `Table ${c.tableNumber}` : c.roomNumber ? `Room ${c.roomNumber}` : c.customerName || '';
  const start = live.some((i) => i.status === 'Queued'); const ready = live.some((i) => i.status === 'Preparing'); const bs = (k) => busy[`${c.key}:${k}`];
  return (
    <article className={cx('rounded-xl border-2 bg-white p-3 shadow-sm', RING[st.key], st.key === 'delayed' && 'animate-pulse-slow')} aria-label={`Ticket ${c.orderNumber} ${c.station}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xl font-extrabold leading-none text-slate-900">{c.orderNumber}</span>{c.round > 1 && <Badge tone="slate">Round {c.round}</Badge>}{c.isNew && <Badge tone="blue"><BellRing size={11} className="mr-0.5 inline" />NEW</Badge>}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge tone={TYPE_TONE[c.orderType]}>{c.orderType}</Badge>{where && <span className="text-sm font-bold text-slate-700">{where}</span>}<StationBadge station={c.station} />{c.hasMultipleStations && <span className="text-[10px] font-semibold text-slate-400">shared order</span>}</div></div>
        <div className="shrink-0 text-right"><div className={cx('flex items-center justify-end gap-1 text-lg font-extrabold tabular-nums', st.delayed ? 'text-red-600' : 'text-slate-800')}><Clock size={16} />{fmtMin(st.elapsed)}</div>
          <div className="text-[11px] font-semibold text-slate-500">limit {c.thresholdMinutes} min</div></div>
      </header>
      {st.delayed && <p className="mt-2 flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-xs font-extrabold uppercase text-white"><AlertTriangle size={13} />Delayed by {fmtMin(st.over)}{c.alerted ? ' · alert sent' : ''}</p>}
      {c.status === 'Ready' && c.lateWhenFinished && <p className="mt-2 text-[11px] font-semibold text-amber-700">Took longer than the limit.</p>}
      <ul className="mt-2.5 divide-y divide-slate-100">
        {c.items.map((i) => (
          <li key={i._id} className={cx('flex items-start gap-2 py-1.5', i.cancelled && 'opacity-60')}>
            <span className={cx('mt-0.5 min-w-[2rem] rounded-md px-1.5 text-center text-lg font-extrabold leading-tight', i.cancelled ? 'bg-red-100 text-red-700 line-through' : 'bg-slate-900 text-white')}>{i.quantity}</span>
            <div className="min-w-0 flex-1"><p className={cx('break-words text-base font-bold leading-snug text-slate-900', i.cancelled && 'line-through')}>{i.name}{i.cancelled && <span className="ml-2 text-xs font-bold text-red-600 no-underline">CANCELLED</span>}</p>
              {i.notes && <p className="mt-0.5 break-words rounded bg-amber-100 px-1.5 py-0.5 text-sm font-semibold text-amber-900">⚠ {i.notes}</p>}
              {live.length > 1 && !i.cancelled && <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{i.status}{i.readyByName ? ` · ${i.readyByName}` : i.startedByName ? ` · ${i.startedByName}` : ''}</p>}</div>
            {!i.cancelled && live.length > 1 && mayUpdate && (i.status === 'Queued' || i.status === 'Preparing') && <Button size="sm" variant="secondary" loading={bs(`${i.status === 'Queued' ? 'Preparing' : 'Ready'}:${i._id}`)} aria-label={i.status === 'Queued' ? `Start ${i.name}` : `${i.name} ready`} onClick={() => onMove(c, i.status === 'Queued' ? 'Preparing' : 'Ready', [i._id])}>{i.status === 'Queued' ? <Play size={14} /> : <CheckCircle2 size={14} />}</Button>}
            {!i.cancelled && mayRoute && c.station === 'Unassigned' && (i.status === 'Queued' || i.status === 'Preparing') && <Select aria-label={`Send ${i.name} to a station`} className="!w-28 !py-1 !text-xs" value="" onChange={(e) => e.target.value && onRoute(i._id, e.target.value)}><option value="">Route to…</option>{STATIONS.map((s) => <option key={s}>{s}</option>)}</Select>}
          </li>))}
      </ul>
      {c.orderNotes && <p className="mt-2 break-words rounded-md bg-sky-50 px-2 py-1 text-sm font-semibold text-sky-900">Order note: {c.orderNotes}</p>}
      {c.assignees.length > 0 && <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-500"><Users size={12} />{c.assignees.map((a) => a.name).join(', ')}</p>}
      <footer className="mt-3 flex flex-wrap gap-2">
        {mayUpdate && start && <Button className="flex-1" loading={bs('Preparing:')} onClick={() => onMove(c, 'Preparing')}><Play size={16} />Start{live.some((i) => i.status === 'Preparing') ? ' remaining' : ''}</Button>}
        {mayUpdate && ready && <Button className="flex-1 !bg-emerald-600 hover:!bg-emerald-700" loading={bs('Ready:')} onClick={() => onMove(c, 'Ready')}><CheckCircle2 size={16} />Mark ready</Button>}
        {c.status === 'Ready' && <p className="flex-1 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-bold text-emerald-800">Ready - waiting for service</p>}
        {mayUpdate && (c.status === 'Queued' || c.status === 'Preparing') && <Button variant="secondary" size="sm" onClick={onClaim} aria-label="Claim this ticket"><Hand size={14} /></Button>}
        {can('kitchen.assign') && (c.status === 'Queued' || c.status === 'Preparing') && <Button variant="secondary" size="sm" onClick={onAssign} aria-label="Assign this ticket"><UserPlus size={14} /></Button>}
      </footer>
    </article>
  );
}

function AssignModal({ card, onClose, onDone }) {
  const [staff, setStaff] = useState(null); const [uid, setUid] = useState(''); const [run, busy] = useAction();
  useEffect(() => { if (card) { setUid(''); api.get('/kitchen/staff').then((r) => setStaff(r.data.data)).catch(() => setStaff([])); } }, [card]);
  if (!card) return null;
  return (
    <Modal open onClose={onClose} title={`Assign ${card.orderNumber} - ${card.station}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!uid} loading={busy} onClick={async () => { try { await run(() => api.post(`/kitchen/tickets/${card.ticketId}/assign`, { userId: uid, station: card.station === 'Unassigned' ? undefined : card.station })); toast.success('Assigned'); onDone(); onClose(); } catch (e) { toast.error(e.message); } }}>Assign</Button></>}>
      {!staff ? <div className="flex justify-center py-6"><Spinner /></div> : <><p className="mb-2 text-sm text-slate-500">Assigned staff are credited with this station's work in chef performance.</p>
        <Select aria-label="Staff member" value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Choose staff…</option>{staff.map((s) => <option key={s._id} value={s._id}>{s.name} - {s.role}</option>)}</Select></>}
      {card.assignees.length > 0 && <div className="mt-3 space-y-1">{card.assignees.map((a) => <div key={a.user} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-sm"><span>{a.name} <span className="text-xs text-slate-400">({a.kind})</span></span><Button size="sm" variant="ghost" onClick={async () => { try { await run(() => api.post(`/kitchen/tickets/${card.ticketId}/unassign`, { userId: a.user, station: a.station })); toast.success('Removed'); onDone(); onClose(); } catch (e) { toast.error(e.message); } }}>Remove</Button></div>)}</div>}
    </Modal>
  );
}

/** Menu availability - the SAME flag the restaurant POS uses (Phase 6); nothing here can contradict it. */
function AvailabilityDrawer({ open, onClose, can, unavailable, onChanged }) {
  const [items, setItems] = useState(null); const [q, setQ] = useState(''); const [run] = useAction(); const mayEdit = can('restaurant.availability') || can('restaurant.menu');
  const load = useCallback(() => api.get('/kitchen/menu', { params: { q: q || undefined } }).then((r) => setItems(r.data.data)).catch(() => setItems([])), [q]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const toggle = async (i, available) => { let reason; if (!available) reason = window.prompt(`Why is ${i.name} unavailable? (optional)`) || undefined; try { await run(() => api.patch(`/restaurant/menu/items/${i._id}/availability`, { available, reason })); toast.success(`${i.name} ${available ? 'is available again' : 'marked unavailable'}`); load(); onChanged(); } catch (e) { toast.error(e.message); } };
  return (
    <Drawer open={open} onClose={onClose} title="Item availability" subtitle={`${unavailable.length} unavailable now - the POS stops selling these immediately`}>
      <input className="input mb-3" placeholder="Search menu…" aria-label="Search menu" value={q} onChange={(e) => setQ(e.target.value)} />
      {!items ? <div className="flex justify-center py-8"><Spinner /></div> : <ul className="divide-y divide-slate-100">{[...items].sort((a, b) => (a.available - b.available) || a.name.localeCompare(b.name)).map((i) => (
        <li key={i._id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className={cx('truncate text-sm font-semibold', !i.available && 'text-red-700')}>{i.name}</p>{!i.available && <p className="text-xs text-red-600">{i.unavailableReason || 'Unavailable'}</p>}<StationBadge station={i.station} /></div>
          {mayEdit ? <Switch checked={i.available} onChange={(v) => toggle(i, v)} label={i.available ? 'Available' : 'Unavailable'} /> : <Badge tone={i.available ? 'green' : 'red'}>{i.available ? 'Available' : 'Unavailable'}</Badge>}</li>))}</ul>}
    </Drawer>
  );
}
