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
    if (
      err.response?.status === 401 &&
      err.response?.data?.code === 'UNAUTHENTICATED' &&
      !original._retried
    ) {
      original._retried = true;
      await doRefresh();
      return http(original);
    }
    // Normalise error shape
    const data = err.response?.data ?? {};
    const normalised = {
      status: err.response?.status ?? 0,
      code: data.code ?? 'UNKNOWN',
      message: data.message ?? err.message ?? 'Something went wrong',
      details: data.details ?? [],
      requestId: data.requestId ?? null,
    };
    return Promise.reject(normalised);
  }
);

export default http;

