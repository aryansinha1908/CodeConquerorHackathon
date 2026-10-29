// Tests for the incident pages and the admin audit log (frontend.md §6.2 /incidents/new and
// /incidents/:id, §6.3 /manage/incidents, §6.4 /admin/incidents and /admin/audit; judge steps
// 10–12). Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/bookings.test.mjs. Requests go to a
// fake axios adapter; pages render with react-dom/server from a pre-filled React Query cache holding
// data shaped exactly as docs/api.md "Incidents" and "Audit" describe (populated booking, resource,
// orgUnit, reportedBy and comments; AuditEntry with changes and meta objects), so a crash such as
// rendering an object as text shows up here.
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

// ── Fakes ─────────────────────────────────────────────────────────────────────

// routes: { 'POST /incidents': (config) => answer }. An answer is { status, data, meta } or
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

const INC = '6720000000000000000000a1';
const INC_SYS = '6720000000000000000000a2';
const BOOKING = '6720000000000000000000b1';
const RESOURCE = '6720000000000000000000c1';
const UNIT = '6720000000000000000000d1';
const BORROWER_ID = '6720000000000000000000e1';
const MANAGER_ID = '6720000000000000000000e2';
const ADMIN_ID = '6720000000000000000000e3';

const PHOTO = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000000/campuscommons/photos/a1.jpg',
  publicId: 'campuscommons/photos/a1',
};

const DEPARTMENT = { _id: 'u-cse', code: 'cse', name: 'Computer Science and Engineering' };

const BORROWER = {
  _id: BORROWER_ID,
  name: 'Aarav Student',
  roles: ['member'],
  memberType: 'ug',
  managedOrgUnits: [],
  verification: { status: 'approved', reason: null, submittedAt: null },
};
const MANAGER = {
  _id: MANAGER_ID,
  name: 'Priya Manager',
  roles: ['member', 'manager'],
  memberType: 'staff',
  managedOrgUnits: [UNIT],
  verification: { status: 'approved', reason: null, submittedAt: null },
};
const ADMIN = {
  _id: ADMIN_ID,
  name: 'Asha Admin',
  roles: ['member', 'admin'],
  memberType: 'staff',
  managedOrgUnits: [],
  verification: { status: 'approved', reason: null, submittedAt: null },
};

// IncidentDetail (GET /incidents/:id, POST /incidents, POST …/comments).
const detail = (overrides = {}) => ({
  _id: INC,
  status: 'open',
  source: 'manager',
  type: 'damage',
  severity: 'low',
  description: 'Deep scratch across the print bed, found at the return check.',
  photos: [PHOTO],
  booking: {
    _id: BOOKING,
    status: 'flagged',
    start: '2026-11-03T04:30:00.000Z',
    end: '2026-11-03T06:30:00.000Z',
    borrower: { _id: BORROWER_ID, name: 'Aarav Student', memberType: 'ug', department: DEPARTMENT },
  },
  resource: { _id: RESOURCE, title: 'FDM 3D Printer #2', slug: 'fdm-3d-printer-2' },
  orgUnit: { _id: UNIT, name: 'Design and Innovation Centre', code: 'dic' },
  reportedBy: { _id: MANAGER_ID, name: 'Priya Manager' },
  comments: [
    {
      _id: 'c1',
      by: { _id: MANAGER_ID, name: 'Priya Manager' },
      text: 'Can you say when you noticed it?',
      at: '2026-11-03T08:00:00.000Z',
    },
    {
      _id: 'c2',
      by: { _id: BORROWER_ID, name: 'Aarav Student' },
      text: 'It was there at check-in too, see my report.',
      at: '2026-11-03T08:30:00.000Z',
    },
  ],
  resolution: null,
  aiSummary: null,
  createdAt: '2026-11-03T07:30:00.000Z',
  updatedAt: '2026-11-03T08:30:00.000Z',
  canComment: true,
  canResolve: true,
  ...overrides,
});

const RESOLUTION = {
  outcome: 'warning',
  rationale: 'Minor scratch; the borrower was reminded to clean the bed.',
  decidedBy: { _id: ADMIN_ID, name: 'Asha Admin' },
  at: '2026-11-03T10:00:00.000Z',
};

// IncidentListItem: no photos, comments, aiSummary, canComment, canResolve; commentCount instead.
const listItem = (overrides = {}) => {
  const { photos: _p, comments: _c, aiSummary: _a, canComment: _cc, canResolve: _cr, ...rest } = detail();
  return { ...rest, commentCount: 2, ...overrides };
};

const systemItem = () =>
  listItem({
    _id: INC_SYS,
    source: 'system',
    type: 'delay',
    severity: 'medium',
    reportedBy: null,
    booking: undefined,
    description: 'Returned 2 h 10 min after the booking ended.',
    commentCount: 1,
  });

// GET /bookings/:id for the report form.
const bookingDetail = (overrides = {}) => ({
  _id: BOOKING,
  resource: {
    _id: RESOURCE,
    title: 'FDM 3D Printer #2',
    slug: 'fdm-3d-printer-2',
    location: { building: 'Design and Innovation Centre', room: 'Prototyping Lab' },
    bookingMode: 'slot',
    checklist: ['Nozzle clean'],
  },
  orgUnit: { _id: UNIT, name: 'Design and Innovation Centre', code: 'dic' },
  borrower: { _id: BORROWER_ID, name: 'Aarav Student', memberType: 'ug', department: DEPARTMENT },
  start: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  end: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  purpose: 'Printing the chassis for the robotics club',
  status: 'checked_out',
  eligibilitySnapshot: [],
  incidents: [],
  flags: { overdue: false },
  allowedActions: [],
  isOverdue: false,
  waitlistPosition: null,
  createdAt: '2026-10-28T21:19:35.000Z',
  updatedAt: '2026-10-29T06:00:00.000Z',
  __v: 0,
  ...overrides,
});

// A resource card (GET /resources).
const card = (overrides = {}) => ({
  _id: RESOURCE,
  title: 'FDM 3D Printer #2',
  slug: 'fdm-3d-printer-2',
  images: [],
  category: 'equipment',
  bookingMode: 'slot',
  quantity: 1,
  riskLevel: 'medium',
  status: 'active',
  orgUnit: { _id: UNIT, name: 'Design and Innovation Centre', code: 'dic', type: 'centre' },
  ...overrides,
});

