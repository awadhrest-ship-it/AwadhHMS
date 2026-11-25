import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { TONES, ROOM_STATUS } from '../utils/constants';
import { initials } from '../utils/format';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function Badge({ tone = 'slate', children, className }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TONES[tone] || TONES.slate, className)}>{children}</span>;
}
export const TBC = ({ children = 'TBC' }) => <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800" title="To be confirmed with the client">{children}</span>;

export function RoomStatusBadge({ status }) {
  const s = ROOM_STATUS[status]; if (!s) return <Badge>{status}</Badge>;
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full border-l-4 px-2.5 py-0.5 text-[11px] font-semibold', s.tile)}>{status}</span>;
}

export const Button = forwardRef(function Button({ variant = 'primary', size, className, children, loading, ...p }, ref) {
  return <button ref={ref} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} disabled={p.disabled || loading} {...p}>{loading && <Spinner size={14} />}{children}</button>;
});

export function Spinner({ size = 18, className }) {
  return <svg className={cx('animate-spin text-current', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity=".25" /><path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

export function Field({ label, error, hint, children, className, required }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}{required && <span className="text-red-500"> *</span>}</label>}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
export const Input = forwardRef(function Input({ error, className, ...p }, ref) { return <input ref={ref} className={cx('input', error && 'input-error', className)} {...p} />; });
export const Select = forwardRef(function Select({ error, className, children, ...p }, ref) { return <select ref={ref} className={cx('input pr-8', error && 'input-error', className)} {...p}>{children}</select>; });
export const Textarea = forwardRef(function Textarea({ error, className, ...p }, ref) { return <textarea ref={ref} rows={3} className={cx('input', error && 'input-error', className)} {...p} />; });

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className={cx('flex items-center gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-700' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </label>
  );
}

export function Avatar({ guest, name, size = 36, className }) {
  const text = name ? name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() : initials(guest);
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-bold text-white', className)} style={{ width: size, height: size, fontSize: size * 0.36 }}>{text}</span>;
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className, pad = true, badge }) {
  return (
    <section className={cx('card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <div className="flex items-center gap-2">{badge}{action}</div>
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone = 'slate', big, to }) {
  const subTone = { green: 'text-green-600', red: 'text-red-600', amber: 'text-amber-600', blue: 'text-brand-700', slate: 'text-slate-500' }[tone];
  const body = (
    <div className={cx('card h-full p-4 transition', to && 'hover:border-brand-300 hover:shadow-md')}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx('mt-1 font-extrabold tracking-tight text-slate-900', big ? 'text-3xl' : 'text-2xl')}>{value}</p>
      {sub != null && <p className={cx('mt-1 text-xs font-semibold', subTone)}>{sub}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Pills({ items, value, onChange, className }) {
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)} role="tablist">
      {items.map((it) => {
        const k = typeof it === 'string' ? it : it.key; const l = typeof it === 'string' ? it : it.label;
        return <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={cx('rounded-full px-3.5 py-1.5 text-xs font-semibold transition', value === k ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{l}</button>;
      })}
    </div>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {items.map((it) => (
        <button key={it.key} role="tab" aria-selected={value === it.key} onClick={() => onChange(it.key)} className={cx('whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition', value === it.key ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {it.label}{it.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon size={22} /></span>}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center" role="alert">
      <p className="text-sm font-semibold text-red-700">{error?.message || 'Something went wrong'}</p>
      <p className="mt-1 text-xs text-slate-500">{error?.status === 403 ? 'Your role does not have access to this.' : 'Check your connection and try again.'}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
export const Loading = ({ label = 'Loading…' }) => <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Spinner />{label}</div>;

/** Wrap async data: loading → error → empty → content. */
export function Async({ state, empty, children, isEmpty }) {
  if (state.loading && state.data == null) return <Loading />;
  if (state.error && state.data == null) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data != null && (isEmpty ? isEmpty(state.data) : Array.isArray(state.data) && !state.data.length)) return empty || null;
  if (state.data == null) return null;
  return children(state.data);
}

export function Table({ columns, rows, rowKey = '_id', onRow, empty, dense }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead><tr>{columns.map((c) => <th key={c.key || c.header} className={cx('th', c.className)}>{c.header}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={r[rowKey] || i} onClick={onRow ? () => onRow(r) : undefined} className={cx(onRow && 'cursor-pointer hover:bg-slate-50')}>
              {columns.map((c) => <td key={c.key || c.header} className={cx('td', dense && '!py-2', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && empty}
    </div>
  );
}
