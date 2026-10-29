// Regression tests for the client's session handling (lib/http.js, lib/schemas/auth.js,
// features/verification/api.js). Run with `npm test` (node:test, no extra dependencies).
//
// Each "tab" is its own Vite SSR module graph, so it gets its own http.js and auth store, the way two
// browser tabs do. They share one fake server and one cookie jar, the way tabs of one origin do.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AxiosError } from 'axios';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const servers = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

async function openTab() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  servers.push(server);
  const load = (path) => server.ssrLoadModule(path);
  const httpModule = await load('/src/lib/http.js');
  const { useAuthStore } = await load('/src/stores/auth.js');
  return { load, http: httpModule.default, refreshSession: httpModule.refreshSession, store: useAuthStore };
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

// Origin-wide Web Locks, shared by every tab (navigator.locks.request with an exclusive lock).
function fakeLocks() {
  const queues = new Map();
  return {
    request(name, callback) {
      const previous = queues.get(name) ?? Promise.resolve();
      const run = previous.then(() => callback({ name, mode: 'exclusive' }));
      queues.set(name, run.catch(() => {}));
      return run;
    },
  };
}

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function fakeWindow(pathname = '/explore') {
  const redirects = [];
  setGlobal('window', { location: { pathname, search: '', replace: (url) => redirects.push(url) } });
  return redirects;
}

// The /auth/refresh contract: every use rotates the jti, and a valid token whose jti isn't listed
// is reuse, which revokes every refresh token of the user.
function fakeBackend() {
  const listed = new Set(['jti-1']);
  const jar = { refreshToken: 'jti-1' };
  let nextJti = 2;
  let nextAccess = 1;
  let refreshStatus = null; // force an answer, e.g. 503

  function refresh(cookie) {
    if (refreshStatus) return { status: refreshStatus, code: 'SERVICE_UNAVAILABLE' };
    if (!cookie) return { status: 401, code: 'UNAUTHENTICATED', clearCookie: true };
    if (!listed.delete(cookie)) {
      listed.clear();
      return { status: 401, code: 'UNAUTHENTICATED', clearCookie: true };
    }
    const jti = `jti-${nextJti++}`;
    listed.add(jti);
    return {
      status: 200,
      setCookie: jti,
      data: { accessToken: `access-${nextAccess++}`, user: { _id: 'u1', name: 'Asha' } },
    };
  }

  // Becomes each tab's axios adapter: reads the cookie when the request leaves, answers after a
  // little latency, and stores Set-Cookie before the response reaches the page.
  async function adapter(config, handlers) {
    const cookie = jar.refreshToken;
    await tick();
    const path = config.url.replace(/^\/api\/v1/, '');
    const answer = path === '/auth/refresh' ? refresh(cookie) : handlers?.[path]?.(config) ?? { status: 404, code: 'NOT_FOUND' };
    await tick();
    if (answer.setCookie) jar.refreshToken = answer.setCookie;
    if (answer.clearCookie) jar.refreshToken = undefined;
    if (answer.network) throw new AxiosError('Network Error', 'ERR_NETWORK', config, {});
    const body = answer.status < 400
      ? { success: true, data: answer.data, requestId: 'req-1' }
      : { success: false, error: { code: answer.code, message: answer.code }, requestId: 'req-1' };
    const response = { data: body, status: answer.status, statusText: '', headers: {}, config, request: {} };
    if (answer.status < 400) return response;
    throw new AxiosError(`Request failed with status code ${answer.status}`, 'ERR_BAD_REQUEST', config, {}, response);
  }

  return {
    listed,
    jar,
    adapter,
    failRefreshWith(status) {
      refreshStatus = status;
    },
  };
}

