import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiError } from '../services/api';

/** GET helper with loading / error / reload. `deps` re-fetches. Pass url=null to skip. */
export function useGet(url, params, deps = []) {
  const [state, setState] = useState({ data: null, raw: null, loading: !!url, error: null });
  const seq = useRef(0);
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.get(url, { params });
      if (n === seq.current) setState({ data: r.data.data ?? r.data, raw: r.data, loading: false, error: null });
    } catch (e) { if (n === seq.current) setState((s) => ({ ...s, loading: false, error: apiError(e) })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })) };
}

/** Run a mutation with busy state + toast-friendly error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } catch (e) { throw apiError(e); } finally { setBusy(false); }
  }, []);
  return [run, busy];
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
