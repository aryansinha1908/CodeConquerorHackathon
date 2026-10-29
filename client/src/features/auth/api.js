import http, { refreshSession } from '../../lib/http';

// Every function resolves with the success envelope { success, data, requestId } and rejects with
// the normalised error from lib/http.js: { status, code, message, details, retryAfter, requestId }.

/** POST /auth/register → data { email, otpSent } */
export async function register(data) {
  const res = await http.post('/auth/register', data);
  return res.data;
}

/** POST /auth/verify-otp → data { accessToken, user } */
export async function verifyOtp(data) {
  const res = await http.post('/auth/verify-otp', data);
  return res.data;
}

/** POST /auth/resend-otp → data { sent, retryAfter } */
export async function resendOtp(data) {
  const res = await http.post('/auth/resend-otp', data);
  return res.data;
}

/** POST /auth/login → data { accessToken, user } */
export async function login(data) {
  const res = await http.post('/auth/login', data);
  return res.data;
}

/** POST /auth/forgot-password → data { sent } */
export async function requestPasswordReset(data) {
  const res = await http.post('/auth/forgot-password', data);
  return res.data;
}

/** POST /auth/reset-password → data { reset } */
export async function resetPassword(data) {
  const res = await http.post('/auth/reset-password', data);
  return res.data;
}

/** POST /auth/logout → data { loggedOut } (always 200; the cookie is enough) */
export async function logout() {
  const res = await http.post('/auth/logout');
  return res.data;
}

/**
 * POST /auth/refresh → data { accessToken, user }, already stored. Single-flight: the cookie
 * rotates on every refresh, so a second parallel call would look like token reuse to the server.
 */
export function refreshToken() {
  return refreshSession();
}

/** GET /auth/me → data = user view */
export async function getMe() {
  const res = await http.get('/auth/me');
  return res.data;
}

/** GET /auth/demo-config → data { demoMode, roles } */
export async function getDemoConfig() {
  const res = await http.get('/auth/demo-config');
  return res.data;
}

/** POST /auth/demo-login → data { accessToken, user } */
export async function demoLogin(role) {
  const res = await http.post('/auth/demo-login', { role });
  return res.data;
}