// AuditEntry (GET /audit).
const AUDIT_ENTRIES = [
  {
    _id: 'log2',
    at: '2026-11-03T10:00:00.000Z',
    action: 'booking.completed',
    actor: { id: null, role: 'system', name: null },
    entity: { type: 'booking', id: BOOKING },
    orgUnit: { _id: UNIT, name: 'Design and Innovation Centre', code: 'dic' },
    changes: { status: ['flagged', 'completed'] },
    meta: { incidentId: INC, closedAt: '2026-11-03T10:00:00.000Z' },
  },
  {
    _id: 'log1',
    at: '2026-10-29T06:00:00.000Z',
    action: 'booking.approved',
    actor: { id: MANAGER_ID, role: 'manager', name: 'Priya Manager' },
    entity: { type: 'booking', id: BOOKING },
    orgUnit: { _id: UNIT, name: 'Design and Innovation Centre', code: 'dic' },
    reason: 'Earliest request for the slot.',
    changes: { status: ['pending', 'approved'], decision: [null, { action: 'approve' }] },
    requestId: 'req-123',
  },
];

// ── Rendering ─────────────────────────────────────────────────────────────────

async function render(makeElement, { cache = [], path = '/', route } = {}) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of cache) client.setQueryData(key, data);
  const element = makeElement(React);
  const routed = route
    ? React.createElement(Routes, null, React.createElement(Route, { path: route, element }))
    : element;
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(MemoryRouter, { initialEntries: [path] }, routed),
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

// Renders `useHook` once and hands back its result, with a QueryClient that records invalidations.
async function withHook(useHook, { cache = [] } = {}) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const [key, data] of cache) client.setQueryData(key, data);
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
    React.createElement(QueryClientProvider, { client }, React.createElement(Probe, { onResult: (v) => results.push(v) })),
  );
  return { result: results[results.length - 1], invalidated, client };
}

const api = () => load('/src/features/incidents/api.js');
const view = () => load('/src/features/incidents/components/incidentView.js');
const audit = () => load('/src/features/admin/auditApi.js');

// ── api.js: requests ────────────────────────────────────────────────────────

test('POST /incidents: with a booking only bookingId; without one resourceId; photos as { url, publicId }', async () => {
  const { createIncident } = await api();
  const calls = fakeApi({ 'POST /incidents': () => ({ status: 201, data: detail() }) });
  const res = await createIncident({
    bookingId: BOOKING,
    resourceId: RESOURCE,
    type: 'damage',
    severity: 'low',
    description: '  Deep scratch across the print bed, found at the return check. ',
    photos: [{ ...PHOTO, preview: 'blob:x' }, { url: 'nope' }],
  });
  assert.equal(res.data._id, INC);
  assert.equal(res.meta, undefined);
  assert.deepEqual(calls[0].body, {
    bookingId: BOOKING,
    type: 'damage',
    severity: 'low',
    description: 'Deep scratch across the print bed, found at the return check.',
    photos: [PHOTO],
  });

  await createIncident({ resourceId: RESOURCE, type: 'safety', severity: 'high', description: 'Sparks from the power supply when switched on.' });
  assert.deepEqual(calls[1].body, {
    resourceId: RESOURCE,
    type: 'safety',
    severity: 'high',
    description: 'Sparks from the power supply when switched on.',
  }, 'no photos key when there are none, and no other key the server would refuse');
});

test('GET /incidents sends the canonical status list and only valid filters; { data, meta } comes back', async () => {
  const { listIncidents } = await api();
  const calls = fakeApi({
    'GET /incidents': () => ({ status: 200, data: [listItem()], meta: { page: 2, limit: 50, total: 51 } }),
  });
  const res = await listIncidents({
    status: 'in_review,open',
    type: 'damage',
    severity: 'extreme',
    resourceId: 'not-an-id',
    page: 2,
    limit: 500,
  });
  assert.deepEqual(calls[0].params, { status: 'open,in_review', type: 'damage', page: 2, limit: 50 });
  assert.equal(res.data[0].commentCount, 2);
  assert.deepEqual(res.meta, { page: 2, limit: 50, total: 51 });

  await listIncidents({ status: ['open', 'in_review', 'resolved'], resourceId: RESOURCE });
  assert.deepEqual(calls[1].params, { resourceId: RESOURCE, page: 1, limit: 20 }, 'every status is no filter');
});

test('detail, comment and resolve go to the encoded path with trimmed text; errors come back normalised', async () => {
  const { getIncident, commentOnIncident, resolveIncident } = await api();
  const calls = fakeApi({
    [`GET /incidents/${INC}`]: () => ({ status: 200, data: detail() }),
    [`POST /incidents/${INC}/comments`]: () => ({ status: 201, data: detail({ status: 'in_review' }) }),
    [`POST /incidents/${INC}/resolve`]: () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'Someone else resolved this incident just now.',
    }),
    'GET /incidents/a%2Fb': () => ({ status: 404, code: 'NOT_FOUND', message: 'Incident not found.' }),
  });
  assert.equal((await getIncident(INC)).data.canResolve, true);
  const commented = await commentOnIncident(INC, { text: '  On my way to check.  ' });
  assert.deepEqual(calls[1].body, { text: 'On my way to check.' });
  assert.equal(commented.data.status, 'in_review');

  const err = await rejection(resolveIncident(INC, { outcome: 'warning', rationale: ' Reminded them. ' }));
  assert.deepEqual(calls[2].body, { outcome: 'warning', rationale: 'Reminded them.' });
  assert.equal(err.status, 409);
  assert.equal(err.code, 'INVALID_TRANSITION');
  assert.equal(err.requestId, 'req-err');

  const missing = await rejection(getIncident('a/b'));
  assert.equal(missing.message, 'Incident not found.');
});

test('the report picker asks for active and maintenance resources (the server scopes them to the units)', async () => {
  const { listReportableResources, reportableResourceParams } = await api();
  const calls = fakeApi({ 'GET /resources': () => ({ status: 200, data: [card()], meta: { page: 1, limit: 20, total: 1 } }) });
  await listReportableResources({ q: '  printer ', limit: 20 });
  assert.deepEqual(calls[0].params, { status: 'active,maintenance', q: 'printer', limit: 20 });
  assert.deepEqual(reportableResourceParams({}), { status: 'active,maintenance', limit: 20 });
  assert.equal(reportableResourceParams({ limit: 999 }).limit, 50);
});

