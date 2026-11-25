import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useToast } from '../store/toast';
import { Button, Field, Textarea, cx } from './ui';

function useLock(open) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const esc = (e) => e.key === 'Escape' && document.dispatchEvent(new CustomEvent('hms:esc'));
    document.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { /* noop */ }, []);
}
function useEsc(open, onClose) {
  useEffect(() => { if (!open) return undefined; const h = () => onClose(); document.addEventListener('hms:esc', h); return () => document.removeEventListener('hms:esc', h); }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useLock(open); useEsc(open, onClose);
  if (!open) return null;
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', w)}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 sm:rounded-b-2xl" style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}>{footer}</footer>}
      </div>
    </div>, document.body);
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-md' }) {
  useLock(open); useEsc(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/40 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={title} className={cx('anim-slide absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-pop', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4" style={{ paddingTop: 'max(1rem, var(--safe-top))' }}>
          <div className="min-w-0"><h3 className="truncate text-lg font-bold text-slate-900">{title}</h3>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3" style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}>{footer}</footer>}
      </aside>
    </div>, document.body);
}

/** Confirmation dialog. Set `reason` to require a typed reason (block room, cancel booking, reject...). */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger, reason, reasonLabel = 'Reason', busy, error }) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);
  const missing = reason && text.trim().length < 3;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={missing} onClick={() => onConfirm(text.trim())}>{confirmLabel}</Button></>}>
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {reason && <Field label={reasonLabel} className="mt-3" required><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a short reason" autoFocus /></Field>}
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
    </Modal>
  );
}

export function Toaster() {
  const { items, dismiss } = useToast();
  const icon = { success: <CheckCircle2 size={18} className="text-green-600" />, error: <AlertTriangle size={18} className="text-red-600" />, info: <Info size={18} className="text-brand-700" /> };
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end" style={{ paddingTop: 'max(1rem, var(--safe-top))' }} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto anim-slide flex w-full max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-pop">
          <span className="mt-0.5">{icon[t.type]}</span>
          <p className="flex-1 text-sm font-medium text-slate-800">{t.message}</p>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      ))}
    </div>, document.body);
}
