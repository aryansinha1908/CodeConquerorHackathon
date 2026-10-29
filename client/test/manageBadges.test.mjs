// Tests for the manager's badge queue and dashboard (frontend.md §6.3 /manage/badges and /manage;
// judge step 4): features/manage/badges (API module, helpers, card, evidence dialog, grant form),
// BadgeRequestsPage, and the dashboard's counts (features/manage/dashboard, DashboardPage). Run
// with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/foundations.test.mjs. Requests go to a
// fake axios adapter; pages render with react-dom/server from a React Query cache holding data
// shaped exactly as docs/api.md "Badges and badge requests" (and the Phase 4b additions: the
// evidence link and the grant by email) describes, so a crash such as rendering an object as text
// shows up here.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AxiosError } from 'axios';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let load;
let http;
let store;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  load = (path) => server.ssrLoadModule(path);
  http = (await load('/src/lib/http.js')).default;
  store = (await load('/src/stores/auth.js')).useAuthStore;
});

after(async () => {
  await server?.close();
});

// react-dom/server reads zustand's initial-state object (see verification.test.mjs).
function signIn(user) {
  store.getState().setSession('access', user);
  Object.assign(store.getInitialState(), { accessToken: 'access', user });
}

beforeEach(() => {
  store.getState().clear();
  Object.assign(store.getInitialState(), { accessToken: null, user: null });
});

const badgesApi = () => load('/src/features/manage/badges/api.js');
const badgeView = () => load('/src/features/manage/badges/badgeView.js');
const counts = () => load('/src/features/manage/dashboard/counts.js');

// ── Fakes ─────────────────────────────────────────────────────────────────────

// routes: { 'PATCH /badge-requests/ub1': (config) => answer }. An answer is { status, data, meta } or
// { status, code, message, details }; anything unrouted is 404 NOT_FOUND.
function fakeApi(routes = {}) {
  const calls = [];
  http.defaults.adapter = async (config) => {
    const path = config.url.replace(/^\/api\/v1/, '');
    const key = `${config.method.toUpperCase()} ${path}`;
    let body = config.data;
    if (typeof body === 'string') body = JSON.parse(body);
    calls.push({ key, config, body, params: config.params });
    const answer = routes[key]?.(config) ?? { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
    const envelope =
      answer.status < 400
        ? { success: true, data: answer.data, ...(answer.meta && { meta: answer.meta }), requestId: 'req-ok' }
        : {
            success: false,
            error: { code: answer.code, message: answer.message ?? answer.code, details: answer.details },
            requestId: 'req-err',
          };
    const response = { data: envelope, status: answer.status, statusText: '', headers: {}, config, request: {} };
    if (answer.status < 400) return response;
    throw new AxiosError(`Request failed with status code ${answer.status}`, 'ERR_BAD_REQUEST', config, {}, response);
  };
  return calls;
}

const rejection = (promise) =>
  promise.then(
    () => assert.fail('expected the request to fail'),
    (err) => err,
  );

// ── Data shaped as docs/api.md says ─────────────────────────────────────────

const CSE = { _id: 'd-cse', code: 'cse', name: 'Computer Science and Engineering' };
const EE = { _id: 'd-ee', code: 'ee', name: 'Electrical Engineering' };
const DIC = { _id: 'u-dic', name: 'Design and Innovation Centre', code: 'dic' };
const WORKSHOP = { _id: 'u-ws', name: 'Central Workshop', code: 'central-workshop' };

const MANAGER = {
  _id: 'mgr-1',
  name: 'Priya Manager',
  email: 'priya.manager@nitjsr.ac.in',
  roles: ['member', 'manager'],
  managedOrgUnits: ['u-dic', 'u-ws'],
  verification: { status: 'approved', reason: null, submittedAt: null },
};
const ADMIN = {
  _id: 'admin-1',
  name: 'Admin User',
  email: 'admin@nitjsr.ac.in',
  roles: ['member', 'admin'],
  managedOrgUnits: [],
  verification: { status: 'approved', reason: null, submittedAt: null },
};

// Badge (GET /badges): { _id, name, code, orgUnit: { _id, name, code, isActive }, description?,
// validityDays, evidenceRequired, selfServe }.
const BADGE_3D = {
  _id: 'bg-3d',
  name: '3D Printing Basics',
  code: '3d-printing-basics',
  orgUnit: { ...DIC, isActive: true },
  description: 'Safe use of the FDM printers.',
  validityDays: 365,
  evidenceRequired: true,
  selfServe: false,
};
const BADGE_LASER = {
  _id: 'bg-laser',
  name: 'Laser Cutter Safety',
  code: 'laser-safety',
  orgUnit: { ...DIC, isActive: true },
  validityDays: null,
  evidenceRequired: false,
  selfServe: false,
};
const BADGE_LATHE = {
  _id: 'bg-lathe',
  name: 'Lathe Induction',
  code: 'lathe-induction',
  orgUnit: { ...WORKSHOP, isActive: true },
  validityDays: 180,
  evidenceRequired: false,
  selfServe: false,
};

// Queue row: the member row + user { _id, name, memberType, department }, decidedBy, evidence.
const queueRow = (overrides = {}) => ({
  _id: 'ub1',
  badge: {
    _id: 'bg-3d',
    name: '3D Printing Basics',
    code: '3d-printing-basics',
    orgUnit: DIC,
    validityDays: 365,
    evidenceRequired: true,
    selfServe: false,
  },
  status: 'requested',
  state: 'requested',
  note: 'Did the induction with the lab supervisor on 27 Oct.',
  reason: null,
  requestedAt: '2026-10-28T05:00:00.000Z',
  decidedAt: null,
  expiresAt: null,
  hasEvidence: true,
  user: { _id: 'user-aarav', name: 'Aarav Student', memberType: 'ug', department: CSE },
  decidedBy: null,
  evidence: { publicId: 'campuscommons/evidence/ub1' },
  ...overrides,
});

const NO_EVIDENCE = queueRow({
  _id: 'ub2',
  badge: { ...queueRow().badge, _id: 'bg-laser', name: 'Laser Cutter Safety', code: 'laser-safety', validityDays: null, evidenceRequired: false },
  note: null,
  hasEvidence: false,
  evidence: null,
  requestedAt: '2026-10-28T09:30:00.000Z',
  user: { _id: 'user-diya', name: 'Diya Student', memberType: 'pg', department: EE },
});

const page = (rows, meta = {}) => ({ data: rows, meta: { page: 1, limit: 10, total: rows.length, ...meta } });

const failure = (overrides = {}) => ({
  status: 500,
  code: 'INTERNAL',
  message: 'Something went wrong.',
  details: [],
  retryAfter: null,
  requestId: 'req-abc123',
  ...overrides,
});

// ── Rendering ─────────────────────────────────────────────────────────────────

async function render(makeElement, { cache = [], errors = [], path = '/' } = {}) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, ...(errors.length && { retryOnMount: false }) } },
  });
  for (const [key, data] of cache) client.setQueryData(key, data);
  for (const [key, error] of errors) {
    client.getQueryCache().build(client, { queryKey: key }).setState({
      status: 'error',
      fetchStatus: 'idle',
      error,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: 1,
    });
  }
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(MemoryRouter, { initialEntries: [path] }, makeElement(React)),
    ),
  );
  client.clear();
  return html;
}

