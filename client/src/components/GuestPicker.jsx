import { useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import api from '../services/api';
import { useDebounced } from '../hooks/useApi';
import { useAuth } from '../store/auth';
import { Avatar, Badge, Button, Input } from './ui';
import GuestForm from './GuestForm';
import { fullName, maskPhone } from '../utils/format';

/** Search an existing guest or create a new one inline. */
export default function GuestPicker({ value, onChange }) {
  const can = useAuth((s) => s.can); const [q, setQ] = useState(''); const dq = useDebounced(q); const [rows, setRows] = useState([]); const [form, setForm] = useState(false); const [loading, setLoading] = useState(false);
  useEffect(() => { if (dq.trim().length < 2) { setRows([]); return; } let live = true; setLoading(true); api.get('/guests', { params: { q: dq, limit: 6 } }).then((r) => live && setRows(r.data.data)).finally(() => live && setLoading(false)); return () => { live = false; }; }, [dq]);
  if (value) return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2"><Avatar guest={value} size={32} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{fullName(value)} <span className="font-normal text-slate-500">· {maskPhone(value.phone)}</span></p></div>
      {value.vip && <Badge tone="violet">VIP</Badge>}{value.blacklist && <Badge tone="red">Blacklisted</Badge>}<button type="button" onClick={() => onChange(null)} aria-label="Change guest" className="rounded p-1 text-slate-400 hover:bg-slate-200"><X size={16} /></button></div>);
  return (<div>
    <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone or guest ID" aria-label="Search guest" /></div>
    {dq.trim().length >= 2 && <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {rows.map((g) => <li key={g._id}><button type="button" onClick={() => onChange(g)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"><Avatar guest={g} size={30} /><span className="flex-1 text-sm"><b>{fullName(g)}</b> <span className="text-slate-500">· {maskPhone(g.phone)} · {g.guestId}</span></span>{g.vip && <Badge tone="violet">VIP</Badge>}{g.isRepeat && <Badge tone="blue">Repeat</Badge>}</button></li>)}
      {!rows.length && !loading && <li className="px-3 py-3 text-sm text-slate-500">No guest found for “{dq}”.</li>}
    </ul>}
    {can('guests.create') && <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setForm(true)}><Plus size={14} />New guest</Button>}
    {form && <GuestForm onClose={() => setForm(false)} onSaved={(g) => { setForm(false); onChange(g); }} />}
  </div>);
}
