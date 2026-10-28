// Tests for the ID-verification flow (features/verification) and the admin queue (features/admin)
// against the Phase 2 contract. Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/authClient.test.mjs. Requests go to a
// fake axios adapter; pages render with react-dom/server from a pre-filled React Query cache, so
// no request leaves the process.
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

// react-dom/server reads zustand's server snapshot, which is the store's initial-state object, so a
// rendered page sees the signed-in user only when that object holds it too (the browser reads the
// live state). Requests read the live state as usual.
function signIn(user) {
  store.getState().setSession('access', user);
  Object.assign(store.getInitialState(), { accessToken: 'access', user });
}

beforeEach(() => {
  store.getState().clear();
  Object.assign(store.getInitialState(), { accessToken: null, user: null });
});

// ── Fakes ─────────────────────────────────────────────────────────────────────

// routes: { 'GET /verification/status': (config) => answer }. An answer is { status, data, meta }
// or { status, code, message, details }; anything unrouted is 404 NOT_FOUND.
function fakeApi(routes = {}) {
  const calls = [];
  http.defaults.adapter = async (config) => {
    const path = config.url.replace(/^\/api\/v1/, '');
    const key = `${config.method.toUpperCase()} ${path}`;
    calls.push({ key, config });
    const answer = routes[key]?.(config) ?? { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
    if (answer.network) throw new AxiosError('Network Error', 'ERR_NETWORK', config, {});
    const body =
      answer.status < 400
        ? { success: true, data: answer.data, ...(answer.meta && { meta: answer.meta }), requestId: 'req-ok' }
        : {
            success: false,
            error: { code: answer.code, message: answer.message ?? answer.code, details: answer.details },
            requestId: 'req-err',
          };
    const response = { data: body, status: answer.status, statusText: '', headers: {}, config, request: {} };
    if (answer.status < 400) return response;
    throw new AxiosError(`Request failed with status code ${answer.status}`, 'ERR_BAD_REQUEST', config, {}, response);
  };
  return calls;
}

// Seed-like org units (server/scripts/seedData.js): departments, a centre, an inactive department.
const UNITS = [
  { _id: 'u-cse', code: 'cse', name: 'Computer Science and Engineering', type: 'department', isActive: true },
  { _id: 'u-ee', code: 'ee', name: 'Electrical Engineering', type: 'department', isActive: true },
  { _id: 'u-mech', code: 'mech', name: 'Mechanical Engineering', type: 'department', isActive: true },
  { _id: 'u-old', code: 'old', name: 'Applied Old Things', type: 'department', isActive: false },
  { _id: 'u-dic', code: 'dic', name: 'Design and Innovation Centre', type: 'centre', isActive: true },
];

const statusView = (overrides = {}) => ({
  status: 'unsubmitted',
  reason: null,
  submittedAt: null,
  reviewedAt: null,
  memberType: null,
  department: null,
  hasIdCard: false,
  ...overrides,
});

const queueItem = (overrides = {}) => ({
  user: {
    _id: 'user-rohan',
    name: 'Rohan Mehta',
    email: 'newstudent@demo.campuscommons.test',
    emailHints: { year: 2026, level: 'ug', branch: 'ee', serial: null },
    memberType: 'ug',
    department: { _id: 'u-ee', code: 'ee', name: 'Electrical Engineering' },
  },
  status: 'pending',
  submittedAt: '2026-10-28T21:19:35.000Z',
  reviewedAt: null,
  reason: null,
  hasIdCard: false,
  ...overrides,
});

// ── Rendering ─────────────────────────────────────────────────────────────────

// Renders `element` inside a router and a QueryClient whose cache holds `cache` ([key, data] pairs).
// The libraries are imported natively: Vite's SSR loader externalises them for the app modules too,
// so both sides share one React, one React Query and one router.
async function render(makeElement, { cache = [], path = '/' } = {}) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of cache) client.setQueryData(key, data);
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

// The visible text of some markup, entities decoded, whitespace collapsed.
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

// ── verification/api.js: requests ─────────────────────────────────────────────

test('uploadIdCard posts the multipart form and resolves with the status view', async () => {
  const view = statusView({ status: 'pending', submittedAt: '2026-10-29T05:00:00.000Z', hasIdCard: true });
  const calls = fakeApi({ 'POST /verification/id-card': () => ({ status: 201, data: view }) });
  const { uploadIdCard, buildIdCardForm } = await load('/src/features/verification/api.js');
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'card.jpg', { type: 'image/jpeg' });

  const res = await uploadIdCard(buildIdCardForm({ file, memberType: 'ug', department: 'u-ee' }));

  assert.deepEqual(res.data, view);
  assert.equal(calls.length, 1);
  const sent = calls[0].config.data;
  assert.ok(sent instanceof FormData);
  assert.equal(sent.get('memberType'), 'ug');
  assert.equal(sent.get('department'), 'u-ee');
  assert.equal(sent.get('idCard').name, 'card.jpg');
  // No hand-set "multipart/form-data" without a boundary: the browser has to write that header.
  assert.notEqual(String(calls[0].config.headers['Content-Type'] ?? ''), 'multipart/form-data');
});

