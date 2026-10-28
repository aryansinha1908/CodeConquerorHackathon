import { create } from 'zustand';

const STORAGE_KEY = 'cc_auth_session';

const getInitialSession = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return { accessToken: null, user: null };
};

const initial = getInitialSession();

/**
 * Auth store with session storage persistence so page refreshes and direct URL
 * navigations retain role credentials without network failures.
 */
export const useAuthStore = create((set) => ({
  accessToken: initial.accessToken,
  user: initial.user, // result of GET /auth/me or demo user

  setSession: (accessToken, user = null) => {
    set((state) => {
      const updatedUser = user !== null ? user : state.user;
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ accessToken, user: updatedUser })
        );
      } catch (e) {
        // ignore
      }
      return { accessToken, user: updatedUser };
    });
  },

  setUser: (user) => {
    set((state) => {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ accessToken: state.accessToken, user })
        );
      } catch (e) {
        // ignore
      }
      return { user };
    });
  },

  clear: () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    set({ accessToken: null, user: null });
  },
}));
