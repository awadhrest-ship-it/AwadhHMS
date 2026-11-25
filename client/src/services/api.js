import axios from 'axios';

const api = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || ''}/api`, timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('hms_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use((r) => r, (err) => {
  if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
    localStorage.removeItem('hms_token');
    if (!location.pathname.startsWith('/login')) location.assign('/login?expired=1'); // unauthorised handling
  }
  return Promise.reject(err);
});

/** Turn any axios error into { message, fields } for friendly UI feedback. */
export function apiError(err) {
  if (!err.response) return { message: err.code === 'ECONNABORTED' ? 'The server took too long to respond. Please retry.' : 'Cannot reach the server. Check your connection and retry.', fields: {}, status: 0 };
  const d = err.response.data || {};
  const fields = {};
  (Array.isArray(d.details) ? d.details : []).forEach((x) => x?.field && (fields[x.field] = x.message));
  return { message: d.message || 'Something went wrong', fields, status: err.response.status, details: d.details };
}
export default api;
