import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const http = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // httpOnly refresh cookie
});

// Pages where a failed refresh must not bounce the user again (they are the way back in).
const PUBLIC_AUTH_PATHS = ['/login', '/register', '/verify-otp'];

// /auth/* calls answer for themselves: a 401 from /auth/refresh must not wait on another refresh,
// and INVALID_CREDENTIALS / EMAIL_NOT_VERIFIED belong to the form that sent them.
function isAuthRequest(config) {
  return /^(?:\/api\/v1)?\/auth\//.test(config?.url ?? '');
}

// ── Request interceptor: attach Bearer token ──────────────────────────────────
http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Single-flight refresh (frontend.md §8.1) ──────────────────────────────────
// Every refresh rotates the cookie and the server treats a second use of the old one as token
// reuse (it revokes every session), so parallel 401s, the RequireAuth boot and React StrictMode's
// double effects must all share one request.
let refreshPromise = null;

// refreshPromise is per tab, but the cookie jar is shared by every tab of the origin. A Web Lock
// serialises refreshes across tabs, so a tab that waits sends the cookie the previous holder just
// rotated instead of replaying the old one. Without Web Locks (an insecure origin) it posts directly.
const REFRESH_LOCK = 'campuscommons-auth-refresh';

function postRefresh() {
  const send = () => http.post('/auth/refresh');
  const locks = globalThis.navigator?.locks;
  return typeof locks?.request === 'function' ? locks.request(REFRESH_LOCK, send) : send();
}

/**
 * POST /auth/refresh once for everyone waiting, store { accessToken, user } and resolve with the
 * envelope. A 401 means the session is over, so the store is cleared. Anything else (503 while
 * Redis is down, a network error) leaves the cookie usable for a retry, so the store is kept. The
 * normalised error is rethrown either way; redirecting is left to the caller.
 */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = postRefresh()
      .then((res) => {
        const { accessToken, user } = res.data.data;
        useAuthStore.getState().setSession(accessToken, user);
        return res.data;
      })
      .catch((err) => {
        if (err?.status === 401) useAuthStore.getState().clear();
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function redirectToLogin() {
  const { pathname, search } = window.location;
  if (PUBLIC_AUTH_PATHS.includes(pathname)) return;
  window.location.replace('/login?next=' + encodeURIComponent(pathname + search));
}

// Seconds to wait after a 429: the rate limiter's details.retryAfterSeconds, else Retry-After
// (delta-seconds or an HTTP date).
function readRetryAfter(details, headers) {
  const fromBody = Number(details?.retryAfterSeconds);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
  const header = headers?.['retry-after'];
  if (header == null || header === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// Error envelope (architecture.md §6): { success: false, error: { code, message, details }, requestId }
// → { status, code, message, details, retryAfter, requestId } (frontend.md §8.3).
function normalise(err) {
  const res = err.response;
  const data = res?.data && typeof res.data === 'object' ? res.data : {};
  const error = data.error && typeof data.error === 'object' ? data.error : {};
  const details = error.details ?? [];
  return {
    status: res?.status ?? 0,
    code: error.code ?? 'UNKNOWN',
    message: error.message ?? err.message ?? 'Something went wrong',
    details,
    retryAfter: readRetryAfter(details, res?.headers),
    requestId: data.requestId ?? res?.headers?.['x-request-id'] ?? null,
  };
}

// ── Response interceptor: handle 401 → refresh once, retry once ──────────────
http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const normalised = normalise(err);
    if (
      normalised.status !== 401 ||
      normalised.code !== 'UNAUTHENTICATED' ||
      !original ||
      original._retried ||
      isAuthRequest(original)
    ) {
      return Promise.reject(normalised);
    }

    original._retried = true;
    // A parallel request may already have refreshed: retry with the new token instead of rotating again.
    const current = useAuthStore.getState().accessToken;
    if (!current || original.headers?.Authorization === `Bearer ${current}`) {
      try {
        await refreshSession();
      } catch (refreshErr) {
        // Only a 401 ends the session. A 503 or a network error is passed on as it is, so the
        // caller shows "try again" and the next request retries the refresh.
        if (refreshErr?.status !== 401) return Promise.reject(refreshErr);
        redirectToLogin();
        return Promise.reject(normalised);
      }
    }
    return http(original);
  }
);

export default http;