async function withHook(useHook) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidated = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters) => {
    invalidated.push(filters.queryKey);
    return original(filters);
  };
  const results = [];
  function Probe({ onResult }) {
    onResult(useHook());
    return null;
  }
  renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { onResult: (value) => results.push(value) }),
    ),
  );
  return { result: results[results.length - 1], invalidated, client };
}

function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertNoJunk(html) {
  const shown = text(html);
  assert.doesNotMatch(shown, /\[object Object\]/);
  assert.doesNotMatch(shown, /\bundefined\b|\bNaN\b|\bnull\b/);
}

// ── API functions ─────────────────────────────────────────────────────────────

test('listBadgeRequests: GET /badge-requests?status&page&limit, requested by default', async () => {
  const { listBadgeRequests, badgeRequestKeys, readBadgeRequestStatus } = await badgesApi();
  const calls = fakeApi({
    'GET /badge-requests': () => ({ status: 200, ...page([queueRow()], { total: 11 }) }),
  });
  const res = await listBadgeRequests();
  assert.deepEqual(calls[0].params, { status: 'requested', page: 1, limit: 10 });
  assert.deepEqual(res.data, [queueRow()]);
  assert.deepEqual(res.meta, { page: 1, limit: 10, total: 11 });
  await listBadgeRequests({ status: 'rejected', page: 2 });
  assert.deepEqual(calls[1].params, { status: 'rejected', page: 2, limit: 10 });
  await listBadgeRequests({ status: 'expired' });
  assert.equal(calls[2].params.status, 'requested', '"expired" is a state, not a queue status');
  assert.equal(readBadgeRequestStatus('revoked'), 'revoked');
  assert.equal(readBadgeRequestStatus(null), 'requested');
  assert.deepEqual(badgeRequestKeys.list({ status: 'active' }), ['badge-requests', { status: 'active', page: 1, limit: 10 }]);
});

test('decideBadgeRequest: approve sends only the decision, reject the trimmed reason', async () => {
  const { decideBadgeRequest } = await badgesApi();
  const calls = fakeApi({
    'PATCH /badge-requests/ub1': () => ({ status: 200, data: queueRow({ status: 'active', state: 'active' }) }),
  });
  await decideBadgeRequest('ub1', { decision: 'approve', reason: 'ignored' });
  assert.deepEqual(calls[0].body, { decision: 'approve' });
  await decideBadgeRequest('ub1', { decision: 'reject', reason: '  Please attach the certificate.  ' });
  assert.deepEqual(calls[1].body, { decision: 'reject', reason: 'Please attach the certificate.' });
});

test('getBadgeEvidenceUrl: GET /badge-requests/:id/evidence → { url, expiresAt }; 404 without one', async () => {
  const { getBadgeEvidenceUrl } = await badgesApi();
  const link = {
    url: 'https://api.cloudinary.com/v1_1/demo/image/download?public_id=campuscommons%2Fevidence%2Fub1&signature=abc',
    expiresAt: '2026-10-29T05:05:00.000Z',
  };
  const calls = fakeApi({
    'GET /badge-requests/ub1/evidence': () => ({ status: 200, data: link }),
    'GET /badge-requests/ub2/evidence': () => ({ status: 404, code: 'NOT_FOUND', message: 'Evidence not found.' }),
  });
  assert.deepEqual((await getBadgeEvidenceUrl('ub1')).data, link);
  assert.equal(calls[0].key, 'GET /badge-requests/ub1/evidence');
  const err = await rejection(getBadgeEvidenceUrl('ub2'));
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.requestId, 'req-err');
});