test('buildIdCardForm puts the text fields before the file', async () => {
  const { buildIdCardForm } = await load('/src/features/verification/api.js');
  const file = new File(['%PDF-1.7'], 'card.pdf', { type: 'application/pdf' });
  const form = buildIdCardForm({ file, memberType: 'faculty', department: 'u-cse' });
  assert.deepEqual([...form.keys()], ['memberType', 'department', 'idCard']);
});

test('a failed upload rejects with the server message and request id, and fakes nothing', async () => {
  // The old client turned a 404 into a local "pending"; now every failure is a failure.
  for (const answer of [
    { status: 404, code: 'NOT_FOUND', message: 'Not found.' },
    { status: 503, code: 'SERVICE_UNAVAILABLE', message: "Uploads aren't configured" },
    {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '1 field is invalid.',
      details: [{ path: 'idCard', message: 'Use a JPG, PNG, WEBP or PDF file.' }],
    },
  ]) {
    fakeApi({ 'POST /verification/id-card': () => answer });
    const { uploadIdCard } = await load('/src/features/verification/api.js');
    store.getState().setSession('access', { _id: 'u1', verification: { status: 'unsubmitted' } });

    const err = await uploadIdCard(new FormData()).then(
      () => assert.fail('expected the upload to fail'),
      (e) => e,
    );

    assert.equal(err.status, answer.status);
    assert.equal(err.code, answer.code);
    assert.equal(err.message, answer.message);
    assert.equal(err.requestId, 'req-err');
    assert.equal(store.getState().user.verification.status, 'unsubmitted');
  }
});

test('getVerificationStatus reads the server and never falls back to the store', async () => {
  const { getVerificationStatus } = await load('/src/features/verification/api.js');
  const view = statusView({ status: 'rejected', reason: 'Blurred photo.', reviewedAt: '2026-10-29T06:00:00.000Z' });
  fakeApi({ 'GET /verification/status': () => ({ status: 200, data: view }) });
  assert.deepEqual((await getVerificationStatus()).data, view);

  fakeApi({ 'GET /verification/status': () => ({ status: 500, code: 'INTERNAL', message: 'Boom.' }) });
  store.getState().setSession('access', { _id: 'u1', verification: { status: 'approved' } });
  await assert.rejects(getVerificationStatus(), (e) => e.status === 500 && e.requestId === 'req-err');
});

test('getActiveOrgUnits asks GET /org-units without includeInactive', async () => {
  const calls = fakeApi({ 'GET /org-units': () => ({ status: 200, data: UNITS }) });
  const { getActiveOrgUnits } = await load('/src/features/verification/api.js');
  assert.deepEqual((await getActiveOrgUnits()).data, UNITS);
  assert.equal(calls[0].config.params?.includeInactive, undefined);
});

test('refreshCurrentUser stores the user from GET /auth/me', async () => {
  const me = { _id: 'u1', name: 'Rohan', verification: { status: 'pending' }, memberType: 'ug' };
  const calls = fakeApi({ 'GET /auth/me': () => ({ status: 200, data: me }) });
  const { refreshCurrentUser } = await load('/src/features/verification/api.js');
  store.getState().setSession('access', { _id: 'u1', verification: { status: 'unsubmitted' } });

  await refreshCurrentUser();

  assert.equal(calls[0].key, 'GET /auth/me');
  assert.deepEqual(store.getState().user, me);
  assert.equal(store.getState().accessToken, 'access');
});

// ── verification/api.js: helpers ──────────────────────────────────────────────

test('member types are the server enum, lower case, with readable labels', async () => {
  const { MEMBER_TYPES, MEMBER_TYPE_OPTIONS, memberTypeLabel } = await load('/src/features/verification/api.js');
  assert.deepEqual(MEMBER_TYPES, ['ug', 'pg', 'rs', 'faculty', 'staff']);
  assert.deepEqual(
    MEMBER_TYPE_OPTIONS.map((o) => o.value),
    MEMBER_TYPES,
  );
  for (const option of MEMBER_TYPE_OPTIONS) assert.notEqual(option.label, option.value);
  assert.equal(memberTypeLabel(null), 'Not set');
  assert.equal(memberTypeLabel('faculty'), 'Faculty');
});

