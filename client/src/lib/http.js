import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const http = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // httpOnly refresh cookie
});

// ── Request interceptor: attach Bearer token ──────────────────────────────────
http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Single-flight refresh ─────────────────────────────────────────────────────
let refreshPromise = null;

async function doRefresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = http
    .post('/auth/refresh')
    .then((res) => {
      useAuthStore.getState().setSession(res.data.data.accessToken);
      return res.data.data.accessToken;
    })
    .catch((err) => {
      useAuthStore.getState().clear();
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

// ── Response interceptor: handle 401 → refresh once ──────────────────────────
http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    // Error envelope (architecture.md §6): { success: false, error: { code, message, details }, requestId }.
    // The mock auth routes still answer { error: "text" }, so a string error is read as the message.
    const data = err.response?.data ?? {};
    const error = data.error && typeof data.error === 'object' ? data.error : {};
    if (
      err.response?.status === 401 &&
      error.code === 'UNAUTHENTICATED' &&
      !original._retried
    ) {
      original._retried = true;
      await doRefresh();
      return http(original);
    }
    // Normalise error shape
    const normalised = {
      status: err.response?.status ?? 0,
      code: error.code ?? 'UNKNOWN',
      message:
        error.message ??
        (typeof data.error === 'string' ? data.error : undefined) ??
        err.message ??
        'Something went wrong',
      details: error.details ?? [],
      requestId: data.requestId ?? null,
    };
    return Promise.reject(normalised);
  }
);

export default http;