test('listBadges and grantBadge: the unit filter, and a grant by email with an optional note', async () => {
  const { listBadges, grantBadge } = await badgesApi();
  const granted = queueRow({ status: 'active', state: 'active', expiresAt: '2027-10-29T05:00:00.000Z' });
  const calls = fakeApi({
    'GET /badges': () => ({ status: 200, data: [BADGE_3D] }),
    'POST /badges/bg-3d/grant': () => ({ status: 200, data: granted }),
  });
  const res = await listBadges({ orgUnit: 'u-dic' });
  assert.deepEqual(calls[0].params, { orgUnit: 'u-dic' });
  assert.deepEqual(res.data, [BADGE_3D]);
  await listBadges();
  assert.deepEqual(calls[1].params, {}, 'an admin asks for every badge');

  const answer = await grantBadge('bg-3d', { email: '  2024UGCS001@nitjsr.ac.in ', note: '   ' });
  assert.equal(calls[2].key, 'POST /badges/bg-3d/grant');
  assert.deepEqual(calls[2].body, { email: '2024UGCS001@nitjsr.ac.in' }, 'trimmed; case left for the server; blank note left out');
  assert.equal(answer.data.status, 'active');
  await grantBadge('bg-3d', { email: 'a@nitjsr.ac.in', note: ' Induction on 28 Oct. ' });
  assert.deepEqual(calls[3].body, { email: 'a@nitjsr.ac.in', note: 'Induction on 28 Oct.' });
});