test('checkIdCardFile allows jpg/png/webp/pdf up to 5 MB', async () => {
  const { checkIdCardFile } = await load('/src/features/verification/api.js');
  const file = (type, size) => ({ type, size, name: 'x' });
  assert.equal(checkIdCardFile(file('image/jpeg', 1000)), null);
  assert.equal(checkIdCardFile(file('image/png', 1000)), null);
  assert.equal(checkIdCardFile(file('image/webp', 1000)), null);
  assert.equal(checkIdCardFile(file('application/pdf', 5 * 1024 * 1024)), null);
  assert.match(checkIdCardFile(file('image/gif', 1000)), /JPG, PNG, WEBP or PDF/);
  assert.match(checkIdCardFile(file('image/png', 5 * 1024 * 1024 + 1)), /5 MB/);
  assert.match(checkIdCardFile(null), /Attach/);
});

test('email hints map to a member type and a department through the architecture.md §8 table', async () => {
  const { memberTypeFromHints, departmentCodeFromHints, departmentFromHints, formatEmailHints } = await load(
    '/src/features/verification/api.js',
  );
  assert.equal(memberTypeFromHints({ level: 'pg' }), 'pg');
  assert.equal(memberTypeFromHints({ level: 'xx' }), null);
  assert.equal(memberTypeFromHints(null), null);

  assert.equal(departmentCodeFromHints({ branch: 'cs' }), 'cse');
  assert.equal(departmentCodeFromHints({ branch: 'me' }), 'mech');
  assert.equal(departmentCodeFromHints({ branch: 'ee' }), 'ee');
  assert.equal(departmentFromHints({ branch: 'cs' }, UNITS)?._id, 'u-cse');
  assert.equal(departmentFromHints({ branch: 'zz' }, UNITS), null); // unknown: left blank
  assert.equal(departmentFromHints(null, UNITS), null);

  assert.equal(formatEmailHints({ year: 2024, level: 'ug', branch: 'cs', serial: '999' }), 'UG · CS · 2024 · #999');
  assert.equal(formatEmailHints(null), null);
});

test('groupUnits lists every active unit by type, each group by name', async () => {
  // Staff of a centre or a central facility pick their own unit, as the admin's dialog allows.
  const { groupUnits } = await load('/src/features/verification/api.js');
  const units = [
    ...UNITS,
    { _id: 'u-cw', code: 'cw', name: 'Central Workshop', type: 'central_facility', isActive: true },
    { _id: 'u-cc', code: 'cc', name: 'Computer Centre', type: 'central_facility', isActive: true },
  ];
  assert.deepEqual(
    groupUnits(units).map((g) => [g.label, g.units.map((u) => u.code)]),
    [
      ['Departments', ['cse', 'ee', 'mech']],
      ['Centres', ['dic']],
      ['Central facilities', ['cw', 'cc']],
    ],
  );
  assert.deepEqual(groupUnits(undefined), []);
});

test('departmentFromHints gives no hint for a branch that is not a department', async () => {
  const { departmentFromHints } = await load('/src/features/verification/api.js');
  // architecture.md §8's own example 2023pgcese01@: "cese" is no unit code.
  assert.equal(departmentFromHints({ level: 'pg', branch: 'cese' }, UNITS), null);
  // A branch equal to a centre's code is still no department hint.
  assert.equal(departmentFromHints({ branch: 'dic' }, UNITS), null);
  assert.equal(departmentFromHints({ branch: 'ee' }, UNITS)?._id, 'u-ee');
});

