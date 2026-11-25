import { useEffect, useRef, useState } from 'react';
import { Camera, ImageOff, Loader2 } from 'lucide-react';
import api, { apiError } from '../services/api';
import { Modal } from './feedback';
import { cx } from './ui';

/** Photos are served by the authenticated /api/files/:id endpoint, so <img src> cannot be used; fetch as a blob with the JWT. */
const cache = new Map();
export function AuthImage({ id, alt = 'Photo', className, zoom = true }) {
  const [src, setSrc] = useState(cache.get(id) || null);
  const [state, setState] = useState(cache.has(id) ? 'ok' : 'loading');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!id || cache.has(id)) return undefined;
    let dead = false;
    api.get(`/files/${id}`, { responseType: 'blob' }).then((r) => { if (dead) return; const u = URL.createObjectURL(r.data); cache.set(id, u); setSrc(u); setState('ok'); }).catch(() => !dead && setState('error'));
    return () => { dead = true; };
  }, [id]);
  if (state === 'loading') return <div className={cx('flex items-center justify-center bg-slate-100 text-slate-400', className)}><Loader2 className="animate-spin" size={18} /></div>;
  if (state === 'error') return <div className={cx('flex flex-col items-center justify-center gap-1 bg-slate-100 text-[11px] text-slate-400', className)} role="img" aria-label="Photo unavailable"><ImageOff size={18} />Unavailable</div>;
  return (
    <>
      <button type="button" disabled={!zoom} onClick={() => setOpen(true)} className={cx('block overflow-hidden', className)} aria-label={`Open ${alt}`}><img src={src} alt={alt} className="h-full w-full object-cover" /></button>
      {zoom && <Modal open={open} onClose={() => setOpen(false)} title={alt} size="lg"><img src={src} alt={alt} className="mx-auto max-h-[70vh] rounded-lg" /></Modal>}
    </>
  );
}

/** Downscale a camera photo before upload (phones take 4-12 MB pictures; 1600 px JPEG is plenty for evidence and loads fast on site Wi-Fi). */
export async function shrinkImage(file, max = 1600, quality = 0.82) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;            // gifs and unknown types are sent unchanged and validated by the server
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

/** Raw-body photo upload: POST <url> with the image bytes and an image Content-Type (see server/services/storage.js). */
export async function uploadPhoto(url, blob, params) {
  const r = await api.post(url, blob, { params, headers: { 'Content-Type': blob.type || 'image/jpeg' }, timeout: 60000 });
  return r.data.data ?? r.data;
}

/** Camera / gallery button. onPick(blob) must return a promise; errors are shown inline. */
export function PhotoPicker({ onPick, label = 'Add photo', disabled, className, capture = true }) {
  const ref = useRef(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const change = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setErr(''); setBusy(true);
    try { await onPick(await shrinkImage(f)); } catch (x) { setErr(x?.message || apiError(x).message); } finally { setBusy(false); }
  };
  return (
    <div className={className}>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" {...(capture ? { capture: 'environment' } : {})} className="hidden" onChange={change} />
      <button type="button" disabled={disabled || busy} onClick={() => ref.current?.click()} className="btn-secondary w-full justify-center gap-2 sm:w-auto">
        {busy ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}{busy ? 'Uploading…' : label}
      </button>
      {err && <p role="alert" className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