// ── api.js: pure helpers ──────────────────────────────────────────────────────

test('statusParam orders the list, and treats every status or an unknown one as "all"', async () => {
  const { statusParam } = await api();
  assert.equal(statusParam('in_review,open'), 'open,in_review');
  assert.equal(statusParam(['resolved']), 'resolved');
  assert.equal(statusParam(' open , open '), 'open');
  assert.equal(statusParam('open,in_review,resolved'), '');
  assert.equal(statusParam('open,closed'), '');
  assert.equal(statusParam(undefined), '');
});

test('list URL: unresolved by default, the admin view high severity by default, and "all" survives a reload', async () => {
  const { readIncidentFilters, writeIncidentFilters, hasCustomFilters } = await api();
  const read = (qs, scope) => readIncidentFilters(new URLSearchParams(qs), scope);

  assert.deepEqual(read('', 'manage'), { status: 'open,in_review', type: '', severity: '', resourceId: '', page: 1 });
  assert.deepEqual(read('', 'admin'), { status: 'open,in_review', type: '', severity: 'high', resourceId: '', page: 1 });
  assert.equal(read('severity=all', 'admin').severity, '');
  assert.equal(read('status=all').status, '');
  assert.equal(read('status=in_review,open').status, 'open,in_review');
  assert.equal(read('status=open,in_review,resolved').status, '', 'every status listed is all');
  assert.equal(read('status=bogus').status, 'open,in_review', 'an unknown status falls back to the default');
  assert.equal(read('type=flood&resourceId=abc&page=3').type, '');
  assert.equal(read('type=flood&resourceId=abc&page=3').resourceId, '');
  assert.equal(read(`resourceId=${RESOURCE}&page=3`).resourceId, RESOURCE);
  assert.equal(read('page=3').page, 3);

  // A default is left out of the URL; "all" against a non-"all" default is written; filters reset the page.
  const start = new URLSearchParams('page=4');
  assert.equal(writeIncidentFilters(start, { severity: '' }, 'admin').toString(), 'severity=all');
  assert.equal(writeIncidentFilters(start, { severity: 'high' }, 'admin').toString(), '');
  assert.equal(writeIncidentFilters(start, { status: '' }, 'manage').toString(), 'status=all');
  assert.equal(writeIncidentFilters(start, { status: 'open,in_review' }, 'manage').toString(), '');
  assert.equal(writeIncidentFilters(start, { status: 'resolved', type: 'delay' }, 'manage').toString(), 'status=resolved&type=delay');
  assert.equal(writeIncidentFilters(new URLSearchParams('type=delay'), { page: 2 }).toString(), 'type=delay&page=2');
  assert.equal(writeIncidentFilters(new URLSearchParams('page=2'), { page: 1 }).toString(), '');

  assert.equal(hasCustomFilters(read('', 'admin'), 'admin'), false);
  assert.equal(hasCustomFilters(read('severity=all', 'admin'), 'admin'), true);
  assert.equal(hasCustomFilters(read('page=2', 'manage'), 'manage'), false, 'the page is not a filter');
});

test('validateIncident checks type, severity, the 20–2000 description and a resource without a booking', async () => {
  const { validateIncident } = await api();
  const good = { bookingId: BOOKING, type: 'damage', severity: 'low', description: 'A deep scratch on the print bed.' };
  assert.deepEqual(validateIncident(good), {});
  const bad = validateIncident({ type: 'flood', severity: '', description: '  too short   ' });
  assert.deepEqual(Object.keys(bad).sort(), ['description', 'resourceId', 'severity', 'type']);
  assert.match(bad.description, /at least 20 characters \(now 9\)/);
  assert.equal(validateIncident({ ...good, description: '' }).description, 'Describe what happened.');
  assert.match(validateIncident({ ...good, description: 'x'.repeat(2001) }).description, /at most 2000/);
  assert.deepEqual(validateIncident({ ...good, bookingId: undefined, resourceId: RESOURCE }), {});
});

test('server errors on a report land beside the fields; the rest are listed', async () => {
  const { incidentErrorsFrom } = await api();
  const err = {
    code: 'VALIDATION_ERROR',
    details: [
      { path: 'description', message: 'Must be at least 20 characters.' },
      { path: 'photos.1', message: 'Must be a photo uploaded through /uploads/images.' },
      { path: 'bookingId', message: 'Must be a valid id.' },
      { path: 'resourceId', message: "Isn't the booking's resource." },
    ],
  };
  assert.deepEqual(incidentErrorsFrom(err), {
    fields: {
      description: 'Must be at least 20 characters.',
      photos: 'Must be a photo uploaded through /uploads/images.',
      resourceId: "Isn't the booking's resource.",
    },
    other: ['Must be a valid id.'],
  });
  assert.deepEqual(incidentErrorsFrom({ code: 'INVALID_TRANSITION', message: 'x' }), { fields: {}, other: [] });
});