test('a large photo is compressed before the 5 MB check; a PDF is checked as it is', async () => {
  const { prepareIdCardFile, ID_CARD_MAX_BYTES } = await load('/src/features/verification/api.js');
  const big = (type, name) => new File([new Uint8Array(7 * 1024 * 1024)], name, { type });
  let compressed = 0;
  const shrink = async () => {
    compressed += 1;
    return new Blob([new Uint8Array(1024 * 1024)], { type: 'image/jpeg' });
  };

  // A 7 MB phone photo comes out at about 1 MB, which the server's 5 MB limit allows.
  const photo = await prepareIdCardFile(big('image/jpeg', 'card.jpg'), shrink);
  assert.equal(photo.error, undefined);
  assert.equal(photo.file.name, 'card.jpg');
  assert.equal(photo.file.type, 'image/jpeg');
  assert.ok(photo.file.size <= ID_CARD_MAX_BYTES);
  assert.equal(compressed, 1);

  // An image that can't be compressed is checked as it is.
  const broken = await prepareIdCardFile(big('image/png', 'card.png'), async () => {
    throw new Error('Could not decode');
  });
  assert.match(broken.error, /5 MB/);

  // A PDF isn't compressed, and a wrong type is refused before anything else.
  compressed = 0;
  assert.match((await prepareIdCardFile(big('application/pdf', 'card.pdf'), shrink)).error, /5 MB/);
  const gif = new File(['GIF89a'], 'card.gif', { type: 'image/gif' });
  assert.match((await prepareIdCardFile(gif, shrink)).error, /JPG, PNG, WEBP or PDF/);
  assert.equal(compressed, 0);
  const pdf = new File(['%PDF-1.7'], 'card.pdf', { type: 'application/pdf' });
  assert.equal((await prepareIdCardFile(pdf, shrink)).file, pdf);
  assert.match((await prepareIdCardFile(null, shrink)).error, /Attach/);
});

test('formatIstDateTime shows the instant in IST', async () => {
  const { formatIstDateTime } = await load('/src/features/verification/api.js');
  // 21:19 UTC on 28 Oct is 02:49 on 29 Oct in IST (UTC+05:30).
  const shown = formatIstDateTime('2026-10-28T21:19:35.000Z');
  assert.match(shown, /29 Oct 2026/);
  assert.match(shown, /02:49/);
  assert.match(shown, /IST$/);
  assert.equal(formatIstDateTime(null), null);
  assert.equal(formatIstDateTime('not a date'), null);
});

test('fieldErrorsFrom maps VALIDATION_ERROR details onto fields', async () => {
  const { fieldErrorsFrom } = await load('/src/features/verification/api.js');
  const err = {
    code: 'VALIDATION_ERROR',
    details: [
      { path: 'department', message: 'Must be an active unit.' },
      { path: 'department', message: 'Second message.' },
      { path: 'memberType', message: 'Required.' },
    ],
  };
  assert.deepEqual(fieldErrorsFrom(err), { department: 'Must be an active unit.', memberType: 'Required.' });
  assert.deepEqual(fieldErrorsFrom({ code: 'INVALID_TRANSITION', details: [] }), {});
  assert.deepEqual(fieldErrorsFrom(null), {});
});

// ── admin/api.js ──────────────────────────────────────────────────────────────

test('listVerifications sends status, page and limit and keeps meta', async () => {
  const items = [queueItem()];
  const calls = fakeApi({
    'GET /admin/verifications': () => ({ status: 200, data: items, meta: { page: 2, limit: 10, total: 11 } }),
  });
  const { listVerifications } = await load('/src/features/admin/api.js');

  const res = await listVerifications({ status: 'approved', page: 2 });

  assert.deepEqual(calls[0].config.params, { status: 'approved', page: 2, limit: 10 });
  assert.deepEqual(res.data, items);
  assert.deepEqual(res.meta, { page: 2, limit: 10, total: 11 });
});

test('getIdCardUrl asks the server on every call (the signed URL is never reused)', async () => {
  let n = 0;
  const calls = fakeApi({
    'GET /admin/verifications/user%2F1/id-card': () => ({
      status: 200,
      data: { url: `https://example.test/card-${++n}`, expiresAt: '2026-10-29T06:05:00.000Z' },
    }),
  });
  const { getIdCardUrl } = await load('/src/features/admin/api.js');

  const first = await getIdCardUrl('user/1');
  const second = await getIdCardUrl('user/1');

  assert.equal(calls.length, 2); // the id is URL-encoded, and each view is its own audited request
  assert.notEqual(first.data.url, second.data.url);
});

test('decideVerification sends the decision as a PATCH', async () => {
  const calls = fakeApi({
    'PATCH /admin/verifications/user-rohan': () => ({ status: 200, data: queueItem({ status: 'approved' }) }),
  });
  const { decideVerification } = await load('/src/features/admin/api.js');

  const res = await decideVerification('user-rohan', { decision: 'approve', memberType: 'ug', department: 'u-ee' });

  assert.equal(res.data.status, 'approved');
  assert.deepEqual(JSON.parse(calls[0].config.data), { decision: 'approve', memberType: 'ug', department: 'u-ee' });
});

