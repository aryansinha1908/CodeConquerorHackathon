import http from '../../lib/http';

/** POST /auth/register */
export async function register(data) {
  const res = await http.post('/auth/register', data);
  return res.data;
}

/** POST /auth/verify-otp */
export async function verifyOtp(data) {
  const res = await http.post('/auth/verify-otp', data);
  return res.data;
}

/** POST /auth/resend-otp */
export async function resendOtp(data) {
  const res = await http.post('/auth/resend-otp', data);
  return res.data;
}

/** POST /auth/login */
export async function login(data) {
  const res = await http.post('/auth/login', data);
  return res.data;
}

/** POST /auth/logout */
export async function logout() {
  const res = await http.post('/auth/logout');
  return res.data;
}

/** POST /auth/refresh */
export async function refreshToken() {
  const res = await http.post('/auth/refresh');
  return res.data;
}

/** GET /auth/me */
export async function getMe() {
  const res = await http.get('/auth/me');
  return res.data;
}

/** GET /auth/demo-config – returns { demoMode: boolean, roles: [] } */
export async function getDemoConfig() {
  const res = await http.get('/auth/demo-config');
  return res.data;
}

/** POST /auth/demo-login */
export async function demoLogin(role) {
  const res = await http.post('/auth/demo-login', { role });
  return res.data;
}