test('an unknown email comes back as a field error on "email"', async () => {
  const { grantBadge } = await badgesApi();
  const { fieldErrorsFrom } = await load('/src/lib/errors.js');
  fakeApi({
    'POST /badges/bg-3d/grant': () => ({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Some fields need fixing.',
      details: [{ path: 'email', message: 'No account has this email.' }],
    }),
  });
  const err = await rejection(grantBadge('bg-3d', { email: 'nobody@nitjsr.ac.in' }));
  assert.deepEqual(fieldErrorsFrom(err), { email: 'No account has this email.' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

test('requestView: member, badge, note and IST times, never an email', async () => {
  const { requestView } = await badgeView();
  const v = requestView(queueRow());
  assert.equal(v.id, 'ub1');
  assert.deepEqual(v.member, {
    name: 'Aarav Student',
    memberType: 'Undergraduate (UG)',
    department: 'Computer Science and Engineering (CSE)',
  });
  assert.equal(v.badgeName, '3D Printing Basics');
  assert.equal(v.unitName, 'Design and Innovation Centre');
  assert.equal(v.validity, 'Valid for 365 days');
  assert.equal(v.evidenceRequired, true);
  assert.equal(v.requestedAt, '28 Oct 2026, 10:30 am IST');
  assert.equal(v.decidedAt, null);
  assert.equal(v.hasEvidence, true);
  assert.equal(requestView(NO_EVIDENCE).note, '', 'a null note is no note');
  assert.equal(requestView(NO_EVIDENCE).validity, 'Never expires');
  const decided = requestView(
    queueRow({
      status: 'rejected',
      state: 'rejected',
      reason: 'Please attach your training certificate as evidence.',
      decidedAt: '2026-10-29T04:30:00.000Z',
      decidedBy: { _id: 'mgr-1', name: 'Priya Manager' },
    }),
  );
  assert.equal(decided.decidedBy, 'Priya Manager');
  assert.equal(decided.decidedAt, '29 Oct 2026, 10:00 am IST');
  assert.equal(decided.reason, 'Please attach your training certificate as evidence.');
  // Missing pieces don't crash.
  assert.equal(requestView({}).member.name, 'A member');
  assert.equal(requestView(null).badgeName, 'A badge');
});

test('state badges show state, not status; validity and the expiry a grant would set', async () => {
  const { badgeStateView, validityText, expiryOnGrant, hasEvidence } = await badgeView();
  assert.equal(badgeStateView({ status: 'active', state: 'expired' }).label, 'Expired');
  assert.equal(badgeStateView({ status: 'active', state: 'active' }).label, 'Active');
  assert.equal(badgeStateView({ status: 'revoked', state: 'revoked' }).label, 'Revoked');
  assert.equal(badgeStateView({}).label, 'Requested');
  assert.equal(validityText(1), 'Valid for 1 day');
  assert.equal(validityText(null), 'Never expires');
  const now = Date.parse('2026-10-29T05:00:00.000Z');
  assert.equal(expiryOnGrant(365, now), 'It expires on 29 Oct 2027.');
  assert.equal(expiryOnGrant(null, now), 'It never expires.');
  assert.equal(hasEvidence({ hasEvidence: false, evidence: { publicId: 'x' } }), true);
  assert.equal(hasEvidence({ hasEvidence: false, evidence: null }), false);
});

test('canDecide: only requested rows, and never your own unless you are an admin', async () => {
  const { canDecide, isOwnRequest } = await badgeView();
  const own = queueRow({ user: { _id: 'mgr-1', name: 'Priya Manager', memberType: 'faculty', department: CSE } });
  assert.equal(canDecide(queueRow(), MANAGER), true);
  assert.equal(canDecide(queueRow({ status: 'active', state: 'active' }), MANAGER), false);
  assert.equal(isOwnRequest(own, MANAGER), true);
  assert.equal(canDecide(own, MANAGER), false);
  assert.equal(canDecide(own, { ...ADMIN, _id: 'mgr-1' }), true);
});

test('readGrant: badge, a plausible email (not your own unless admin) and a note of at most 500', async () => {
  const { readGrant } = await badgeView();
  assert.deepEqual(readGrant({ badgeId: 'bg-3d', email: ' 2024ugcs001@nitjsr.ac.in ', note: '' }, MANAGER), {
    body: { badgeId: 'bg-3d', email: '2024ugcs001@nitjsr.ac.in' },
    errors: {},
  });
  assert.deepEqual(readGrant({ badgeId: 'bg-3d', email: 'a@b.in', note: ' Induction. ' }, MANAGER).body, {
    badgeId: 'bg-3d',
    email: 'a@b.in',
    note: 'Induction.',
  });
  const empty = readGrant({}, MANAGER);
  assert.equal(empty.body, null);
  assert.equal(empty.errors.badgeId, 'Choose a badge.');
  assert.equal(empty.errors.email, "Enter the member's email address.");
  assert.match(readGrant({ badgeId: 'b', email: 'not-an-email' }, MANAGER).errors.email, /valid email address/);
  assert.match(
    readGrant({ badgeId: 'b', email: 'Priya.Manager@NITJSR.ac.in' }, MANAGER).errors.email,
    /can't grant a badge to yourself/,
  );
  assert.equal(readGrant({ badgeId: 'b', email: 'admin@nitjsr.ac.in' }, ADMIN).errors.email, undefined, 'an admin may');
  assert.match(readGrant({ badgeId: 'b', email: 'a@b.in', note: 'x'.repeat(501) }, MANAGER).errors.note, /at most 500/);
});

test('managed units, the picker groups, and the success lines', async () => {
  const { managedUnitIds, groupBadgesByUnit, decisionMessage, grantMessage, decisionFailure } = await badgeView();
  assert.deepEqual(managedUnitIds(MANAGER), ['u-dic', 'u-ws']);
  assert.deepEqual(managedUnitIds({ managedOrgUnits: [{ _id: 'u-x', name: 'X' }] }), ['u-x']);
  assert.deepEqual(managedUnitIds(null), []);
  const groups = groupBadgesByUnit([BADGE_LATHE, BADGE_LASER, BADGE_3D]);
  assert.deepEqual(
    groups.map((g) => [g.unit.name, g.badges.map((b) => b.name)]),
    [
      ['Central Workshop', ['Lathe Induction']],
      ['Design and Innovation Centre', ['3D Printing Basics', 'Laser Cutter Safety']],
    ],
  );
  assert.equal(decisionMessage('approve', queueRow()), 'Granted 3D Printing Basics to Aarav Student.');
  assert.equal(decisionMessage('reject', queueRow()), "Rejected Aarav Student's request for 3D Printing Basics.");
  assert.equal(
    grantMessage(queueRow({ status: 'active', expiresAt: '2027-10-29T05:00:00.000Z' })),
    'Granted 3D Printing Basics to Aarav Student. It expires on 29 Oct 2027.',
  );
  assert.equal(grantMessage({}, BADGE_LASER), 'Granted Laser Cutter Safety to the member.');
  assert.equal(decisionFailure({ code: 'INVALID_TRANSITION' }), 'stale');
  assert.equal(decisionFailure({ code: 'NOT_FOUND' }), 'stale');
  assert.equal(decisionFailure({ code: 'FORBIDDEN' }), 'stay');
});

// ── Hooks ─────────────────────────────────────────────────────────────────────

test('a decision waits for the server, then refreshes the queue and the member badges', async () => {
  const { useDecideBadgeRequest } = await badgesApi();
  fakeApi({ 'PATCH /badge-requests/ub1': () => ({ status: 200, data: queueRow({ status: 'active' }) }) });
  const ok = await withHook(() => useDecideBadgeRequest());
  await ok.result.mutateAsync({ id: 'ub1', decision: 'approve' });
  assert.deepEqual(ok.invalidated, [['badge-requests'], ['badges', 'mine']]);
  ok.client.clear();

  fakeApi({
    'PATCH /badge-requests/ub1': () => ({ status: 409, code: 'INVALID_TRANSITION', message: 'This badge has already been granted.' }),
  });
  const stale = await withHook(() => useDecideBadgeRequest());
  const err = await rejection(stale.result.mutateAsync({ id: 'ub1', decision: 'reject', reason: 'Not yet trained here.' }));
  assert.equal(err.code, 'INVALID_TRANSITION');
  assert.deepEqual(stale.invalidated, [['badge-requests']], 'the queue reloads to show who decided');
  stale.client.clear();

  fakeApi({ 'PATCH /badge-requests/ub1': () => ({ status: 403, code: 'FORBIDDEN', message: 'No.' }) });
  const refused = await withHook(() => useDecideBadgeRequest());
  await rejection(refused.result.mutateAsync({ id: 'ub1', decision: 'approve' }));
  assert.deepEqual(refused.invalidated, [], 'a 403 changes nothing on screen');
  refused.client.clear();
});

test('a grant refreshes the queue and member badges; a vanished badge refreshes the picker', async () => {
  const { useGrantBadge } = await badgesApi();
  const calls = fakeApi({ 'POST /badges/bg-3d/grant': () => ({ status: 200, data: queueRow({ status: 'active' }) }) });
  const ok = await withHook(() => useGrantBadge());
  await ok.result.mutateAsync({ badgeId: 'bg-3d', email: 'a@nitjsr.ac.in' });
  assert.deepEqual(calls[0].body, { email: 'a@nitjsr.ac.in' });
  assert.deepEqual(ok.invalidated, [['badge-requests'], ['badges', 'mine']]);
  ok.client.clear();

  fakeApi({ 'POST /badges/bg-x/grant': () => ({ status: 404, code: 'NOT_FOUND', message: 'Badge not found.' }) });
  const gone = await withHook(() => useGrantBadge());
  await rejection(gone.result.mutateAsync({ badgeId: 'bg-x', email: 'a@nitjsr.ac.in' }));
  assert.deepEqual(gone.invalidated, [['badges']]);
  gone.client.clear();
});

test('useGrantableBadges: one GET /badges?orgUnit= per managed unit, every badge for an admin', async () => {
  const { useGrantableBadges, badgeKeys } = await badgesApi();
  const calls = fakeApi({
    'GET /badges': (config) => ({
      status: 200,
      data: config.params?.orgUnit === 'u-ws' ? [BADGE_LATHE] : config.params?.orgUnit === 'u-dic' ? [BADGE_3D, BADGE_LASER] : [BADGE_3D, BADGE_LASER, BADGE_LATHE],
    }),
  });
  const manager = await withHook(() => useGrantableBadges(['u-dic', 'u-ws']));
  const keys = manager.client.getQueryCache().getAll().map((q) => q.queryKey);
  assert.deepEqual(keys, [badgeKeys.catalogue('u-dic'), badgeKeys.catalogue('u-ws')]);
  await Promise.all(manager.client.getQueryCache().getAll().map((q) => q.fetch()));
  assert.deepEqual(calls.map((c) => c.params), [{ orgUnit: 'u-dic' }, { orgUnit: 'u-ws' }]);
  manager.client.clear();

  const admin = await withHook(() => useGrantableBadges([], { all: true }));
  assert.deepEqual(admin.client.getQueryCache().getAll().map((q) => q.queryKey), [badgeKeys.catalogue(null)]);
  admin.client.clear();

  const none = await withHook(() => useGrantableBadges([]));
  assert.equal(none.result.units, 0);
  assert.deepEqual(none.result.badges, []);
  assert.equal(none.result.isPending, false);
  none.client.clear();
});

// ── The queue page ────────────────────────────────────────────────────────────

async function queueKey(params = {}) {
  const { badgeRequestKeys } = await badgesApi();
  return badgeRequestKeys.list({ status: 'requested', page: 1, ...params });
}

test('BadgeRequestsPage: each request with the member, badge, note, evidence and decisions', async () => {
  signIn(MANAGER);
  const { default: BadgeRequestsPage } = await load('/src/features/manage/BadgeRequestsPage.jsx');
  const html = await render((React) => React.createElement(BadgeRequestsPage), {
    path: '/manage/badges',
    cache: [[await queueKey(), page([queueRow(), NO_EVIDENCE])]],
  });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /<h2[^>]*>Badge requests<\/h2>/);
  assert.match(html, /<h3[^>]*>Aarav Student<\/h3>/);
  assert.match(html, /<h3[^>]*>Diya Student<\/h3>/);
  assert.ok(shown.indexOf('Aarav Student') < shown.indexOf('Diya Student'), 'oldest first, as the server sends');
  assert.match(shown, /2 requested · oldest first/);
  assert.match(shown, /Undergraduate \(UG\) · Computer Science and Engineering \(CSE\)/);
  assert.match(shown, /Postgraduate \(PG\) · Electrical Engineering \(EE\)/);
  assert.match(shown, /3D Printing Basics \(3d-printing-basics\) · Design and Innovation Centre/);
  assert.match(shown, /Valid for 365 days · evidence required/);
  assert.match(shown, /Requested 28 Oct 2026, 10:30 am IST/);
  assert.match(shown, /Their note “Did the induction with the lab supervisor on 27 Oct\.”/);
  assert.match(shown, /Their note No note\./);
  // Evidence: the first can be opened; the second says why not.
  assert.match(html, /<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?View evidence<span class="sr-only">: Aarav Student&#x27;s request for 3D Printing Basics<\/span>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-describedby="badge-request-ub2-no-evidence"/);
  assert.match(shown, /No evidence attached/);
  // Decisions, named for the request they act on.
  assert.match(shown, /Approve Aarav Student's request for 3D Printing Basics/);
  assert.match(shown, /Reject Diya Student's request for Laser Cutter Safety/);
  // The status filter and the grant button.
  assert.match(html, /aria-pressed="true"[^>]*>Requested<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Granted<\/button>/);
  assert.match(shown, /Grant directly/);
  assert.doesNotMatch(shown, /@/, 'no email address anywhere');
  assert.doesNotMatch(html, /role="dialog"/, 'no dialog is open');
});

test("BadgeRequestsPage: a manager's own request can't be decided by them; an admin's can", async () => {
  const { default: BadgeRequestsPage } = await load('/src/features/manage/BadgeRequestsPage.jsx');
  const { OWN_REQUEST_MESSAGE } = await badgeView();
  const own = queueRow({ user: { _id: 'mgr-1', name: 'Priya Manager', memberType: 'faculty', department: CSE } });
  const cache = [[await queueKey(), page([own])]];

  signIn(MANAGER);
  const asManager = text(await render((React) => React.createElement(BadgeRequestsPage), { cache }));
  assert.ok(asManager.includes(`Your own request. ${OWN_REQUEST_MESSAGE}`));
  assert.doesNotMatch(asManager, /Approve Priya Manager's request/);

  signIn({ ...ADMIN, _id: 'mgr-1' });
  const asAdmin = text(await render((React) => React.createElement(BadgeRequestsPage), { cache }));
  assert.match(asAdmin, /Approve Priya Manager's request/);
  assert.doesNotMatch(asAdmin, /Your own request/);
});

test('BadgeRequestsPage: decided rows show who decided, when, why and the expiry, with no buttons', async () => {
  signIn(MANAGER);
  const { default: BadgeRequestsPage } = await load('/src/features/manage/BadgeRequestsPage.jsx');
  const granted = queueRow({
    status: 'active',
    state: 'active',
    decidedAt: '2026-10-29T04:30:00.000Z',
    decidedBy: { _id: 'mgr-1', name: 'Priya Manager' },
    expiresAt: '2027-10-29T04:30:00.000Z',
  });
  const expired = queueRow({ _id: 'ub3', status: 'active', state: 'expired', decidedAt: '2025-01-01T04:30:00.000Z', expiresAt: '2026-01-01T04:30:00.000Z' });
  const html = await render((React) => React.createElement(BadgeRequestsPage), {
    path: '/manage/badges?status=active',
    cache: [[await queueKey({ status: 'active' }), page([granted, expired])]],
  });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /aria-pressed="true"[^>]*>Granted<\/button>/);
  assert.match(shown, /2 granted · newest decision first/);
  assert.match(shown, /Decided 29 Oct 2026, 10:00 am IST/);
  assert.match(shown, /Decided by Priya Manager/);
  assert.match(shown, /Expires 29 Oct 2027, 10:00 am IST/);
  assert.match(shown, /\bActive\b/);
  assert.match(shown, /\bExpired\b/, 'state, not status');
  assert.doesNotMatch(shown, /\bApprove\b|\bReject\b/);
});

test('BadgeRequestsPage: loading, empty and error (message, request id, retry) states', async () => {
  signIn(MANAGER);
  const { default: BadgeRequestsPage } = await load('/src/features/manage/BadgeRequestsPage.jsx');
  const key = await queueKey();

  const loading = await render((React) => React.createElement(BadgeRequestsPage));
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the badge requests…/);

  const empty = await render((React) => React.createElement(BadgeRequestsPage), { cache: [[key, page([])]] });
  assert.match(text(empty), /No badge requests waiting/);
  assert.match(text(empty), /0 requested/);

  const failed = await render((React) => React.createElement(BadgeRequestsPage), {
    errors: [[key, failure({ status: 403, code: 'FORBIDDEN', message: 'Only unit managers can see badge requests.' })]],
  });
  assert.match(failed, /role="alert"/);
  assert.match(text(failed), /Couldn't load the badge requests/);
  assert.match(text(failed), /Only unit managers can see badge requests\./);
  assert.match(text(failed), /ref: req-abc123/);
  assert.match(text(failed), /Try again/);

  const many = await render((React) => React.createElement(BadgeRequestsPage), {
    cache: [[key, page([queueRow()], { total: 25 })]],
  });
  assert.match(text(many), /Page 1 of 3/);
});

// ── Evidence and grant ────────────────────────────────────────────────────────

test('EvidenceBody: the logged-view notice, the file with its expiry, and the failure states', async () => {
  const { EvidenceBody } = await load('/src/features/manage/badges/EvidenceDialog.jsx');
  const url = 'https://api.cloudinary.com/v1_1/demo/image/download?public_id=campuscommons%2Fevidence%2Fub1&signature=abc';
  const shown = await render((React) =>
    React.createElement(EvidenceBody, {
      row: queueRow(),
      request: { isPending: false, isError: false, data: { data: { url, expiresAt: '2026-10-29T05:05:00.000Z' } } },
    }),
  );
  assertNoJunk(shown);
  assert.match(text(shown), /Viewing is logged/);
  assert.match(shown, /<img[^>]*alt="Evidence Aarav Student sent for 3D Printing Basics"/);
  assert.match(shown, /referrerPolicy="no-referrer"/);
  assert.match(text(shown), /The link expires at 29 Oct 2026, 10:35 am IST\./);
  assert.match(shown, /<a[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>[\s\S]*Open in a new tab/);

  const loading = await render((React) =>
    React.createElement(EvidenceBody, { row: queueRow(), request: { isPending: true, isError: false } }),
  );
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Getting a viewing link…/);

  const missing = await render((React) =>
    React.createElement(EvidenceBody, {
      row: queueRow(),
      request: { isPending: false, isError: true, error: failure({ status: 404, code: 'NOT_FOUND', message: 'Evidence not found.' }) },
      onRetry: () => {},
    }),
  );
  assert.match(text(missing), /No evidence on file Evidence not found\./);
  assert.doesNotMatch(text(missing), /Try again/, 'asking again would not find it');

  const down = await render((React) =>
    React.createElement(EvidenceBody, {
      row: queueRow(),
      request: {
        isPending: false,
        isError: true,
        error: failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: "The file can't be opened right now. Try again in a minute." }),
      },
      onRetry: () => {},
    }),
  );
  assert.match(text(down), /Couldn't open the evidence/);
  assert.match(text(down), /ref: req-abc123/);
  assert.match(text(down), /Try again/);
});

const idleRequest = { isPending: false, error: null };

test('GrantForm: your units’ badges grouped by unit, the email and an optional audit note', async () => {
  signIn(MANAGER);
  const { GrantForm } = await load('/src/features/manage/badges/GrantDialog.jsx');
  const { badgeKeys } = await badgesApi();
  const html = await render(
    (React) => React.createElement(GrantForm, { user: MANAGER, request: idleRequest }),
    {
      cache: [
        [badgeKeys.catalogue('u-dic'), { data: [BADGE_3D, BADGE_LASER] }],
        [badgeKeys.catalogue('u-ws'), { data: [BADGE_LATHE] }],
      ],
    },
  );
  assertNoJunk(html);
  assert.match(html, /<label[^>]*>Badge<\/label>/);
  assert.match(html, /<optgroup label="Central Workshop"><option value="bg-lathe">Lathe Induction \(lathe-induction\)<\/option><\/optgroup>/);
  assert.match(html, /<optgroup label="Design and Innovation Centre"><option value="bg-3d">3D Printing Basics/);
  assert.match(html, /<option value="" disabled="" selected="">Choose a badge<\/option>/, 'several badges: the manager picks');
  assert.match(html, /<input[^>]*type="email"/);
  assert.match(html, /<label[^>]*>Member&#x27;s email<\/label>/);
  assert.match(text(html), /Note \(optional\)/);
  assert.match(text(html), /Kept in the audit log only; the member doesn't see it\./);
  assert.match(text(html), /Grant badge/);
});

test('GrantForm: one badge is chosen for you, with its validity; no units or no badges say so', async () => {
  const { GrantForm } = await load('/src/features/manage/badges/GrantDialog.jsx');
  const { badgeKeys } = await badgesApi();
  const single = { ...MANAGER, managedOrgUnits: ['u-dic'] };
  signIn(single);
  const one = await render((React) => React.createElement(GrantForm, { user: single, request: idleRequest }), {
    cache: [[badgeKeys.catalogue('u-dic'), { data: [BADGE_3D] }]],
  });
  assert.match(one, /<option value="bg-3d" selected="">/);
  assert.match(text(one), /Valid for 365 days\. It expires on/);

  const loneManager = { ...MANAGER, managedOrgUnits: [] };
  const noUnits = await render((React) => React.createElement(GrantForm, { user: loneManager, request: idleRequest }));
  assert.match(text(noUnits), /You don't manage any unit yet/);
  assert.match(noUnits, /aria-disabled="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Grant badge/);

  const empty = await render((React) => React.createElement(GrantForm, { user: single, request: idleRequest }), {
    cache: [[badgeKeys.catalogue('u-dic'), { data: [] }]],
  });
  assert.match(text(empty), /Your units have no badges yet\./);

  signIn(ADMIN);
  const admin = await render((React) => React.createElement(GrantForm, { user: ADMIN, request: idleRequest }), {
    cache: [[badgeKeys.catalogue(null), { data: [BADGE_3D, BADGE_LATHE] }]],
  });
  assert.match(admin, /<optgroup label="Central Workshop">/, 'an admin sees every unit');
  assert.match(admin, /<optgroup label="Design and Innovation Centre">/);
});

test('GrantForm: the server’s field errors sit beside their fields; others above the buttons', async () => {
  const { GrantForm } = await load('/src/features/manage/badges/GrantDialog.jsx');
  const { badgeKeys } = await badgesApi();
  signIn(MANAGER);
  const cache = [
    [badgeKeys.catalogue('u-dic'), { data: [BADGE_3D] }],
    [badgeKeys.catalogue('u-ws'), { data: [] }],
  ];
  const fieldErr = failure({
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Some fields need fixing.',
    details: [{ path: 'email', message: 'No account has this email.' }],
  });
  const onEmail = await render(
    (React) => React.createElement(GrantForm, { user: MANAGER, request: { isPending: false, error: fieldErr } }),
    { cache },
  );
  assert.match(onEmail, /<input[^>]*aria-invalid="true"[^>]*type="email"|<input[^>]*type="email"[^>]*aria-invalid="true"/);
  assert.match(text(onEmail), /✕ No account has this email\./);
  assert.doesNotMatch(text(onEmail), /The badge wasn't granted/);

  const forbidden = failure({
    status: 403,
    code: 'FORBIDDEN',
    message: "You can't grant a badge to yourself. Another manager of this unit or an admin must.",
  });
  const other = await render(
    (React) => React.createElement(GrantForm, { user: MANAGER, request: { isPending: false, error: forbidden } }),
    { cache },
  );
  assert.match(text(other), /The badge wasn't granted You can't grant a badge to yourself/);
  assert.match(text(other), /ref: req-abc123/);

  const pending = await render(
    (React) => React.createElement(GrantForm, { user: MANAGER, request: { isPending: true, error: null } }),
    { cache },
  );
  assert.match(text(pending), /Granting…/);
});

// ── The dashboard ─────────────────────────────────────────────────────────────

test('the dashboard counts are limit=1 pages of the lists their cards open', async () => {
  const { bookingCountFilters, incidentCountParams, incidentCountKey, countOpenIncidents, totalOf } = await counts();
  const now = Date.parse('2026-10-29T05:00:00.000Z'); // 10:30 IST
  const filters = bookingCountFilters(now);
  assert.deepEqual(filters.pending, { status: 'pending', page: 1, limit: 1 });
  assert.deepEqual(filters.today, {
    status: 'approved',
    page: 1,
    limit: 1,
    from: '2026-10-28T18:30:00.000Z', // IST midnight
    to: '2026-10-29T18:30:00.000Z',
  });
  assert.deepEqual(filters.returns, { status: 'checked_out', page: 1, limit: 1 });
  assert.deepEqual(incidentCountParams, { status: 'open,in_review', page: 1, limit: 1 });
  assert.equal(incidentCountKey[0], 'incidents', 'under the incident lists’ prefix, so their changes refresh it');

  const calls = fakeApi({
    'GET /incidents': () => ({ status: 200, data: [{ _id: 'inc-1' }], meta: { page: 1, limit: 1, total: 4 } }),
  });
  const res = await countOpenIncidents();
  assert.deepEqual(calls[0].params, { status: 'open,in_review', page: 1, limit: 1 });
  assert.equal(totalOf(res), 4);
  assert.equal(totalOf({ meta: { total: 0 } }), 0);
  assert.equal(totalOf({}), null);
  assert.equal(totalOf(undefined), null);
});

async function dashboardCache(totals) {
  const { bookingKeys } = await load('/src/features/bookings/api.js');
  const { bookingCountFilters, incidentCountKey } = await counts();
  const { badgeRequestKeys } = await badgesApi();
  const filters = bookingCountFilters(Date.now());
  const one = (total) => ({ data: [], meta: { page: 1, limit: 1, total } });
  return {
    keys: {
      pending: bookingKeys.manageList(filters.pending),
      today: bookingKeys.manageList(filters.today),
      returns: bookingKeys.manageList(filters.returns),
      incidents: incidentCountKey,
      badges: badgeRequestKeys.list({ status: 'requested', page: 1, limit: 1 }),
    },
    entries: (keys) =>
      Object.entries(totals)
        .filter(([, total]) => total !== undefined)
        .map(([name, total]) => [keys[name], one(total)]),
  };
}

test('DashboardPage: five count cards, each a link to where the work is done', async () => {
  signIn(MANAGER);
  const { default: DashboardPage } = await load('/src/features/manage/DashboardPage.jsx');
  const { keys, entries } = await dashboardCache({ pending: 3, today: 1, returns: 2, incidents: 0, badges: 5 });
  const html = await render((React) => React.createElement(DashboardPage), { path: '/manage', cache: entries(keys) });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /<h2[^>]*>Dashboard<\/h2>/);
  assert.match(shown, /across the units you manage/);
  const card = (href, title, sr, count) =>
    new RegExp(
      `<a[^>]*href="${href}"[^>]*>[\\s\\S]*?<h3[^>]*>${title}<span class="sr-only">: ${sr}</span></h3><div aria-hidden="true"[^>]*><span[^>]*>${count}</span>`,
    );
  assert.match(html, card('/manage/requests', 'Requests to review', '3 slots waiting', 3));
  assert.match(html, card('/manage/handovers', 'Handovers today', '1 booking starting today', 1));
  assert.match(html, card('/manage/handovers', 'Returns to confirm', '2 returns to confirm', 2));
  assert.match(html, card('/manage/incidents', 'Open incidents', '0 incidents open', 0));
  assert.match(html, card('/manage/badges', 'Badge requests', '5 requests waiting', 5));
  // Each link is named by its heading and described by its line.
  assert.match(html, /aria-labelledby="dashboard-requests-heading" aria-describedby="dashboard-requests-description"/);

  signIn(ADMIN);
  const asAdmin = text(await render((React) => React.createElement(DashboardPage), { cache: entries(keys) }));
  assert.match(asAdmin, /across every unit/);
});

test('DashboardPage: a loading count waits in place; a failed one says why below its link', async () => {
  signIn(MANAGER);
  const { default: DashboardPage } = await load('/src/features/manage/DashboardPage.jsx');
  const { keys, entries } = await dashboardCache({ pending: 3, today: 1, returns: 2, badges: 5 });

  const loading = await render((React) => React.createElement(DashboardPage), { cache: entries(keys) });
  assert.match(loading, /Open incidents<span class="sr-only">: loading<\/span>/);

  const failed = await render((React) => React.createElement(DashboardPage), {
    cache: entries(keys),
    errors: [[keys.incidents, failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again later.' })]],
  });
  const shown = text(failed);
  assert.match(failed, /Open incidents<span class="sr-only">: couldn&#x27;t load the count<\/span>/);
  assert.match(shown, /Couldn't load this count Try again later\./);
  assert.match(shown, /ref: req-abc123/);
  assert.match(shown, /Try again/);
  // The retry sits after the link, not inside it.
  const link = failed.slice(failed.indexOf('href="/manage/incidents"'), failed.indexOf('</a>', failed.indexOf('href="/manage/incidents"')));
  assert.doesNotMatch(link, /<button/);
  assert.match(shown, /—/, 'no made-up number');
  // The other cards still show theirs.
  assert.match(failed, /Badge requests<span class="sr-only">: 5 requests waiting<\/span>/);
});