test('readDecision needs a reason to reject and a member type and department to approve', async () => {
  const { readDecision } = await load('/src/features/admin/api.js');

  assert.deepEqual(readDecision({ decision: 'reject', reason: '  ' }).errors, {
    reason: 'A reason is required to reject.',
  });
  assert.match(readDecision({ decision: 'reject', reason: 'bad' }).errors.reason, /at least 5/);
  assert.match(readDecision({ decision: 'approve', reason: 'x'.repeat(501) }).errors.reason, /at most 500/);
  // Rejecting sends only the trimmed reason: the member picks again on re-upload.
  assert.deepEqual(
    readDecision({ decision: 'reject', reason: ' Blurred photo. ', memberType: 'ug', department: 'u-ee' }).body,
    { decision: 'reject', reason: 'Blurred photo.' },
  );

  const missing = readDecision({ decision: 'approve', memberType: '', department: '' });
  assert.equal(missing.body, null);
  assert.deepEqual(Object.keys(missing.errors).sort(), ['department', 'memberType']);
  assert.deepEqual(readDecision({ decision: 'approve', memberType: 'pg', department: 'u-cse' }).body, {
    decision: 'approve',
    memberType: 'pg',
    department: 'u-cse',
  });
  assert.equal(
    readDecision({ decision: 'approve', memberType: 'pg', department: 'u-cse', reason: 'Checked roll no.' }).body
      .reason,
    'Checked roll no.',
  );
  assert.ok(readDecision({ decision: 'maybe' }).errors.decision);
});

test('an approval note follows the same 5–500 rule as a rejection reason', async () => {
  // The server reads any non-empty reason as safeText(5, 500), so "OK" would be a 400.
  const { readDecision } = await load('/src/features/admin/api.js');
  const approve = { decision: 'approve', memberType: 'ug', department: 'u-ee' };
  const short = readDecision({ ...approve, reason: 'OK' });
  assert.equal(short.body, null);
  assert.match(short.errors.reason, /at least 5/);
  assert.deepEqual(readDecision({ ...approve, reason: '   ' }).body, approve); // blank: no note
});

test('a busy or aria-disabled Button keeps focus and swallows its click', async () => {
  // disabled would drop the focus of the keyboard user who pressed it to <body>.
  const { Button } = await load('/src/components/ui/Button.jsx');
  let clicks = 0;
  const onClick = () => (clicks += 1);
  for (const props of [{ loading: true }, { 'aria-disabled': true }]) {
    const button = Button({ ...props, onClick, children: 'Go' });
    assert.equal(button.props.disabled, undefined);
    assert.equal(button.props['aria-disabled'], true);
    let prevented = false;
    button.props.onClick({ preventDefault: () => (prevented = true) });
    assert.ok(prevented, 'the click (and the form submit it would start) is cancelled');
    assert.equal(clicks, 0);
  }
  const idle = Button({ onClick, 'aria-disabled': false, children: 'Go' });
  assert.equal(idle.props['aria-disabled'], undefined);
  idle.props.onClick({});
  assert.equal(clicks, 1);
  assert.equal(Button({ disabled: true, loading: true, children: 'Go' }).props.disabled, true);
});

test('Explore offers units that its mock resources can be filtered by', async () => {
  // /org-units is real now, but /resources isn't (Phase 4): getResources falls back to the mock
  // resources, which only the mock units' ids match.
  fakeApi({ 'GET /org-units': () => ({ status: 200, data: UNITS }) });
  const { getOrgUnits, getResources } = await load('/src/features/resources/api.js');
  const { MOCK_RESOURCES } = await load('/src/features/resources/mockData.js');
  const units = (await getOrgUnits()).data;
  let shownTotal = 0;
  for (const unit of units) {
    const shown = (await getResources({ orgUnit: unit._id })).data.resources;
    assert.ok(shown.every((r) => r.orgUnit._id === unit._id));
    shownTotal += shown.length;
  }
  assert.equal(shownTotal, MOCK_RESOURCES.length);
});

test('queue status, page and page count are read defensively', async () => {
  const { readQueueStatus, readPage, pageCount, adminKeys } = await load('/src/features/admin/api.js');
  assert.equal(readQueueStatus(null), 'pending');
  assert.equal(readQueueStatus('rejected'), 'rejected');
  assert.equal(readQueueStatus('unsubmitted'), 'pending');
  assert.equal(readPage('3'), 3);
  assert.equal(readPage('0'), 1);
  assert.equal(readPage('2.5'), 1);
  assert.equal(readPage('abc'), 1);
  assert.equal(pageCount({ page: 1, limit: 10, total: 0 }), 1);
  assert.equal(pageCount({ page: 1, limit: 10, total: 21 }), 3);
  // Every list key sits under the prefix a decision invalidates.
  assert.deepEqual(adminKeys.verificationList('pending', 2).slice(0, 2), adminKeys.verifications);
});

// ── VerificationPage ──────────────────────────────────────────────────────────