test('two tabs refreshing at once both get a session and nothing is revoked', async () => {
  setGlobal('navigator', { locks: fakeLocks() });
  fakeWindow();
  const backend = fakeBackend();
  const [a, b] = await Promise.all([openTab(), openTab()]);
  a.http.defaults.adapter = (config) => backend.adapter(config);
  b.http.defaults.adapter = (config) => backend.adapter(config);

  const results = await Promise.allSettled([a.refreshSession(), b.refreshSession()]);

  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
  assert.ok(a.store.getState().accessToken);
  assert.ok(b.store.getState().accessToken);
  // One token is listed (the last rotation) and the jar holds it: no reuse, no revoke-all.
  assert.equal(backend.listed.size, 1);
  assert.ok(backend.listed.has(backend.jar.refreshToken));
});

test('a 503 from /auth/refresh keeps the session and does not redirect to /login', async () => {
  setGlobal('navigator', { locks: fakeLocks() });
  const redirects = fakeWindow('/bookings');
  const backend = fakeBackend();
  backend.failRefreshWith(503);
  const tab = await openTab();
  tab.http.defaults.adapter = (config) =>
    backend.adapter(config, { '/bookings': () => ({ status: 401, code: 'UNAUTHENTICATED' }) });
  tab.store.getState().setSession('expired-access', { _id: 'u1', name: 'Asha' });

  const err = await tab.http.get('/bookings').then(
    () => assert.fail('expected the request to fail'),
    (e) => e,
  );

  assert.equal(err.status, 503);
  assert.equal(err.code, 'SERVICE_UNAVAILABLE');
  assert.equal(tab.store.getState().accessToken, 'expired-access');
  assert.equal(tab.store.getState().user?.name, 'Asha');
  assert.deepEqual(redirects, []);
  assert.equal(backend.jar.refreshToken, 'jti-1');
});

test('a 401 from /auth/refresh still clears the session and redirects', async () => {
  setGlobal('navigator', { locks: fakeLocks() });
  const redirects = fakeWindow('/bookings');
  const backend = fakeBackend();
  backend.jar.refreshToken = undefined;
  const tab = await openTab();
  tab.http.defaults.adapter = (config) =>
    backend.adapter(config, { '/bookings': () => ({ status: 401, code: 'UNAUTHENTICATED' }) });
  tab.store.getState().setSession('expired-access', { _id: 'u1' });

  const err = await tab.http.get('/bookings').then(
    () => assert.fail('expected the request to fail'),
    (e) => e,
  );

  assert.equal(err.status, 401);
  assert.equal(tab.store.getState().accessToken, null);
  assert.deepEqual(redirects, ['/login?next=%2Fbookings']);
});

test('refresh still works where Web Locks are unavailable', async () => {
  setGlobal('navigator', {});
  fakeWindow();
  const backend = fakeBackend();
  const tab = await openTab();
  tab.http.defaults.adapter = (config) => backend.adapter(config);

  await tab.refreshSession();

  assert.equal(tab.store.getState().accessToken, 'access-1');
});

test('an ID-card upload that never reached the server is not recorded as pending', async () => {
  fakeWindow('/verification');
  const backend = fakeBackend();
  const tab = await openTab();
  const { uploadIdCard } = await tab.load('/src/features/verification/api.js');
  tab.http.defaults.adapter = (config) =>
    backend.adapter(config, { '/verification/id-card': () => ({ network: true }) });
  tab.store.getState().setSession('access', { _id: 'u1', verification: { status: 'unsubmitted' } });
  const form = new FormData();
  form.append('memberType', 'UG');

  await assert.rejects(uploadIdCard(form), (e) => e.status === 0);
  assert.equal(tab.store.getState().user.verification.status, 'unsubmitted');
});

test('the register email check leaves the allowed domains to the server', async () => {
  const tab = await openTab();
  const { campusEmail } = await tab.load('/src/lib/schemas/auth.js');

  // ALLOWED_EMAIL_DOMAINS may list more than nitjsr.ac.in; the server's VALIDATION_ERROR names them.
  assert.equal(campusEmail.safeParse('judge@gmail.com').success, true);
  assert.equal(campusEmail.safeParse('2024ugcs001@nitjsr.ac.in').success, true);
  assert.equal(campusEmail.safeParse('not-an-email').success, false);
  assert.equal(campusEmail.safeParse('').success, false);
});
