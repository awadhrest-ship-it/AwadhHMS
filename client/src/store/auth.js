import { create } from 'zustand';
import api, { apiError } from '../services/api';

export const useAuth = create((set, get) => ({
  user: null,
  loading: !!localStorage.getItem('hms_token'),
  async init() {
    if (!localStorage.getItem('hms_token')) return set({ loading: false });
    try { const { data } = await api.get('/auth/me'); set({ user: data.user, loading: false }); }
    catch { localStorage.removeItem('hms_token'); set({ user: null, loading: false }); }
  },
  async login(email, password) {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('hms_token', data.token); set({ user: data.user });
    } catch (e) { throw apiError(e); }
  },
  async logout() {
    try { await api.post('/auth/logout'); } catch { /* token may already be invalid */ }
    localStorage.removeItem('hms_token'); set({ user: null });
  },
  can: (perm) => !!get().user?.permissions?.includes(perm),
  canAny: (...perms) => perms.some((p) => get().user?.permissions?.includes(p)),
}));
// selector hook that re-renders when the user changes
export const useCan = () => { const user = useAuth((s) => s.user); return (...p) => p.some((x) => user?.permissions?.includes(x)); };