async function renderVerificationPage(view, user, { units = UNITS } = {}) {
  const { default: VerificationPage } = await load('/src/features/verification/VerificationPage.jsx');
  const { verificationKeys, orgUnitKeys } = await load('/src/features/verification/api.js');
  signIn(user);
  const cache = [[verificationKeys.status, { success: true, data: view, requestId: 'r' }]];
  if (units) cache.push([orgUnitKeys.active, { success: true, data: units, requestId: 'r' }]);
  return render((React) => React.createElement(VerificationPage), { cache, path: '/verification' });
}

const rohan = {
  _id: 'user-rohan',
  name: 'Rohan Mehta',
  roles: ['member'],
  memberType: null,
  department: null,
  verification: { status: 'unsubmitted', reason: null, submittedAt: null },
  emailHints: { year: 2026, level: 'ug', branch: 'cs', serial: '012' },
};

test('the form lists active units from /org-units and pre-fills from the email hints', async () => {
  const html = await renderVerificationPage(statusView(), rohan);

  // Units come from the API: every active one, grouped by type.
  assert.match(html, /<option value="u-cse" selected="">Computer Science and Engineering<\/option>/);
  assert.match(html, />Mechanical Engineering</);
  assert.doesNotMatch(html, /Applied Old Things/);
  assert.match(html, /<optgroup label="Centres"><option value="u-dic">Design and Innovation Centre<\/option>/);
  // Member types are the backend enum with labels, UG chosen from the hint.
  assert.match(html, /<option value="ug" selected="">Undergraduate \(UG\)<\/option>/);
  for (const value of ['pg', 'rs', 'faculty', 'staff']) assert.match(html, new RegExp(`<option value="${value}">`));
  assert.match(text(html), /Pre-filled from your email address/);
  // No demo shortcuts that fake an approval.
  assert.doesNotMatch(text(html), /Instant Verify|Simulate Admin Approval/i);
});

test('an earlier submission wins over the email hints', async () => {
  const view = statusView({
    status: 'rejected',
    reason: 'Blurred photo.',
    memberType: 'pg',
    department: { _id: 'u-mech', code: 'mech', name: 'Mechanical Engineering' },
  });
  // The rejected card shows the re-upload button; the form itself opens on click, so render it
  // directly through an unsubmitted view carrying the same choices.
  const html = await renderVerificationPage({ ...view, status: 'unsubmitted' }, rohan);
  assert.match(html, /<option value="pg" selected="">/);
  assert.match(html, /<option value="u-mech" selected="">/);
});

test('a member of a centre can pick it, and it pre-fills after a rejection', async () => {
  const view = statusView({
    memberType: 'staff',
    department: { _id: 'u-dic', code: 'dic', name: 'Design and Innovation Centre' },
  });
  const html = await renderVerificationPage(view, { ...rohan, emailHints: null });
  assert.match(html, /<option value="u-dic" selected="">Design and Innovation Centre<\/option>/);
});

test('the file input is named by its visible label and marked required', async () => {
  const html = await renderVerificationPage(statusView(), rohan);
  const input = html.match(/<input[^>]*type="file"[^>]*>/)?.[0];
  assert.ok(input);
  const labelId = input.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelId, 'aria-labelledby is set');
  const escaped = labelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(html, new RegExp(`id="${escaped}"[^>]*>ID card image or PDF<`));
  assert.match(input, /aria-required="true"/);
});

