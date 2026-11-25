import { create } from 'zustand';
let id = 0;
export const useToast = create((set) => ({
  items: [],
  push: (type, message) => { const i = ++id; set((s) => ({ items: [...s.items, { id: i, type, message }] })); setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== i) })), type === 'error' ? 6000 : 3500); },
  dismiss: (i) => set((s) => ({ items: s.items.filter((t) => t.id !== i) })),
}));
export const toast = { success: (m) => useToast.getState().push('success', m), error: (m) => useToast.getState().push('error', m), info: (m) => useToast.getState().push('info', m) };