test('a comment is 1–1000 characters; a resolution needs an outcome, a rationale, and a booking for a strike', async () => {
  const { readComment, validateResolution } = await api();
  assert.deepEqual(readComment('  Looking now. '), { value: 'Looking now.', error: null });
  assert.equal(readComment('   ').error, 'Write a comment first.');
  assert.match(readComment('x'.repeat(1001)).error, /at most 1000/);

  assert.deepEqual(validateResolution({ outcome: 'warning', rationale: 'Reminded them.' }), {});
  const empty = validateResolution({});
  assert.deepEqual(Object.keys(empty).sort(), ['outcome', 'rationale']);
  assert.match(validateResolution({ outcome: 'strike', rationale: 'x', hasBooking: false }).outcome, /isn't tied to a booking/);
  assert.deepEqual(validateResolution({ outcome: 'strike', rationale: 'Repeated misuse.', hasBooking: true }), {});
  assert.match(validateResolution({ outcome: 'no_action', rationale: 'y'.repeat(1001) }).rationale, /at most 1000/);
});

test('what an incident change makes stale (frontend.md §8.2)', async () => {
  const { incidentKeysToInvalidate, incidentKeys } = await api();
  assert.deepEqual(incidentKeysToInvalidate({}), [['incidents']]);
  assert.deepEqual(incidentKeysToInvalidate({ bookingId: BOOKING }), [['incidents'], ['booking', BOOKING]]);
  assert.deepEqual(incidentKeysToInvalidate({ bookingId: BOOKING, resolved: true }), [
    ['incidents'],
    ['booking', BOOKING],
    ['bookings'],
  ]);
  assert.deepEqual(incidentKeys.detail(INC), ['incident', INC]);
  assert.deepEqual(incidentKeys.list({ status: 'open,in_review' }), ['incidents', { status: 'open,in_review', page: 1, limit: 20 }]);
});

// ── api.js: hooks ─────────────────────────────────────────────────────────────

test('resolving stores the server answer (without bookingClosed) and refreshes the lists and the booking', async () => {
  const { useResolveIncident, incidentKeys } = await api();
  fakeApi({
    [`POST /incidents/${INC}/resolve`]: () => ({
      status: 200,
      data: { ...detail({ status: 'resolved', resolution: RESOLUTION, canComment: false, canResolve: false }), booking: { ...detail().booking, status: 'completed' }, bookingClosed: true },
    }),
  });
  const { result, invalidated, client } = await withHook(useResolveIncident, {
    cache: [[incidentKeys.detail(INC), { data: detail() }]],
  });
  const res = await result.mutateAsync({ id: INC, outcome: 'warning', rationale: 'Reminded them.' });
  assert.equal(res.data.bookingClosed, true);
  assert.deepEqual(invalidated, [['incidents'], ['booking', BOOKING], ['bookings']]);
  const cached = client.getQueryData(incidentKeys.detail(INC)).data;
  assert.equal(cached.status, 'resolved');
  assert.equal('bookingClosed' in cached, false);
  client.clear();
});

test('a comment refused because the incident was resolved meanwhile refetches it; nothing is changed first', async () => {
  const { useAddComment, incidentKeys } = await api();
  fakeApi({
    [`POST /incidents/${INC}/comments`]: () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'This incident was resolved just now, so its thread is closed.',
    }),
  });
  const { result, invalidated, client } = await withHook(useAddComment, {
    cache: [[incidentKeys.detail(INC), { data: detail() }]],
  });
  const err = await rejection(result.mutateAsync({ id: INC, text: 'Hello' }));
  assert.equal(err.code, 'INVALID_TRANSITION');
  assert.deepEqual(invalidated, [['incident', INC]]);
  assert.equal(client.getQueryData(incidentKeys.detail(INC)).data.comments.length, 2, 'no optimistic comment');
  client.clear();
});

test('a new report is cached as its own detail and refreshes the incident lists and its booking', async () => {
  const { useCreateIncident, incidentKeys } = await api();
  fakeApi({ 'POST /incidents': () => ({ status: 201, data: detail({ comments: [], source: 'user' }) }) });
  const { result, invalidated, client } = await withHook(useCreateIncident);
  await result.mutateAsync({ bookingId: BOOKING, type: 'damage', severity: 'low', description: 'A deep scratch on the print bed.' });
  assert.deepEqual(invalidated, [['incidents'], ['booking', BOOKING]]);
  assert.equal(client.getQueryData(incidentKeys.detail(INC)).data.source, 'user');
  client.clear();
});

// ── incidentView.js ─────────────────────────────────────────────────────────

test('scope and routes: the manage and admin consoles keep their own detail routes and headings', async () => {
  const { incidentScopeOf, incidentPath, incidentListPath, headingsFor, auditPath } = await view();
  assert.equal(incidentScopeOf('/manage/incidents/x'), 'manage');
  assert.equal(incidentScopeOf('/admin/incidents/x'), 'admin');
  assert.equal(incidentScopeOf('/incidents/x'), 'member');
  assert.equal(incidentScopeOf('/managers'), 'member');
  assert.equal(incidentPath('a b', 'manage'), '/manage/incidents/a%20b');
  assert.equal(incidentPath(INC, 'admin'), `/admin/incidents/${INC}`);
  assert.equal(incidentPath(INC), `/incidents/${INC}`);
  assert.equal(incidentListPath('member'), null);
  assert.deepEqual(headingsFor('member'), { page: 'h1', section: 'h2' });
  assert.deepEqual(headingsFor('manage'), { page: 'h2', section: 'h3' });
  assert.equal(auditPath('booking', BOOKING), `/admin/audit?entityType=booking&entityId=${BOOKING}`);
});