// Card's colours come from its variant: cn() doesn't resolve conflicts, so a second bg-*, text-* or
// border colour in className loses or wins by stylesheet order (bg-white beats every bg-[#…]).
function cardColourConflicts(html) {
  const conflicts = [];
  for (const [, cls] of html.matchAll(/<div class="(rounded-xl border-2 p-6[^"]*)"/g)) {
    const tokens = cls.split(/\s+/);
    const count = (re) => tokens.filter((t) => re.test(t)).length;
    const bg = count(/^bg-(white|black|transparent|\[#[0-9a-f]+\](\/\d+)?)$/i);
    const text = count(/^text-(white|black|\[#[0-9a-f]+\](\/\d+)?)$/i);
    const border = count(/^border-(white|black|\[#[0-9a-f]+\])(\/\d+)?$/i);
    if (bg > 1 || text > 1 || border > 1) conflicts.push(cls);
  }
  return conflicts;
}

test('no verification card sets two competing colours (the hint card was white on white)', async () => {
  const pages = [
    await renderVerificationPage(statusView(), rohan),
    await renderVerificationPage(statusView({ status: 'pending', hasIdCard: true }), rohan),
    await renderVerificationPage(statusView({ status: 'rejected', reason: 'Blurred photo.' }), rohan),
    await renderVerificationPage(statusView({ status: 'approved' }), rohan),
  ];
  for (const html of pages) assert.deepEqual(cardColourConflicts(html), []);
  // The email-hint card is the dark forest card its white text was written for.
  assert.match(pages[0], /<div class="rounded-xl border-2 p-6[^"]*bg-\[#183d2d\][^"]*"><p[^>]*>.*?From your email address/);
});

test('pending shows the submission in IST, and offers an upload when no image is on file', async () => {
  const view = statusView({
    status: 'pending',
    submittedAt: '2026-10-28T21:19:35.000Z',
    memberType: 'ug',
    department: { _id: 'u-ee', code: 'ee', name: 'Electrical Engineering' },
    hasIdCard: false,
  });
  const shown = text(await renderVerificationPage(view, { ...rohan, verification: { status: 'pending' } }));

  assert.match(shown, /Under review/);
  assert.match(shown, /SUBMITTED: 29 Oct 2026, 02:49 am IST/i);
  assert.match(shown, /Electrical Engineering/);
  assert.match(shown, /We don't have an ID image/);
  assert.match(shown, /Upload ID card/);
});

test('rejected shows the reason and a re-upload option', async () => {
  const view = statusView({
    status: 'rejected',
    reason: 'The ID card has expired.',
    reviewedAt: '2026-10-29T06:00:00.000Z',
  });
  const shown = text(await renderVerificationPage(view, { ...rohan, verification: { status: 'rejected' } }));
  assert.match(shown, /The ID card has expired\./);
  assert.match(shown, /Upload a new ID card/);
  assert.doesNotMatch(shown, /illegible/); // the old hard-coded reason
});

test('approved shows the confirmed member type and department', async () => {
  const view = statusView({
    status: 'approved',
    memberType: 'faculty',
    department: { _id: 'u-cse', code: 'cse', name: 'Computer Science and Engineering' },
    reviewedAt: '2026-10-29T06:00:00.000Z',
  });
  const shown = text(await renderVerificationPage(view, { ...rohan, verification: { status: 'approved' } }));
  assert.match(shown, /You're verified/);
  assert.match(shown, /MEMBER TYPE: Faculty/);
  assert.match(shown, /DEPARTMENT: Computer Science and Engineering/);
  assert.doesNotMatch(shown, /Submit for verification/);
});

// ── Admin queue ───────────────────────────────────────────────────────────────

async function renderQueue(
  items,
  meta,
  { path = '/admin/verifications', status = 'pending', page = 1, me = 'admin-1' } = {},
) {
  const { default: VerificationQueuePage } = await load('/src/features/admin/VerificationQueuePage.jsx');
  const { adminKeys } = await load('/src/features/admin/api.js');
  const { orgUnitKeys } = await load('/src/features/verification/api.js');
  signIn({ _id: me, roles: ['member', 'admin'] });
  return render((React) => React.createElement(VerificationQueuePage), {
    path,
    cache: [
      [adminKeys.verificationList(status, page), { success: true, data: items, meta, requestId: 'r' }],
      [orgUnitKeys.active, { success: true, data: UNITS, requestId: 'r' }],
    ],
  });
}

test('the queue lists name, email, hints and the IST submission time, pending first', async () => {
  const html = await renderQueue([queueItem()], { page: 1, limit: 10, total: 1 });
  const shown = text(html);

  assert.match(html, /aria-pressed="true"[^>]*>Pending</);
  assert.match(shown, /Rohan Mehta/);
  assert.match(shown, /newstudent@demo\.campuscommons\.test/);
  assert.match(shown, /UG · EE · 2026/);
  assert.match(shown, /29 Oct 2026, 02:49 am IST/i);
  assert.match(shown, /1 verification · oldest first/);
  // The seeded newstudent@ has no image: View ID is disabled and says why; deciding still works.
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-describedby="queue-user-rohan-no-card"/);
  assert.match(shown, /No ID image on file/);
  assert.match(shown, /Approve(?!d)/);
  assert.match(shown, /Reject(?!ed)/);
});

test('an admin cannot decide on their own verification', async () => {
  const shown = text(await renderQueue([queueItem()], { page: 1, limit: 10, total: 1 }, { me: 'user-rohan' }));
  assert.match(shown, /Another administrator must review your own verification/);
  assert.doesNotMatch(shown, /Approve(?!d)|Reject(?!ed)/); // not the "Approved"/"Rejected" filters
});

test('hints that disagree with the chosen member type are flagged', async () => {
  const item = queueItem();
  item.user.memberType = 'pg';
  const shown = text(await renderQueue([item], { page: 1, limit: 10, total: 1 }));
  assert.match(shown, /Email says UG/);
});

test('a branch that is no unit code is not flagged as a department mismatch', async () => {
  // architecture.md §8's 2023pgcese01@: "cese" gives no hint, so it can't disagree with CSE.
  const pg = queueItem();
  pg.user.emailHints = { year: 2023, level: 'pg', branch: 'cese', serial: '01' };
  pg.user.memberType = 'pg';
  pg.user.department = { _id: 'u-cse', code: 'cse', name: 'Computer Science and Engineering' };
  assert.doesNotMatch(text(await renderQueue([pg], { page: 1, limit: 10, total: 1 })), /Email says/);

  // A branch that maps to another department still is.
  const other = queueItem();
  other.user.emailHints = { year: 2024, level: 'ug', branch: 'cs', serial: '999' };
  assert.match(text(await renderQueue([other], { page: 1, limit: 10, total: 1 })), /Email says CSE/);
});

test('the approve form still works when GET /org-units failed', async () => {
  const { DecisionForm } = await load('/src/features/admin/components/DecisionDialog.jsx');
  const form = (props) =>
    render((React) =>
      React.createElement(DecisionForm, {
        item: queueItem(),
        initialDecision: 'approve',
        request: { error: null, isPending: false },
        onSubmit: () => {},
        onCancel: () => {},
        onReloadUnits: () => {},
        ...props,
      }),
    );

  const failed = await form({
    units: undefined,
    unitsError: { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try later.', requestId: 'req-units' },
  });
  // The member's own unit stays choosable (the server checks it is active), with a way to reload.
  assert.match(failed, /<option value="u-ee" selected="">Electrical Engineering \(their choice\)<\/option>/);
  assert.match(text(failed), /Reload units/);
  assert.match(text(failed), /req-units/);
  assert.doesNotMatch(text(failed), /Loading units/);

  const loaded = await form({ units: UNITS, unitsError: null });
  assert.match(loaded, /<optgroup label="Departments">/);
  assert.match(loaded, /<option value="u-ee" selected="">Electrical Engineering<\/option>/);
  assert.doesNotMatch(text(loaded), /Reload units|their choice/);
  assert.match(text(loaded), /Optional, 5–500 characters/);
});

test('page buttons stay focusable: aria-disabled, never disabled', async () => {
  const html = await renderQueue(
    Array.from({ length: 10 }, (_, i) => {
      const item = queueItem();
      item.user = { ...item.user, _id: `user-${i}` };
      return item;
    }),
    { page: 1, limit: 10, total: 25 },
  );
  // While a page loads (on mount too: the cached page is stale) both are aria-disabled; on the
  // first page Previous is. Neither is ever disabled, which would drop focus to <body>.
  const nav = html.slice(html.indexOf('<nav aria-label="Pages"'), html.indexOf('</nav>'));
  assert.equal((nav.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(nav, /disabled=""/);
  assert.match(nav, /<button[^>]*aria-disabled="true"[^>]*>.*?Previous/);
});

test('decided rows have no decision buttons and show the reason', async () => {
  const item = queueItem({
    status: 'rejected',
    reason: 'The ID card has expired.',
    reviewedAt: '2026-10-29T06:00:00.000Z',
  });
  const html = await renderQueue(
    [item],
    { page: 1, limit: 10, total: 1 },
    {
      path: '/admin/verifications?status=rejected',
      status: 'rejected',
    },
  );
  const shown = text(html);
  assert.match(html, /aria-pressed="true"[^>]*>Rejected</);
  assert.match(shown, /The ID card has expired\./);
  assert.match(shown, /Image deleted after the decision/);
  assert.doesNotMatch(shown, /Approve(?!d)|Reject(?!ed)/);
});

test('an empty status shows the empty state, and many rows paginate', async () => {
  const empty = text(await renderQueue([], { page: 1, limit: 10, total: 0 }));
  assert.match(empty, /No ID cards waiting/);

  const many = Array.from({ length: 10 }, (_, i) => {
    const item = queueItem();
    item.user = { ...item.user, _id: `user-${i}`, name: `Student ${i}` };
    return item;
  });
  const html = await renderQueue(
    many,
    { page: 2, limit: 10, total: 25 },
    {
      path: '/admin/verifications?page=2',
      page: 2,
    },
  );
  const shown = text(html);
  assert.match(shown, /Page 2 of 3/);
  assert.match(shown, /25 verifications/);
  assert.match(html, /<nav aria-label="Pages"/);
});
