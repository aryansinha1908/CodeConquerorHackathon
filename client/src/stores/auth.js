import { create } from 'zustand';

/**
 * Auth store — access token lives only in memory (never localStorage, frontend.md §8.1).
 * The httpOnly refresh cookie is managed by the browser automatically.
 *
 * `user` is the server's user view: { _id, name, email, roles, memberType, department,
 * managedOrgUnits, emailVerified, verification: { status, reason, submittedAt }, strikes,
 * suspendedUntil, suspensionReason, emailHints }.
 */
export const useAuthStore = create((set) => ({
  accessToken: null,
  user: null,

  // Every session response (login, verify-otp, refresh, demo-login) carries both; a token-only
  // call keeps the user already loaded.
  setSession: (accessToken, user = null) => set(user ? { accessToken, user } : { accessToken }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null }),
}));
