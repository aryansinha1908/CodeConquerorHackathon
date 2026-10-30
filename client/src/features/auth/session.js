import { useAuthStore } from '../../stores/auth';
import { getMe, refreshToken } from './api';

// Resuming a session on page load (frontend.md §8.1 step 1), shared by RequireAuth and the public
// landing page (app/layouts/HomeLayout.jsx). One boot at a time: the cookie rotates on every refresh,
// so StrictMode's second effect run, or a second component asking, must wait on the same promise,
// not start another.
let bootPromise = null;

/** POST /auth/refresh (and GET /auth/me if it came without a user) → the store holds the session. */
export function ensureSession() {
  if (!bootPromise) {
    bootPromise = (async () => {
      // POST /auth/refresh stores { accessToken, user }.
      if (!useAuthStore.getState().accessToken) await refreshToken();
      // GET /auth/me only when the session came without a user.
      if (!useAuthStore.getState().user) {
        const res = await getMe();
        useAuthStore.getState().setUser(res.data);
      }
    })().finally(() => {
      bootPromise = null;
    });
  }
  return bootPromise;
}
