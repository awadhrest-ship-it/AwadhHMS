import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Landmark } from 'lucide-react';
import { useAuth } from '../store/auth';
import { Button, Field, Input } from '../components/ui';

const DEMO = [['Owner', 'owner@awadhpalace.test'], ['General Manager', 'gm@awadhpalace.test'], ['Front Office Manager', 'fom@awadhpalace.test'], ['Receptionist', 'reception@awadhpalace.test'], ['Accounts', 'accounts@awadhpalace.test'], ['Housekeeping Mgr', 'housekeeping@awadhpalace.test']];

export default function Login() {
  const login = useAuth((s) => s.login); const [sp] = useSearchParams();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [show, setShow] = useState(false); const [err, setErr] = useState(sp.get('expired') ? 'Your session expired. Please sign in again.' : ''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { await login(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <div><p className="text-xl font-extrabold tracking-[0.2em]">AWADH PALACE</p><p className="mt-1 text-sm text-slate-400">Hotel Management System</p></div>
        <div className="max-w-md"><Landmark size={40} className="mb-6 text-brand-300" /><h1 className="text-4xl font-extrabold leading-tight">Rooms, guests and the front desk — in one place.</h1><p className="mt-4 text-slate-400">Every action is linked to a person. Every change leaves a trail.</p></div>
        <p className="text-xs text-slate-500">Phases 1–3 · Core & Access · Rooms & Pricing · Guests, Reservations & Front Desk</p>
      </div>
      <div className="flex items-center justify-center p-6" style={{ paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}>
        <div className="w-full max-w-sm">
          <p className="mb-8 text-lg font-extrabold tracking-[0.15em] text-brand-800 lg:hidden">AWADH PALACE</p>
          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2><p className="mt-1 text-sm text-slate-500">Use your own staff account.</p>
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@awadhpalace.test" autoFocus required /></Field>
            <Field label="Password"><div className="relative"><Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" required />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
            <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>Sign in</Button>
          </form>
          {import.meta.env.DEV && <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4"><p className="text-xs font-semibold text-slate-500">Demo accounts · password <code className="rounded bg-slate-100 px-1">Awadh@123</code></p>
            <div className="mt-2 flex flex-wrap gap-1.5">{DEMO.map(([l, e]) => <button key={e} type="button" onClick={() => { setEmail(e); setPassword('Awadh@123'); }} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-brand-100 hover:text-brand-700">{l}</button>)}</div></div>}
        </div>
      </div>
    </div>
  );
}