test('what an incident says: title, reporter, booking, resolution and what resolving did', async () => {
  const v = await view();
  assert.equal(v.incidentTitle(detail()), 'Damage: FDM 3D Printer #2');
  assert.equal(v.incidentTitle({ type: 'delay', resource: RESOURCE }), 'Late return: Resource', 'a bare id is not a title');
  assert.equal(v.reporterText(detail()), 'Priya Manager, unit staff');
  assert.equal(v.reporterText(detail({ source: 'user', reportedBy: { _id: BORROWER_ID, name: 'Aarav Student' } })), 'Aarav Student, the borrower');
  assert.equal(v.reporterText(systemItem()), 'Raised automatically for a late return');
  const booking = v.incidentBookingView(detail());
  assert.equal(booking.slot, '3 Nov, 10:00–12:00 (2 h)');
  assert.equal(booking.status.label, 'Issue reported');
  assert.equal(booking.borrower.name, 'Aarav Student');
  assert.equal(v.incidentBookingView(systemItem()), null);
  const resolution = v.resolutionView(RESOLUTION);
  assert.equal(resolution.outcome.label, 'Warning');
  assert.equal(resolution.by, 'Asha Admin');
  assert.equal(resolution.at, '3 Nov, 15:30 IST');
  assert.equal(v.resolutionView(null), null);
  assert.match(v.bookingAfterResolve(detail(), true), /booking is now completed/);
  assert.match(v.bookingAfterResolve(detail({ status: 'resolved' }), false), /stays flagged/);
  assert.equal(v.bookingAfterResolve(detail({ status: 'resolved', booking: { ...detail().booking, status: 'completed' } }), null), null);
  assert.equal(v.excerpt('a  b\n c'), 'a b c');
  assert.equal(v.excerpt('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
  assert.equal(v.commentAuthor(detail().comments[0], MANAGER), 'You');
  assert.equal(v.commentAuthor(detail().comments[0], BORROWER), 'Priya Manager');
});

test('every "no resolve button" comes with a reason', async () => {
  const { resolveHint } = await view();
  const open = detail({ canResolve: false });
  assert.equal(resolveHint(detail(), MANAGER), null, 'canResolve: nothing to explain');
  assert.equal(resolveHint(detail({ status: 'resolved', canResolve: false }), MANAGER), null);
  assert.match(resolveHint({ ...open, severity: 'high' }, MANAGER), /resolved by an admin/);
  const own = { ...open, booking: { ...open.booking, borrower: { _id: MANAGER_ID, name: 'Priya Manager' } } };
  assert.match(resolveHint(own, MANAGER), /your own booking/);
  assert.match(resolveHint(open, BORROWER), /A manager of Design and Innovation Centre reviews it/);
  assert.match(resolveHint({ ...open, severity: 'high' }, BORROWER), /An admin reviews it/);
});

test('reportBlock explains why a booking takes no report: its status, or the 7-day window for the borrower', async () => {
  const { reportBlock, canReportWithoutBooking } = await view();
  const now = Date.now();
  assert.equal(reportBlock(bookingDetail(), BORROWER, now), null);
  assert.match(reportBlock(bookingDetail({ status: 'rejected' }), BORROWER, now).message, /booking that is rejected/);
  const old = bookingDetail({ status: 'completed', end: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString() });
  assert.match(reportBlock(old, BORROWER, now).message, /up to 7 days after a booking ends/);
  assert.equal(reportBlock(old, MANAGER, now), null, 'staff have no time limit');
  assert.equal(canReportWithoutBooking(BORROWER), false);
  assert.equal(canReportWithoutBooking(MANAGER), true);
  assert.equal(canReportWithoutBooking(ADMIN), true);
});

// ── Pages ─────────────────────────────────────────────────────────────────────

async function renderDetail(incident, { user = MANAGER, path = `/manage/incidents/${INC}`, route = '/manage/incidents/:id' } = {}) {
  signIn(user);
  fakeApi();
  const { default: IncidentDetailPage } = await load('/src/features/incidents/IncidentDetailPage.jsx');
  const { incidentKeys } = await api();
  return render((React) => React.createElement(IncidentDetailPage), {
    cache: [[incidentKeys.detail(INC), { data: incident }]],
    path,
    route,
  });
}

test('manager detail (judge step 11): an h2 under the console, the thread, the photos, the booking and Resolve', async () => {
  const html = await renderDetail(detail());
  const shown = text(html);
  assert.doesNotMatch(html, /<h1/, 'the manage layout owns the h1');
  assert.match(html, /<h2[^>]*>Damage: FDM 3D Printer #2<\/h2>/);
  assert.match(shown, /Incident · Design and Innovation Centre/);
  assert.match(shown, /Open Low severity Damage/);
  assert.match(shown, /Priya Manager, unit staff · 3 Nov, 13:00 IST/);
  assert.match(shown, /Resolve incident/);
  // The thread, oldest first, with the viewer's own comment as "You".
  assert.match(shown, /Thread \(2 comments\)/);
  assert.match(shown, /You 3 Nov, 13:30 IST Can you say when you noticed it\? Aarav Student 3 Nov, 14:00 IST It was there at check-in too/);
  assert.match(html, /<label[^>]*>Add a comment<\/label>/);
  assert.match(html, /alt="Incident photo 1 of 1, FDM 3D Printer #2"/);
  assert.match(html, new RegExp(`href="/bookings/${BOOKING}"`));
  assert.match(shown, /3 Nov, 10:00–12:00 \(2 h\) IST Issue reported/);
  assert.match(shown, /Borrower: Aarav Student · Undergraduate \(UG\) · Computer Science and Engineering \(CSE\)/);
  assert.match(html, /href="\/manage\/incidents"/, 'back to the unit list');
  assert.doesNotMatch(html, /\/admin\/audit/, 'a manager has no admin audit page');
  assert.doesNotMatch(shown, /\[object Object\]/);
});

test('a resolved incident shows the resolution card and a closed thread, without a form or Resolve', async () => {
  const html = await renderDetail(
    detail({ status: 'resolved', resolution: RESOLUTION, canComment: false, canResolve: false }),
    { user: BORROWER, path: `/incidents/${INC}`, route: '/incidents/:id' },
  );
  const shown = text(html);
  assert.match(html, /<h1[^>]*>Damage: FDM 3D Printer #2<\/h1>/, 'the member page has its own h1');
  assert.match(shown, /Resolved Low severity/);
  assert.match(shown, /Resolution Warning The borrower is warned\./);
  assert.match(shown, /Rationale: “Minor scratch; the borrower was reminded to clean the bed\.”/);
  assert.match(shown, /Decided by Asha Admin on 3 Nov, 15:30 IST/);
  assert.match(shown, /The booking stays flagged until its other incidents are resolved\./);
  assert.match(shown, /This incident is resolved, so its thread is closed\./);
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(shown, /Resolve incident/);
  assert.match(html, new RegExp(`href="/bookings/${BOOKING}"`), 'back to the booking for a member');
});

test('the admin detail links the incident and its booking in the audit log', async () => {
  const html = await renderDetail(detail({ severity: 'high' }), {
    user: ADMIN,
    path: `/admin/incidents/${INC}`,
    route: '/admin/incidents/:id',
  });
  assert.match(html, new RegExp(`href="/admin/audit\\?entityType=incident&amp;entityId=${INC}"`));
  assert.match(html, new RegExp(`href="/admin/audit\\?entityType=booking&amp;entityId=${BOOKING}"`));
  assert.match(html, /href="\/admin\/incidents"/);
  assert.match(text(html), /High severity/);
});

test('an admin who opens the incident from the booking history (/incidents/:id) gets the audit links too', async () => {
  // BookingTimeline links to /incidents/:id whoever is looking; judge step 12 starts from there.
  const html = await renderDetail(detail(), { user: ADMIN, path: `/incidents/${INC}`, route: '/incidents/:id' });
  assert.match(html, new RegExp(`href="/admin/audit\\?entityType=incident&amp;entityId=${INC}"`));
  assert.match(html, new RegExp(`href="/admin/audit\\?entityType=booking&amp;entityId=${BOOKING}"`));
  const member = await renderDetail(detail(), { user: BORROWER, path: `/incidents/${INC}`, route: '/incidents/:id' });
  assert.doesNotMatch(member, /\/admin\/audit/, 'a member has no admin audit page');
});

test('a manager on a high-severity incident is told an admin resolves it; a system report has no booking', async () => {
  const high = await renderDetail(detail({ severity: 'high', canResolve: false }));
  assert.match(text(high), /A high-severity incident is resolved by an admin\./);
  assert.doesNotMatch(text(high), /Resolve incident/);

  const { photos: _p, ...noPhotos } = detail();
  const system = await renderDetail({
    ...noPhotos,
    source: 'system',
    type: 'delay',
    reportedBy: null,
    booking: undefined,
    comments: [],
  });
  const shown = text(system);
  assert.match(shown, /Late return: FDM 3D Printer #2/);
  assert.match(shown, /Raised automatically for a late return/);
  assert.match(shown, /Not tied to a booking/);
  assert.match(shown, /No comments yet\./);
  assert.doesNotMatch(system, /Incident photo/);
});

test('an AI summary shows only when one exists, labelled as a suggestion', async () => {
  const html = await renderDetail(detail({ aiSummary: { text: 'The borrower says the scratch predates the booking.', generatedAt: '2026-11-03T09:00:00.000Z' } }));
  assert.match(text(html), /AI suggestion: summary The borrower says the scratch predates the booking\. Generated automatically on 3 Nov, 14:30 IST/);
  assert.doesNotMatch(text(await renderDetail(detail())), /AI suggestion/);
});

test('a failed load shows the server message and the request id, with a way back', async () => {
  signIn(MANAGER);
  fakeApi();
  const { default: IncidentDetailPage } = await load('/src/features/incidents/IncidentDetailPage.jsx');
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  client.getQueryCache().build(client, { queryKey: ['incident', INC] }).setState({
    status: 'error',
    fetchStatus: 'idle',
    error: { status: 403, code: 'FORBIDDEN', message: "You can't view this incident.", requestId: 'req-403' },
    errorUpdatedAt: Date.now(),
    fetchFailureCount: 1,
  });
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/manage/incidents/${INC}`] },
        React.createElement(Routes, null, React.createElement(Route, { path: '/manage/incidents/:id', element: React.createElement(IncidentDetailPage) })),
      ),
    ),
  );
  client.clear();
  const shown = text(html);
  assert.match(shown, /Couldn't load this incident You can't view this incident\./);
  assert.match(shown, /ref: req-403/);
  assert.match(shown, /Back to incidents/);
});

async function renderList(scope, { items = [listItem(), systemItem()], total = items.length, path = `/${scope}/incidents`, filters } = {}) {
  signIn(scope === 'admin' ? ADMIN : MANAGER);
  fakeApi();
  const { default: IncidentListPage } = await load('/src/features/incidents/IncidentListPage.jsx');
  const { incidentKeys, readIncidentFilters, INCIDENT_PAGE_SIZE } = await api();
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const read = filters ?? readIncidentFilters(query, scope);
  return render((React) => React.createElement(IncidentListPage, { scope }), {
    cache: [
      [incidentKeys.list({ ...read, limit: INCIDENT_PAGE_SIZE }), { data: items, meta: { page: read.page, limit: 20, total } }],
      [incidentKeys.filterResources, { data: [card(), card({ _id: '6720000000000000000000c2', title: 'Laser Cutter', status: 'maintenance' })], meta: { page: 1, limit: 50, total: 2 } }],
    ],
    path,
  });
}

test('manage list: unresolved by default, each card links to the console detail with what to triage by', async () => {
  const html = await renderList('manage');
  const shown = text(html);
  assert.doesNotMatch(html, /<h1/);
  assert.match(html, /<h2[^>]*>Incidents in your units<\/h2>/);
  assert.match(shown, /2 incidents/);
  assert.match(html, new RegExp(`href="/manage/incidents/${INC}"`));
  assert.match(html, new RegExp(`href="/manage/incidents/${INC_SYS}"`));
  assert.match(shown, /Damage: FDM 3D Printer #2 Design and Innovation Centre \(DIC\) · Priya Manager, unit staff · 3 Nov, 13:00 IST Open Low severity/);
  assert.match(shown, /2 comments Booking 3 Nov, 10:00–12:00 \(2 h\) IST · Aarav Student Issue reported/);
  assert.match(shown, /Late return: FDM 3D Printer #2 .* Raised automatically for a late return/);
  assert.match(shown, /1 comment Not tied to a booking/);
  // The filters: the status select starts on "Unresolved", the resource options come from GET /resources.
  assert.match(html, /<option value="open,in_review" selected="">Unresolved \(open or in review\)<\/option>/);
  assert.match(html, /Laser Cutter \(maintenance\)/);
  assert.match(html, /href="\/incidents\/new"/, 'managers can report without a booking');
  assert.doesNotMatch(shown, /Back to the default filters/);
});

test('admin escalations default to high severity, and an empty result offers every severity', async () => {
  const html = await renderList('admin', { items: [] });
  const shown = text(html);
  assert.match(html, /<h2[^>]*>High-severity incidents<\/h2>/);
  assert.match(html, /<option value="high" selected="">High<\/option>/);
  assert.match(shown, /0 incidents/);
  assert.match(shown, /Nothing to escalate/);
  assert.match(shown, /Show every severity/);

  const all = await renderList('admin', { path: '/admin/incidents?severity=all&status=resolved' });
  assert.match(all, /<h2[^>]*>Incidents across every unit<\/h2>/);
  assert.match(text(all), /Back to the default filters/);
  assert.match(all, new RegExp(`href="/admin/incidents/${INC}"`));
});

async function renderReport(path, { user = BORROWER, cache = [] } = {}) {
  signIn(user);
  fakeApi();
  const { default: ReportIncidentPage } = await load('/src/features/incidents/ReportIncidentPage.jsx');
  return render((React) => React.createElement(ReportIncidentPage), { cache, path, route: '/incidents/new' });
}

test('/incidents/new?bookingId= shows the booking and the form: type, severity, description, photos', async () => {
  const html = await renderReport(`/incidents/new?bookingId=${BOOKING}`, {
    cache: [[['booking', BOOKING], { data: bookingDetail() }]],
  });
  const shown = text(html);
  assert.match(html, /<h1[^>]*>Report an issue<\/h1>/);
  assert.match(shown, /About this booking FDM 3D Printer #2/);
  assert.match(shown, /Returned, awaiting confirmation/);
  assert.doesNotMatch(shown, /Which resource\?/, 'the booking names the resource');
  assert.match(html, /<legend[^>]*>Kind of issue<\/legend>/);
  assert.equal((html.match(/name="incident-type"/g) ?? []).length, 6);
  assert.equal((html.match(/name="incident-severity"/g) ?? []).length, 3);
  assert.match(shown, /Late return It came back after the booking ended\./);
  assert.match(shown, /High Unsafe or out of action\. The admins are told, and an admin resolves it\./);
  assert.match(html, /<label[^>]*>Description<\/label>/);
  assert.match(shown, /20–2000 characters/);
  assert.match(html, /<legend[^>]*>Photos \(optional\)<\/legend>/);
  assert.match(shown, /Send the report/);
  assert.match(html, new RegExp(`href="/bookings/${BOOKING}"`));
});

test('a booking that takes no report says why instead of showing the form', async () => {
  const html = await renderReport(`/incidents/new?bookingId=${BOOKING}`, {
    cache: [[['booking', BOOKING], { data: bookingDetail({ status: 'rejected' }) }]],
  });
  const shown = text(html);
  assert.match(shown, /This booking can't take a report Incidents can't be reported on a booking that is rejected\./);
  assert.doesNotMatch(shown, /Send the report/);
});

test('without a booking: a member is sent to the booking; a manager picks one of their resources', async () => {
  const member = text(await renderReport('/incidents/new'));
  assert.match(member, /Report it from the booking/);
  assert.doesNotMatch(member, /Send the report/);

  const { incidentKeys } = await api();
  const html = await renderReport('/incidents/new', {
    user: MANAGER,
    cache: [
      [
        incidentKeys.reportable({ q: '', limit: 20 }),
        { data: [card(), card({ _id: '6720000000000000000000c2', title: 'Laser Cutter', status: 'maintenance' })], meta: { page: 1, limit: 20, total: 2 } },
      ],
    ],
  });
  const shown = text(html);
  assert.match(shown, /Which resource\?/);
  assert.match(shown, /FDM 3D Printer #2 Design and Innovation Centre \(DIC\)/);
  assert.match(shown, /Laser Cutter Design and Innovation Centre \(DIC\) · under maintenance/);
  assert.match(shown, /Send the report/);
  assert.match(html, /href="\/manage\/incidents"/, 'back to the console list');
});

test('from a resource page (?resourceId=), Back and Cancel return to that resource, not the incident list', async () => {
  const { incidentKeys } = await api();
  const reportable = [incidentKeys.reportable({ q: '', limit: 20 }), { data: [card()], meta: { page: 1, limit: 20, total: 1 } }];
  const html = await renderReport(`/incidents/new?resourceId=${RESOURCE}`, {
    user: MANAGER,
    cache: [[['resource', RESOURCE], { data: card() }], reportable],
  });
  const back = html.match(/<a[^>]*href="([^"]*)"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>([^<]*)<\/a>/);
  assert.deepEqual([back?.[1], back?.[2]], [`/resources/${RESOURCE}`, 'Back to the resource']);
  assert.match(html, new RegExp(`<a[^>]*href="/resources/${RESOURCE}"[^>]*>Cancel</a>`));
  assert.doesNotMatch(html, /href="\/manage\/incidents"/);

  // Without a resource in the link (the console's "Report an issue"), the list stays the way back.
  const plain = await renderReport('/incidents/new', { user: MANAGER, cache: [reportable] });
  assert.match(plain, /href="\/manage\/incidents"[^>]*><svg[\s\S]*?<\/svg>Back to incidents<\/a>/);
});

// ── auditApi.js ───────────────────────────────────────────────────────────────

test('audit URL: filters read as given, checked with the server\'s messages, and the page reset on change', async () => {
  const { readAuditFilters, validateAuditFilters, writeAuditFilters, hasAuditFilters } = await audit();
  const filters = readAuditFilters(new URLSearchParams(`entityType=Booking&entityId=${BOOKING}&page=2`));
  assert.deepEqual(filters, {
    entityType: 'booking',
    entityId: BOOKING,
    actorId: '',
    action: '',
    orgUnit: '',
    from: '',
    to: '',
    page: 2,
  });
  assert.deepEqual(validateAuditFilters(filters), {});
  assert.equal(hasAuditFilters(filters), true);
  assert.equal(hasAuditFilters(readAuditFilters(new URLSearchParams('page=3'))), false);

  const bad = validateAuditFilters({
    entityType: 'Book ing',
    entityId: 'nope',
    actorId: '123',
    action: 'approved',
    orgUnit: 'x',
    from: '2026-02-30',
    to: '2026-13-01',
  });
  assert.deepEqual(bad, {
    entityType: 'Must be an entity type such as "booking".',
    action: 'Must be an action such as "booking.approved".',
    entityId: 'Must be a valid id.',
    actorId: 'Must be a valid id.',
    orgUnit: 'Must be a valid id.',
    from: 'Must be a valid date.',
    to: 'Must be a valid date.',
  });
  assert.equal(validateAuditFilters({ from: '2026-11-05', to: '2026-11-03' }).to, "Can't be before the start date.");
  assert.deepEqual(validateAuditFilters({ from: '2026-11-03', to: '2026-11-03' }), {}, 'one day is from = to');

  const next = writeAuditFilters(new URLSearchParams(`entityType=booking&page=4`), { actorId: MANAGER_ID, entityType: '' });
  assert.equal(next.toString(), `actorId=${MANAGER_ID}`);
  assert.equal(writeAuditFilters(next, { page: 3 }).toString(), `actorId=${MANAGER_ID}&page=3`);
});

test('the audit query: dates become IST midnights as [from, the day after to)', async () => {
  const { auditQueryParams } = await audit();
  assert.deepEqual(
    auditQueryParams({ entityType: 'booking', entityId: BOOKING, from: '2026-11-03', to: '2026-11-05', page: 2 }),
    {
      entityType: 'booking',
      entityId: BOOKING,
      from: '2026-11-02T18:30:00.000Z',
      to: '2026-11-05T18:30:00.000Z',
      page: 2,
      limit: 25,
    },
  );
  assert.deepEqual(auditQueryParams({}), { page: 1, limit: 25 });
});

test('GET /audit and GET /admin/users unwrap { data, meta }; a 400 marks the refused filter', async () => {
  const { listAudit, findUsers, auditFieldErrors } = await audit();
  const calls = fakeApi({
    'GET /audit': () => ({ status: 200, data: AUDIT_ENTRIES, meta: { page: 1, limit: 25, total: 2 } }),
    'GET /admin/users': () => ({
      status: 200,
      data: [{ _id: MANAGER_ID, name: 'Priya Manager', email: 'manager@demo.campuscommons.test', roles: ['member', 'manager'], memberType: 'staff', department: null, verification: { status: 'approved' }, managedOrgUnits: [UNIT], suspendedUntil: null }],
      meta: { page: 1, limit: 5, total: 1 },
    }),
  });
  const res = await listAudit({ entityType: 'booking', entityId: BOOKING });
  assert.deepEqual(calls[0].params, { entityType: 'booking', entityId: BOOKING, page: 1, limit: 25 });
  assert.equal(res.data.length, 2);
  assert.equal(res.meta.total, 2);
  const people = await findUsers({ q: ' priya ' });
  assert.deepEqual(calls[1].params, { q: 'priya', limit: 5 });
  assert.equal(people.data[0].name, 'Priya Manager');

  assert.deepEqual(
    auditFieldErrors({ code: 'VALIDATION_ERROR', details: [{ path: 'to', message: 'Must be after from.' }, { path: 'page', message: 'x' }] }),
    { to: 'Must be after from.' },
  );
});

test('what an audit entry shows: action, actor, entity link, and changes and meta as text', async () => {
  const a = await audit();
  assert.equal(a.actionLabel('booking.checked_in'), 'Booking checked in');
  assert.equal(a.actionLabel('org_unit.managers_changed'), 'Org unit managers changed');
  assert.equal(a.actorLabel({ id: MANAGER_ID, role: 'manager', name: 'Priya Manager' }), 'Priya Manager (manager)');
  assert.equal(a.actorLabel({ id: null, role: 'system', name: null }), 'System (automatic)');
  assert.equal(a.actorLabel({ id: 'x', role: 'admin', name: null }), 'Admin (account removed)');
  assert.equal(a.entityPath({ type: 'booking', id: BOOKING }), `/bookings/${BOOKING}`);
  assert.equal(a.entityPath({ type: 'incident', id: INC }), `/admin/incidents/${INC}`);
  assert.equal(a.entityPath({ type: 'user', id: BORROWER_ID }), null);
  assert.equal(a.shortId(BOOKING), '…0000b1');
  assert.deepEqual(a.changeRows(AUDIT_ENTRIES[1].changes), [
    { field: 'status', before: 'pending', after: 'approved' },
    { field: 'decision', before: '—', after: '{"action":"approve"}' },
  ]);
  assert.deepEqual(a.metaRows(AUDIT_ENTRIES[0].meta), [
    { key: 'incidentId', value: INC },
    { key: 'closedAt', value: '3 Nov 2026, 03:30 pm IST' },
  ]);
  assert.equal(a.formatAuditValue(false), 'false');
  assert.equal(a.formatAuditValue(0), '0');
  assert.deepEqual(a.changeRows(null), []);
  assert.deepEqual(a.metaRows([1, 2]), []);
});

async function renderAudit(path, { cache } = {}) {
  signIn(ADMIN);
  const calls = fakeApi();
  const { default: AuditPage } = await load('/src/features/admin/AuditPage.jsx');
  const { auditQueryParams, readAuditFilters } = await audit();
  const filters = readAuditFilters(new URLSearchParams(path.split('?')[1] ?? ''));
  const html = await render((React) => React.createElement(AuditPage), {
    cache: cache ?? [
      [['audit', auditQueryParams(filters)], { data: AUDIT_ENTRIES, meta: { page: 1, limit: 25, total: 2 } }],
      [['org-units', 'active'], { success: true, data: [{ _id: UNIT, name: 'Design and Innovation Centre', code: 'dic', type: 'centre', isActive: true }], requestId: 'r' }],
    ],
    path,
  });
  return { html, calls };
}

test('audit deep link (judge step 12): one booking\'s history, newest first, with actors and expandable rows', async () => {
  const { html } = await renderAudit(`/admin/audit?entityType=booking&entityId=${BOOKING}`);
  const shown = text(html);
  assert.doesNotMatch(html, /<h1/, 'the admin layout owns the h1');
  assert.match(html, /<h2[^>]*>History of booking …0000b1<\/h2>/);
  assert.match(html, new RegExp(`href="/bookings/${BOOKING}"`));
  assert.match(shown, /2 entries · filtered by booking …0000b1/);
  // Newest first, as the server sent them: the completion (system) above the approval (manager).
  assert.match(shown, /3 Nov 2026, 03:30 pm booking\.completed Booking completed System \(automatic\) Booking …0000b1 DIC .* 29 Oct 2026, 11:30 am booking\.approved Booking approved “Earliest request for the slot\.” Priya Manager \(manager\) Booking …0000b1 DIC/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2, 'each row has a details toggle');
  assert.match(html, /<caption class="sr-only">Audit entries, newest first/);
  // The filter form starts from the URL.
  assert.match(html, /<option value="booking" selected="">Booking<\/option>/);
  assert.match(html, new RegExp(`value="${BOOKING}"`));
  assert.match(html, /<optgroup label="Bookings">/);
  assert.match(html, /<option value="badge.evidence_viewed">badge.evidence_viewed<\/option>/);
  assert.match(html, /Design and Innovation Centre \(DIC\)/);
  assert.doesNotMatch(shown, /\[object Object\]/);
});

test('a malformed filter in the URL is pointed out instead of showing the whole log', async () => {
  const { html, calls } = await renderAudit('/admin/audit?entityType=booking&entityId=nope', { cache: [] });
  const shown = text(html);
  assert.match(shown, /Fix the highlighted filters to see the log\./);
  assert.match(shown, /Must be a valid id\./);
  assert.doesNotMatch(html, /<table/);
  assert.equal(calls.filter((c) => c.key === 'GET /audit').length, 0, 'no request with a bad filter');
});

test('an empty log says whether it is the filters or nothing yet', async () => {
  const { auditQueryParams } = await audit();
  const { html } = await renderAudit('/admin/audit?action=booking.no_show', {
    cache: [[['audit', auditQueryParams({ action: 'booking.no_show', page: 1 })], { data: [], meta: { page: 1, limit: 25, total: 0 } }]],
  });
  const shown = text(html);
  assert.match(shown, /0 entries · filtered by action booking\.no_show/);
  assert.match(shown, /No entries match/);
});
