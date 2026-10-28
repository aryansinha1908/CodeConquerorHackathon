import { create } from 'zustand';

/**
 * Auth store — access token lives only in memory (never localStorage).
 * The httpOnly refresh cookie is managed by the browser automatically.
 */
export const useAuthStore = create((set) => ({
  accessToken: null,
  user: null,          // result of GET /auth/me

  setSession: (accessToken, user = null) => set({ accessToken, ...(user ? { user } : {}) }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null }),
}));

