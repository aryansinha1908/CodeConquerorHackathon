// Tests for the manager's resource pages (frontend.md §6.3 /manage/resources and the listing form;
// judge step 1): the API module (features/manage/resources/api.js), the form model
// (listingForm.js: schema, bodies, partial PATCH, server error paths), the status helpers, and the
// two pages rendered with react-dom/server. Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/bookings.test.mjs. Requests go to a
// fake axios adapter; pages render from a pre-filled React Query cache holding data shaped exactly
// as docs/api.md describes (Card, Detail with canManage and blackouts, GET /org-units, GET /badges),
// so a crash such as rendering an object as text shows up here.
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

// routes: { 'PATCH /resources/r1/status': (config) => answer }. An answer is { status, data, meta }
// or { status, code, message, details }; anything unrouted is 404 NOT_FOUND.
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

const DIC = '64b000000000000000000d1c';
const CW = '64b000000000000000000c00';
const CSE = '64b000000000000000000c5e';
const LIB = '64b0000000000000000001b0';
const BADGE_3DP = '64b0000000000000000b3d01';
const BADGE_LATHE = '64b0000000000000000b1a7e';
const R1 = '64b0000000000000000000a1';

// GET /org-units: { _id, name, code, type, location?, isActive }, sorted by name.
const ORG_UNITS = [
  { _id: CW, name: 'Central Workshop', code: 'cw', type: 'central_facility', isActive: true },
  { _id: LIB, name: 'Central Library', code: 'lib', type: 'central_facility', isActive: true },
  { _id: CSE, name: 'Computer Science and Engineering', code: 'cse', type: 'department', isActive: true },
  { _id: DIC, name: 'Design and Innovation Centre', code: 'dic', type: 'centre', location: { building: 'DIC' }, isActive: true },
];

// GET /badges: { _id, name, code, orgUnit: { _id, name, code, isActive }, description?, validityDays, evidenceRequired, selfServe }.
const BADGES = [
  {
    _id: BADGE_3DP,
    name: '3D Printing Basics',
    code: '3d-printing-basics',
    orgUnit: { _id: DIC, name: 'Design and Innovation Centre', code: 'dic', isActive: true },
    description: 'Slicing, levelling and removing prints.',
    validityDays: 365,
    evidenceRequired: false,
    selfServe: false,
  },
  {
    _id: BADGE_LATHE,
    name: 'Workshop Safety Induction',
    code: 'workshop-safety-induction',
    orgUnit: { _id: CW, name: 'Central Workshop', code: 'cw', isActive: true },
    validityDays: null,
    evidenceRequired: true,
    selfServe: false,
  },
];

const MANAGER = {
  _id: 'mgr-1',
  name: 'Meera Iyer',
  roles: ['member', 'manager'],
  managedOrgUnits: [DIC, CW],
  verification: { status: 'approved', reason: null, submittedAt: null },
};
const ONE_UNIT_MANAGER = { ...MANAGER, _id: 'mgr-2', managedOrgUnits: [DIC] };
const ADMIN = {
  _id: 'admin-1',
  name: 'Campus Admin',
  roles: ['member', 'admin'],
  managedOrgUnits: [],
  verification: { status: 'approved', reason: null, submittedAt: null },
};
const MEMBER = { _id: 'u-1', name: 'Aarav Student', roles: ['member'], managedOrgUnits: [] };

const PHOTO = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000000/campuscommons/photos/p1.jpg',
  publicId: 'campuscommons/photos/p1',
};

// A Card from GET /resources.
const card = (overrides = {}) => ({
  _id: R1,
  title: 'FDM 3D Printer',
  slug: 'fdm-3d-printer-0000a1',
  description: 'Single-nozzle FDM printer.',
  images: [PHOTO],
  category: 'equipment',
  bookingMode: 'slot',
  quantity: 1,
  riskLevel: 'medium',
  location: { building: 'Design and Innovation Centre', room: 'Prototyping Lab', floor: 'Ground' },
  status: 'active',
  availability: {
    weekly: [1, 2, 3, 4, 5].map((day) => ({ day, open: '09:00', close: '17:00' })),
    slotMinutes: 30,
  },
  eligibility: {
    memberTypes: ['ug', 'pg', 'rs', 'faculty', 'staff'],
    departments: [],
    badges: [{ _id: BADGE_3DP, name: '3D Printing Basics', code: '3d-printing-basics', orgUnit: { _id: DIC, name: 'Design and Innovation Centre' } }],
    approvalMode: 'manual',
  },
  limits: { minDurationMins: 30, maxDurationMins: 240, maxHoursPerWeek: 6, maxActiveBookings: 1, leadTimeMins: 120, maxAdvanceDays: 14 },
  orgUnit: { _id: DIC, name: 'Design and Innovation Centre', code: 'dic', type: 'centre' },
  openHours: 'Mon–Fri 09:00–17:00',
  createdAt: '2026-10-20T04:30:00.000Z',
  updatedAt: '2026-10-28T04:30:00.000Z',
  ...overrides,
});

// GET /resources/:id: the card plus usageRules?, checklist, availability.blackouts and canManage.
const detail = (overrides = {}) => {
  const base = card();
  return {
    ...base,
    usageRules: 'PLA and PETG only.',
    checklist: ['Nozzle clean', 'Build plate undamaged'],
    availability: {
      ...base.availability,
      weekly: [
        { day: 1, open: '09:00', close: '13:00' },
        { day: 1, open: '14:00', close: '17:00' },
        ...[2, 3, 4, 5].map((day) => ({ day, open: '09:00', close: '17:00' })),
        { day: 6, open: '09:00', close: '13:00' },
      ],
      blackouts: [
        {
          _id: '64b0000000000000000bb001',
          start: '2026-11-09T03:30:00.000Z', // 09:00 IST
          end: '2026-11-09T11:30:00.000Z', // 17:00 IST
          reason: 'Diwali holiday',
        },
      ],
    },
    eligibility: {
      ...base.eligibility,
      memberTypes: ['pg', 'rs', 'faculty'],
      departments: [{ _id: CSE, code: 'cse', name: 'Computer Science and Engineering' }],
    },
    limits: { maxDurationMins: 240, maxHoursPerWeek: 6 },
    openHours: 'Mon 09:00–13:00, 14:00–17:00; Tue–Fri 09:00–17:00; Sat 09:00–13:00',
    canManage: true,
    ...overrides,
  };
};

// ── Rendering ─────────────────────────────────────────────────────────────────

async function render(makeElement, { cache = [], errors = [], path = '/', route } = {}) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
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
    React.createElement(QueryClientProvider, { client }, React.createElement(Probe, { onResult: (v) => results.push(v) })),
  );
  return { result: results[results.length - 1], invalidated, client };
}

const api = () => load('/src/features/manage/resources/api.js');
const model = () => load('/src/features/manage/resources/listingForm.js');
const statusView = () => load('/src/features/manage/resources/statusView.js');
const orgUnitKey = async () => (await load('/src/features/verification/api.js')).orgUnitKeys.active;

// A valid new listing (the judge's step 1 resource) as a form.
async function judgeForm() {
  const m = await model();
  const form = m.emptyForm({ orgUnit: DIC });
  return {
    ...form,
    title: 'FDM 3D Printer #2',
    category: 'equipment',
    badges: [BADGE_3DP],
    limits: { ...form.limits, maxDurationMins: '240', maxHoursPerWeek: '6' },
    checklist: [
      { key: 'c1', label: 'Nozzle clean' },
      { key: 'c2', label: 'Build plate undamaged' },
    ],
  };
}

// ── api.js ────────────────────────────────────────────────────────────────────

test('the list always asks for a non-active status, so the server keeps a manager to their units', async () => {
  const { manageListParams, STATUS_FILTERS } = await api();
  for (const filter of STATUS_FILTERS) {
    const { status } = manageListParams({ status: filter.id });
    assert.ok(status.split(',').some((s) => s !== 'active'), `${filter.id} → ${status}`);
  }
  assert.deepEqual(manageListParams(), { status: 'active,maintenance,archived', page: 1, limit: 20 });
  assert.deepEqual(manageListParams({ status: 'active' }).status, 'active,maintenance,archived', 'active alone is never sent');
  assert.deepEqual(manageListParams({ status: 'archived', orgUnit: DIC, q: '  printer ', page: '3', limit: 500 }), {
    status: 'archived',
    orgUnit: DIC,
    q: 'printer',
    page: 3,
    limit: 50,
  });
  assert.equal(manageListParams({ orgUnit: 'not-an-id' }).orgUnit, undefined);
  assert.equal(manageListParams({ q: 'x'.repeat(150) }).q.length, 100);
});

test('the URL filters read and write back, and a filter change goes back to page 1', async () => {
  const { readManageFilters, writeManageFilters } = await api();
  const read = readManageFilters(new URLSearchParams(`status=maintenance&unit=${DIC}&q=lathe&page=2`));
  assert.deepEqual(read, { status: 'maintenance', orgUnit: DIC, q: 'lathe', page: 2 });
  assert.deepEqual(readManageFilters(new URLSearchParams('status=bogus&unit=x&page=-1')), {
    status: 'all',
    orgUnit: '',
    q: '',
    page: 1,
  });
  const next = writeManageFilters(new URLSearchParams('page=4&q=lathe'), { status: 'archived' });
  assert.equal(next.toString(), 'q=lathe&status=archived');
  assert.equal(writeManageFilters(next, { status: 'all', q: '' }).toString(), '');
  assert.equal(writeManageFilters(new URLSearchParams(), { page: 3 }).toString(), 'page=3');
});

test('each request goes to its route and resolves with { data, meta }', async () => {
  const a = await api();
  const calls = fakeApi({
    'GET /resources': () => ({ status: 200, data: [card()], meta: { page: 1, limit: 20, total: 1 } }),
    'POST /resources': () => ({ status: 201, data: detail() }),
    [`PATCH /resources/${R1}`]: () => ({ status: 200, data: detail({ title: 'FDM 3D Printer #1' }) }),
    [`PATCH /resources/${R1}/status`]: () => ({
      status: 200,
      data: { resource: detail({ status: 'maintenance' }), affectedBookings: 2 },
    }),
    'GET /badges': () => ({ status: 200, data: BADGES }),
  });

  const listed = await a.listManagedResources({ orgUnit: DIC, page: 1 });
  assert.equal(calls[0].key, 'GET /resources');
  assert.deepEqual(calls[0].params, { status: 'active,maintenance,archived', orgUnit: DIC, page: 1, limit: 20 });
  assert.deepEqual(listed.meta, { page: 1, limit: 20, total: 1 });
  assert.equal(listed.data[0].title, 'FDM 3D Printer');

  const created = await a.createResource({ orgUnit: DIC, title: 'X' });
  assert.equal(calls[1].key, 'POST /resources');
  assert.deepEqual(calls[1].body, { orgUnit: DIC, title: 'X' });
  assert.equal(created.data.canManage, true);

  await a.updateResource(R1, { limits: { maxHoursPerWeek: 8 } });
  assert.equal(calls[2].key, `PATCH /resources/${R1}`);
  assert.deepEqual(calls[2].body, { limits: { maxHoursPerWeek: 8 } });

  const changed = await a.setResourceStatus(R1, { status: 'maintenance', reason: '  Waiting for a part.  ' });
  assert.equal(calls[3].key, `PATCH /resources/${R1}/status`);
  assert.deepEqual(calls[3].body, { status: 'maintenance', reason: 'Waiting for a part.' });
  assert.equal(changed.data.affectedBookings, 2);
  await a.setResourceStatus(R1, { status: 'active', reason: '   ' });
  assert.deepEqual(calls[4].body, { status: 'active' }, 'a blank reason is not sent');

  const badges = await a.listBadges();
  assert.equal(calls[5].key, 'GET /badges');
  assert.equal(badges.data.length, 2);
});

test('a refused write comes back normalised, with the request id and the field details', async () => {
  const a = await api();
  fakeApi({
    'POST /resources': () => ({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '2 fields are invalid.',
      details: [
        { path: 'availability.weekly.0.close', message: 'close must be after open' },
        { path: 'eligibility.badges.1', message: 'No such badge.' },
      ],
    }),
    [`PATCH /resources/${R1}/status`]: () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'The status changed while you were saving. Reload and try again.',
    }),
  });
  const err = await rejection(a.createResource({}));
  assert.equal(err.status, 400);
  assert.equal(err.requestId, 'req-err');
  const { listingErrorsFrom } = await model();
  assert.deepEqual(listingErrorsFrom(err).fields, {
    'availability.weekly.0.close': 'close must be after open',
    'eligibility.badges.1': 'No such badge.',
  });
  const conflict = await rejection(a.setResourceStatus(R1, { status: 'archived', reason: 'Retired for good.' }));
  assert.equal(conflict.code, 'INVALID_TRANSITION');
});

test('writes wait for the server, then refresh every resource list and the resource (frontend.md §8.2)', async () => {
  const a = await api();
  fakeApi({
    [`PATCH /resources/${R1}/status`]: () => ({ status: 200, data: { resource: detail({ status: 'archived' }), affectedBookings: 0 } }),
    [`PATCH /resources/${R1}`]: () => ({ status: 200, data: detail({ title: 'Renamed printer' }) }),
    'POST /resources': () => ({ status: 201, data: detail({ _id: '64b0000000000000000000a2' }) }),
  });

  const status = await withHook(a.useSetResourceStatus);
  await status.result.mutateAsync({ id: R1, status: 'archived', reason: 'Retired for good.' });
  assert.deepEqual(status.invalidated, [['resources'], ['resource', R1]]);
  status.client.clear();

  const edit = await withHook(a.useUpdateResource);
  await edit.result.mutateAsync({ id: R1, patch: { title: 'Renamed printer' } });
  assert.deepEqual(edit.invalidated, [['resources'], ['resource', R1]]);
  assert.equal(edit.client.getQueryData(['resource', R1]).data.title, 'Renamed printer', 'the answer is the new detail');
  edit.client.clear();

  const create = await withHook(a.useCreateResource);
  await create.result.mutateAsync({ orgUnit: DIC });
  assert.deepEqual(create.invalidated, [['resources']]);
  assert.equal(create.client.getQueryData(['resource', '64b0000000000000000000a2']).data.canManage, true);
  create.client.clear();

  // A conflict refetches what is on screen, so the list shows the status as it now is.
  fakeApi({ [`PATCH /resources/${R1}/status`]: () => ({ status: 409, code: 'INVALID_TRANSITION', message: 'Changed.' }) });
  const refused = await withHook(a.useSetResourceStatus);
  await rejection(refused.result.mutateAsync({ id: R1, status: 'maintenance', reason: 'Servicing it now.' }));
  assert.deepEqual(refused.invalidated, [['resources'], ['resource', R1]]);
  refused.client.clear();
});

// ── listingForm.js: the form and the values ─────────────────────────────────

test('a Detail becomes the form and back into the same values, so an untouched edit sends nothing', async () => {
  const m = await model();
  const form = m.formFromResource(detail());
  assert.equal(form.orgUnit, DIC);
  assert.equal(form.quantity, '1');
  assert.deepEqual(form.location, { building: 'Design and Innovation Centre', room: 'Prototyping Lab', floor: 'Ground' });
  assert.deepEqual(
    form.weekly.map((w) => [w.day, w.open, w.close]),
    [
      [1, '09:00', '13:00'],
      [1, '14:00', '17:00'],
      [2, '09:00', '17:00'],
      [3, '09:00', '17:00'],
      [4, '09:00', '17:00'],
      [5, '09:00', '17:00'],
      [6, '09:00', '13:00'],
    ],
  );
  assert.deepEqual(form.blackouts.map(({ start, end, reason }) => ({ start, end, reason })), [
    { start: '2026-11-09T09:00', end: '2026-11-09T17:00', reason: 'Diwali holiday' },
  ], 'closures are edited in IST');
  assert.deepEqual(form.departments, [CSE]);
  assert.deepEqual(form.badges, [BADGE_3DP]);
  assert.deepEqual(form.memberTypes, ['pg', 'rs', 'faculty']);
  assert.equal(form.limits.maxDurationMins, '240');
  assert.equal(form.limits.minDurationMins, '', 'an unset limit is an empty box');
  assert.deepEqual(form.checklist.map((item) => item.label), ['Nozzle clean', 'Build plate undamaged']);

  const values = m.formValues(form);
  assert.deepEqual(values.availability.blackouts, [
    { start: '2026-11-09T03:30:00.000Z', end: '2026-11-09T11:30:00.000Z', reason: 'Diwali holiday' },
  ]);
  assert.deepEqual(values.limits, {
    minDurationMins: null,
    maxDurationMins: 240,
    maxHoursPerWeek: 6,
    maxActiveBookings: null,
    leadTimeMins: null,
    maxAdvanceDays: null,
  });
  assert.deepEqual(m.validateListing(values, { mode: 'edit' }), {});
  assert.deepEqual(m.patchBody(values, m.formValues(m.formFromResource(detail()))), {});

  // An empty memberTypes list means everyone (api.md); the form shows that as all five.
  const open = m.formFromResource(detail({ eligibility: { ...detail().eligibility, memberTypes: [] } }));
  assert.deepEqual(open.memberTypes, ['ug', 'pg', 'rs', 'faculty', 'staff']);
  // Nothing in a Detail is rendered as an object: a bare-id orgUnit still works.
  assert.equal(m.formFromResource({ orgUnit: DIC }).orgUnit, DIC);
});

test('a new listing: required fields, and the body leaves out what is empty', async () => {
  const m = await model();
  const empty = m.formValues(m.emptyForm());
  const errors = m.validateListing(empty, { mode: 'new' });
  assert.equal(errors.orgUnit, 'Choose the unit that lists this resource.');
  assert.equal(errors.title, 'Give the resource a title.');
  assert.equal(errors.category, 'Choose a category.');
  assert.match(errors.checklist, /at least one item/);
  assert.equal(errors['eligibility.memberTypes'], undefined, 'the blank form opens it to everyone');
  assert.equal(m.validateListing(empty, { mode: 'edit' }).orgUnit, undefined, 'an edit never sends the unit');

  const values = m.formValues(await judgeForm());
  assert.deepEqual(m.validateListing(values, { mode: 'new' }), {});
  assert.deepEqual(m.createBody(values), {
    orgUnit: DIC,
    title: 'FDM 3D Printer #2',
    category: 'equipment',
    bookingMode: 'slot',
    quantity: 1,
    riskLevel: 'low',
    availability: {
      weekly: [1, 2, 3, 4, 5].map((day) => ({ day, open: '09:00', close: '17:00' })),
      blackouts: [],
      slotMinutes: 30,
    },
    eligibility: {
      memberTypes: ['ug', 'pg', 'rs', 'faculty', 'staff'],
      departments: [],
      badges: [BADGE_3DP],
      approvalMode: 'manual',
    },
    checklist: ['Nozzle clean', 'Build plate undamaged'],
    limits: { maxDurationMins: 240, maxHoursPerWeek: 6 },
  });
});

test('field rules of frontend.md §9 and api.md, under the paths the server uses', async () => {
  const m = await model();
  const form = await judgeForm();
  const bad = {
    ...form,
    title: 'ab',
    quantity: '51',
    description: 'x'.repeat(2001),
    location: { building: '', room: '', floor: 'x'.repeat(21) },
    weekly: [
      { key: 'w1', day: 1, open: '09:00', close: '13:00' },
      { key: 'w2', day: 1, open: '12:00', close: '17:00' }, // overlaps the first
      { key: 'w3', day: 2, open: '17:00', close: '09:00' }, // closes before it opens
      { key: 'w4', day: 3, open: '', close: '17:00' },
    ],
    blackouts: [
      { key: 'b1', start: '2026-11-09T17:00', end: '2026-11-09T09:00', reason: '' },
      { key: 'b2', start: '', end: '', reason: 'r'.repeat(201) },
    ],
    memberTypes: [],
    limits: { ...form.limits, minDurationMins: '300', maxDurationMins: '240', maxHoursPerWeek: '2', maxAdvanceDays: '400', leadTimeMins: '1.5' },
    checklist: [
      { key: 'c1', label: 'Nozzle clean' },
      { key: 'c2', label: 'nozzle clean ' },
      { key: 'c3', label: 'x' },
    ],
  };
  const errors = m.validateListing(m.formValues(bad), { mode: 'new' });
  assert.equal(errors.title, 'Use at least 3 characters (now 2).');
  assert.equal(errors.quantity, 'Use at most 50.');
  assert.equal(errors.description, 'Use at most 2000 characters (now 2001).');
  assert.equal(errors['location.floor'], 'Use at most 20 characters (now 21).');
  assert.equal(errors['availability.weekly.1.open'], "Overlaps Monday's 09:00–13:00 window.");
  assert.equal(errors['availability.weekly.2.close'], 'Closing time must be after the opening time.');
  assert.equal(errors['availability.weekly.3.open'], 'Enter the opening time.');
  assert.equal(errors['availability.blackouts.0.end'], 'The closure must end after it starts.', 'checked even with another closure empty');
  assert.match(errors['availability.blackouts.1.start'], /Enter when the closure starts/);
  assert.equal(errors['availability.blackouts.1.reason'], 'Use at most 200 characters.');
  assert.match(errors['eligibility.memberTypes'], /at least one member type/);
  assert.equal(errors['limits.minDurationMins'], "Minimum duration can't exceed the maximum.");
  assert.match(errors['limits.maxHoursPerWeek'], /at least 4 h a week/);
  assert.equal(errors['limits.maxAdvanceDays'], 'Use at most 365.');
  assert.equal(errors['limits.leadTimeMins'], 'Enter a whole number.');
  assert.equal(errors['checklist.1'], 'Already on the checklist.', 'a repeated label could never be reported at check-in');
  assert.equal(errors['checklist.2'], 'Use at least 2 characters (now 1).');

  // Touching windows stay apart, as on the server.
  const touching = { ...form, weekly: [
    { key: 'a', day: 1, open: '09:00', close: '12:00' },
    { key: 'b', day: 1, open: '12:00', close: '17:00' },
  ] };
  assert.deepEqual(m.validateListing(m.formValues(touching)), {});

  const many = { ...form, checklist: Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, label: `Item ${i}` })) };
  assert.equal(m.validateListing(m.formValues(many)).checklist, 'At most 10 items.');
});

test('an edit PATCHes only what changed: changed keys of a section, lists whole, null to clear', async () => {
  const m = await model();
  const initial = m.formFromResource(detail());
  const before = m.formValues(initial);
  const edited = {
    ...initial,
    description: '',
    limits: { ...initial.limits, maxHoursPerWeek: '8', maxDurationMins: '' },
    weekly: m.addWindow(initial.weekly, 0),
  };
  const patch = m.patchBody(before, m.formValues(edited));
  assert.deepEqual(Object.keys(patch).sort(), ['availability', 'description', 'limits']);
  assert.equal(patch.description, null, 'a cleared text is sent as null, which clears it');
  assert.deepEqual(patch.limits, { maxDurationMins: null, maxHoursPerWeek: 8 }, 'the other limits stay as they are');
  assert.deepEqual(Object.keys(patch.availability), ['weekly'], 'closures and slot length are not resent');
  assert.equal(patch.availability.weekly.length, 8, 'a list goes whole');
  assert.deepEqual(patch.availability.weekly.at(-1), { day: 0, open: '09:00', close: '17:00' });
  assert.equal('orgUnit' in patch, false);
  assert.deepEqual(m.changedSections(patch), ['basics', 'availability', 'limits']);

  const badgesOnly = m.patchBody(before, m.formValues({ ...initial, badges: [] }));
  assert.deepEqual(badgesOnly, { eligibility: { badges: [] } });
  assert.deepEqual(m.changedSections(badgesOnly), ['eligibility']);
});

test('server 400 details land on the control that shows them; the rest are listed apart', async () => {
  const m = await model();
  const err = {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: '7 fields are invalid.',
    requestId: 'req-400',
    details: [
      { path: 'availability.weekly.0.close', message: 'close must be after open' },
      { path: 'availability.weekly.2.day', message: 'Path `day` (7) is more than maximum allowed value (6).' },
      { path: 'eligibility.badges.1', message: 'No such badge.' },
      { path: 'eligibility.memberTypes.1', message: '`xx` is not a valid enum value.' },
      { path: 'images.0.url', message: 'Path `url` is required.' },
      { path: 'checklist.1', message: 'Path `checklist.1` (`x`, length 1) is shorter than the minimum allowed length (2).' },
      { path: 'status', message: 'Change the status with the status action, which asks for a reason.' },
      { path: 'location', message: 'Must be an object.' },
    ],
  };
  const { fields, other } = m.listingErrorsFrom(err);
  assert.deepEqual(fields, {
    'availability.weekly.0.close': 'close must be after open',
    'availability.weekly.2': 'Path `day` (7) is more than maximum allowed value (6).',
    'eligibility.badges.1': 'No such badge.',
    'eligibility.memberTypes': '`xx` is not a valid enum value.',
    'images.0': 'Path `url` is required.',
    'checklist.1': 'Path `checklist.1` (`x`, length 1) is shorter than the minimum allowed length (2).',
  });
  assert.deepEqual(other, [
    { path: 'status', message: 'Change the status with the status action, which asks for a reason.' },
    { path: 'location', message: 'Must be an object.' },
  ]);
  assert.deepEqual(m.listingErrorsFrom({ code: 'FORBIDDEN', message: 'No.' }), { fields: {}, other: [] });
  assert.equal(m.sectionOf('availability.weekly.0.close'), 'availability');
  assert.equal(m.sectionOf('limits.maxHoursPerWeek'), 'limits');
  assert.equal(m.sectionOf('location.room'), 'basics');
});

test('the error summary reads in form order with names a manager knows', async () => {
  const m = await model();
  const values = m.formValues(m.formFromResource(detail()));
  const summary = m.errorSummary(
    {
      checklist: 'Add an item.',
      'availability.weekly.1.close': 'Closing time must be after the opening time.',
      title: 'Give the resource a title.',
      'availability.blackouts.0.end': 'The closure must end after it starts.',
      'limits.maxHoursPerWeek': 'Use 1 or more.',
    },
    values,
  );
  assert.deepEqual(
    summary.map((item) => `${item.label} [${item.section}]`),
    [
      'Title [basics]',
      'Monday hours 2: closing time [availability]',
      'Closure 1: end [availability]',
      'Hours per member each week [limits]',
      'Condition checklist [checklist]',
    ],
  );
  assert.deepEqual(m.errorCounts({ title: 'x', 'location.room': 'y', 'checklist.0': 'z' }), { basics: 2, checklist: 1 });
  assert.equal(m.fieldDomId('availability.weekly.1.close'), 'listing-availability-weekly-1-close');
  const focus = await load('/src/features/manage/resources/focus.js');
  assert.equal(focus.focusPathFor('eligibility.badges.1'), 'eligibility.badges');
  assert.equal(focus.focusPathFor('availability.weekly.2'), 'availability.weekly.2.open');
  assert.equal(focus.focusPathFor('images.0'), 'images');
});

test('weekly hours: several windows a day, new ones keep the week in order, Monday copies to the week', async () => {
  const m = await model();
  let weekly = m.formFromResource(detail()).weekly;
  weekly = m.addWindow(weekly, 2); // a second Tuesday window, right after the first
  assert.deepEqual(weekly.map((w) => w.day), [1, 1, 2, 2, 3, 4, 5, 6]);
  assert.deepEqual([weekly[3].open, weekly[3].close], ['17:00', ''], 'it starts where the last one closed');
  weekly = m.addWindow(weekly, 0); // Sunday goes last (Mon–Sun weeks)
  assert.equal(weekly.at(-1).day, 0);
  assert.deepEqual([weekly.at(-1).open, weekly.at(-1).close], ['09:00', '17:00']);
  assert.deepEqual(m.windowsOfDay(weekly, 1).map((w) => w.index), [0, 1]);
  assert.equal(m.windowNumber(weekly, 1), 2);

  const copied = m.copyDay(weekly, 1, m.WEEKDAYS);
  assert.deepEqual(
    m.windowsOfDay(copied, 4).map((w) => `${w.open}–${w.close}`),
    ['09:00–13:00', '14:00–17:00'],
  );
  assert.equal(m.windowsOfDay(copied, 6).length, 1, 'Saturday is not a weekday');
  assert.equal(new Set(copied.map((w) => w.key)).size, copied.length, 'copies get keys of their own');
  // Copying says what it did, and which days' own hours it replaced (Saturday's, below).
  const week = [
    { key: 'a', day: 1, open: '09:00', close: '17:00' },
    { key: 'b', day: 2, open: '09:00', close: '17:00' },
    { key: 'c', day: 6, open: '09:00', close: '13:00' },
    { key: 'd', day: 0, open: '10:00', close: '12:00' },
  ];
  assert.equal(
    m.copyDayNotice(week, 1, m.WEEK_ORDER, 'every day'),
    "Copied Monday's hours (09:00–17:00) to every day. The hours Saturday and Sunday had were replaced.",
  );
  assert.equal(
    m.copyDayNotice(week, 1, m.WEEKDAYS, 'Tuesday–Friday'),
    "Copied Monday's hours (09:00–17:00) to Tuesday–Friday.",
    'Tuesday already had the same hours and the rest were closed: nothing was lost',
  );
  assert.deepEqual(m.removeWindow(copied, copied[0].key).length, copied.length - 1);

  // The server's describeOpenHours wording (engines/eligibility.js).
  assert.equal(m.describeOpenHours(m.formValues({ ...m.emptyForm(), weekly: copied }).availability.weekly),
    'Mon–Fri 09:00–13:00, 14:00–17:00; Sat 09:00–13:00; Sun 09:00–17:00');
  assert.equal(m.describeOpenHours(detail().availability.weekly), detail().openHours);
  assert.equal(m.describeOpenHours([]), 'closed all week');
});

test('closures and checklist rows: add, edit, move and remove', async () => {
  const m = await model();
  let blackouts = m.addBlackout([]);
  blackouts = m.updateBlackout(blackouts, blackouts[0].key, { start: '2026-11-09T09:00', reason: 'Exam' });
  assert.deepEqual({ ...blackouts[0], key: undefined }, { key: undefined, start: '2026-11-09T09:00', end: '', reason: 'Exam' });
  assert.equal(m.removeBlackout(blackouts, blackouts[0].key).length, 0);

  let list = ['A1', 'B2', 'C3'].reduce((acc, label) => m.addChecklistItem(acc, label), []);
  list = m.moveChecklistItem(list, list[2].key, -1);
  assert.deepEqual(list.map((i) => i.label), ['A1', 'C3', 'B2']);
  assert.deepEqual(m.moveChecklistItem(list, list[0].key, -1).map((i) => i.label), ['A1', 'C3', 'B2'], 'the top stays');
  list = m.updateChecklistItem(list, list[1].key, 'C3 renamed');
  assert.equal(list[1].label, 'C3 renamed');
  const full = Array.from({ length: 12 }).reduce((acc, _, i) => m.addChecklistItem(acc, `Item ${i}`), []);
  assert.equal(full.length, 10, 'at most 10 items');
  assert.deepEqual(m.toggleIn(['ug'], 'pg'), ['ug', 'pg']);
  assert.deepEqual(m.toggleIn(['ug', 'pg'], 'ug'), ['pg']);
});

test('units: a manager lists only for their units, an admin for any active one; who may edit', async () => {
  const m = await model();
  const withInactive = [...ORG_UNITS, { _id: '64b0000000000000000dead0', name: 'Old Lab', code: 'old', type: 'centre', isActive: false }];
  assert.deepEqual(m.unitChoices(withInactive, MANAGER).map((u) => u.code), ['cw', 'dic']);
  assert.deepEqual(m.unitChoices(withInactive, ADMIN).map((u) => u.code), ['lib', 'cw', 'cse', 'dic']);
  assert.deepEqual(m.unitChoices(withInactive, MEMBER), []);
  assert.equal(m.canListResources(MANAGER), true);
  assert.equal(m.canListResources(ADMIN), true);
  assert.equal(m.canListResources({ ...MANAGER, managedOrgUnits: [] }), false);
  assert.equal(m.unitName(ORG_UNITS[3]), 'Design and Innovation Centre (DIC)');

  assert.deepEqual(m.editorsText(detail(), MANAGER), {
    allowed: true,
    text: 'Managers of Design and Innovation Centre and admins can edit this listing. You can edit it as a manager of Design and Innovation Centre.',
  });
  assert.match(m.editorsText(detail(), ADMIN).text, /as an admin\.$/);
  const locked = m.editorsText(detail({ canManage: false }), MEMBER);
  assert.equal(locked.allowed, false);
  assert.match(locked.text, /read-only for you/);
});

test('the preview reads the values with names filled in, never ids', async () => {
  const m = await model();
  const values = m.formValues({ ...(await judgeForm()), departments: [CSE] });
  const preview = m.previewResource(values, { unit: ORG_UNITS[3], departments: ORG_UNITS, badges: BADGES });
  assert.equal(preview.openHours, 'Mon–Fri 09:00–17:00');
  assert.deepEqual(preview.eligibility.departments.map((d) => d.code), ['cse']);
  assert.deepEqual(preview.eligibility.badges.map((b) => b.name), ['3D Printing Basics']);
  assert.deepEqual(preview.limits, { maxDurationMins: 240, maxHoursPerWeek: 6 });
  assert.equal(m.previewResource(m.formValues(m.emptyForm())).title, 'Untitled resource');
});

// ── statusView.js ─────────────────────────────────────────────────────────────

test('status changes: a reason to leave service, none needed to come back, affected bookings reported', async () => {
  const s = await statusView();
  assert.equal(s.STATUS_DIALOGS.maintenance.required, true);
  assert.equal(s.STATUS_DIALOGS.archived.required, true);
  assert.equal(s.STATUS_DIALOGS.active.required, false);
  assert.equal(s.isStatusChange('active', 'active'), false);
  assert.equal(s.isStatusChange('active', 'maintenance'), true);
  assert.deepEqual(s.statusVars({ _id: R1 }, 'active', '  '), { id: R1, status: 'active' });
  assert.deepEqual(s.statusVars({ _id: R1 }, 'archived', ' Retired. '), { id: R1, status: 'archived', reason: 'Retired.' });

  const warned = s.statusChangeNotice({ title: 'FDM 3D Printer', status: 'maintenance', affectedBookings: 2 });
  assert.equal(warned.tone, 'warning');
  assert.equal(warned.followUp, true);
  assert.equal(
    warned.text,
    "FDM 3D Printer is under maintenance: members can't book it. 2 bookings that haven't ended are affected (pending, approved or in use). Nothing was cancelled: review them and let the borrowers know.",
  );
  const quiet = s.statusChangeNotice({ title: 'Lathe', status: 'archived', affectedBookings: 0 });
  assert.deepEqual(quiet, { tone: 'success', text: 'Lathe is archived and hidden from members. No upcoming bookings are affected.', followUp: false });
  assert.match(s.statusChangeNotice({ title: 'Lathe', status: 'active', affectedBookings: 1 }).text, /open for booking again\. 1 booking that hasn't ended still holds its slot\./);
});

// ── /manage/resources ─────────────────────────────────────────────────────────

const listKey = async (filters = {}) => (await api()).manageResourceKeys.list({ limit: 20, ...filters });

async function renderList({ user = MANAGER, path = '/manage/resources', cache = [], errors = [], units = true } = {}) {
  const { default: ResourcesPage } = await load('/src/features/manage/ResourcesPage.jsx');
  if (user) signIn(user);
  const extra = units ? [[await orgUnitKey(), { success: true, data: ORG_UNITS }]] : [];
  return render((React) => React.createElement(ResourcesPage), { path, cache: [...extra, ...cache], errors });
}

test('resources: a table row per resource with unit, category, quantity, approval, status toggles and links', async () => {
  const rows = [
    card(),
    card({
      _id: '64b0000000000000000000a3',
      title: 'Centre Lathe',
      category: 'tool',
      quantity: 2,
      status: 'maintenance',
      eligibility: { ...card().eligibility, approvalMode: 'auto' },
      orgUnit: { _id: CW, name: 'Central Workshop', code: 'cw', type: 'central_facility' },
    }),
  ];
  const html = await renderList({ cache: [[await listKey(), { data: rows, meta: { page: 1, limit: 20, total: 25 } }]] });
  const shown = text(html);
  assert.match(html, /<h2[^>]*>Resources<\/h2>/);
  assert.match(html, /<a[^>]*href="\/manage\/resources\/new"[^>]*>.*New resource<\/a>/s);
  assert.match(shown, /You manage CW and DIC: you can list, edit and change the status of their resources\./);
  assert.match(html, /<table/);
  assert.match(html, /<caption[^>]*>Your units’ resources, page 1 of 2<\/caption>/);
  assert.match(html, /role="region"[^>]*aria-labelledby="manage-resources-caption"[^>]*tabindex="0"/, 'the scrolling table is reachable by keyboard');
  assert.match(html, new RegExp(`<a[^>]*href="/resources/${R1}"[^>]*>FDM 3D Printer</a>`), 'the public page');
  assert.match(html, new RegExp(`<a[^>]*aria-label="Edit FDM 3D Printer"[^>]*href="/manage/resources/${R1}/edit"`));
  assert.match(shown, /Prototyping Lab, Design and Innovation Centre \(Ground floor\)/);
  assert.match(shown, /DIC Design and Innovation Centre Equipment 1 Manager approval Open for booking/);
  assert.match(shown, /CW Central Workshop Tool 2 Instant approval Under maintenance/);
  assert.match(html, /role="group" aria-label="Status of FDM 3D Printer"/);
  assert.match(html, /aria-pressed="true"[^>]*>Active<\/button>/);
  assert.match(html, /aria-label="Status of Centre Lathe".*?aria-pressed="true"[^>]*>Maintenance<\/button>/s);
  assert.match(shown, /25 resources/);
  assert.match(shown, /Page 1 of 2/);
  assert.match(html, /<option value=""[^>]*>All my units<\/option>/);
  assert.doesNotMatch(html, new RegExp(`<option value="${CSE}"`), 'only the units they manage');
  assert.match(html, /<option value="maintenance">Under maintenance<\/option>/);
  assert.doesNotMatch(shown, /\[object Object\]/);
});

test('resources: filters come from the URL and an admin sees every unit', async () => {
  const html = await renderList({
    user: ADMIN,
    path: `/manage/resources?status=archived&unit=${DIC}&q=printer`,
    cache: [[await listKey({ status: 'archived', orgUnit: DIC, q: 'printer' }), { data: [], meta: { page: 1, limit: 20, total: 0 } }]],
  });
  const shown = text(html);
  assert.match(shown, /As an admin you can list, edit and change the status of every unit’s resources\./);
  assert.match(html, /<option value=""[^>]*>All units<\/option>/);
  assert.match(html, new RegExp(`<option value="${DIC}" selected="">`));
  assert.match(html, /<option value="archived" selected="">Archived<\/option>/);
  assert.match(html, /value="printer"/);
  assert.match(shown, /No resources match/);
  assert.match(shown, /Clear filters/);
});

test('resources: loading, an error with the message, request id and retry, and the first-time empty state', async () => {
  const loading = await renderList();
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading your resources/);

  const failed = await renderList({
    errors: [[await listKey(), { status: 403, code: 'FORBIDDEN', message: 'Only managers can list resources that aren\'t active.', requestId: 'req-403' }]],
  });
  const shown = text(failed);
  assert.match(failed, /role="alert"/);
  assert.match(shown, /Couldn't load the resources/);
  assert.match(shown, /Only managers can list resources that aren't active\./);
  assert.match(shown, /ref: req-403/);
  assert.match(shown, /Try again/);

  const empty = await renderList({ cache: [[await listKey(), { data: [], meta: { page: 1, limit: 20, total: 0 } }]] });
  assert.match(text(empty), /No resources listed yet/);
  assert.match(text(empty), /List a resource/);
});

// ── The listing form ──────────────────────────────────────────────────────────

async function renderForm({ mode = 'new', user = MANAGER, resource = detail(), errors = [], badges = true, units = true } = {}) {
  const { default: ResourceFormPage } = await load('/src/features/manage/ResourceFormPage.jsx');
  const { manageResourceKeys } = await api();
  if (user) signIn(user);
  const cache = [];
  if (units) cache.push([await orgUnitKey(), { success: true, data: ORG_UNITS }]);
  if (badges) cache.push([manageResourceKeys.badges, { data: BADGES }]);
  if (mode === 'edit' && resource) cache.push([manageResourceKeys.detail(R1), { data: resource }]);
  return render((React) => React.createElement(ResourceFormPage, { mode }), {
    path: mode === 'edit' ? `/manage/resources/${R1}/edit` : '/manage/resources/new',
    route: mode === 'edit' ? '/manage/resources/:id/edit' : '/manage/resources/new',
    cache,
    errors,
  });
}

test('new listing: every section, only the units they manage, sensible defaults and a preview', async () => {
  const html = await renderForm();
  const shown = text(html);
  assert.match(html, /<h2[^>]*>List a resource<\/h2>/);
  for (const heading of ['Basics', 'Availability', 'Eligibility', 'Limits', 'Condition checklist', 'Preview']) {
    assert.match(html, new RegExp(`<h3[^>]*>${heading}</h3>`), heading);
  }
  assert.match(html, /<nav aria-label="Form sections"/);
  // Unit: the two they manage, nothing else.
  assert.match(html, /<select id="listing-orgUnit"[^>]*aria-required="true"/);
  assert.match(html, new RegExp(`<option value="${DIC}">Design and Innovation Centre \\(DIC\\)</option>`));
  assert.match(html, new RegExp(`<option value="${CW}">Central Workshop \\(CW\\)</option>`));
  assert.doesNotMatch(html, new RegExp(`<option value="${CSE}"`));
  // Basics.
  assert.match(html, /<label for="listing-title"[^>]*>Title<\/label><input id="listing-title"/);
  assert.match(html, /<select id="listing-category"/);
  assert.match(html, /id="listing-bookingMode-slot"[^>]*checked=""/);
  assert.match(html, /id="listing-riskLevel-low"[^>]*checked=""/);
  assert.match(html, /<input id="listing-quantity"[^>]*type="number"[^>]*value="1"/);
  assert.match(html, /<legend[^>]*>Photos \(optional\)<\/legend>/);
  assert.match(shown, /Up to 5 photos .* at most 3 per upload/);
  // Availability: Mon–Fri 09:00–17:00 to start from, weekend closed, 30-minute slots.
  assert.match(html, /id="listing-availability-weekly-0-open"[^>]*value="09:00"/);
  assert.match(html, /id="listing-availability-weekly-4-close"[^>]*value="17:00"/);
  assert.doesNotMatch(html, /id="listing-availability-weekly-5-open"/);
  assert.match(shown, /Now: Mon–Fri 09:00–17:00 ?\./);
  assert.match(shown, /Saturday Closed/);
  assert.match(html, /<label[^>]*for="listing-availability-weekly-0-open"[^>]*>Opens<span class="sr-only"> \(Monday, window 1\)<\/span>/);
  assert.match(html, /aria-label="Remove Monday, window 1"/);
  assert.match(html, /id="listing-availability-slotMinutes-30"[^>]*checked=""/);
  assert.match(shown, /No closures planned\./);
  // Eligibility: everyone by default; departments and badges from their lists.
  for (const type of ['ug', 'pg', 'rs', 'faculty', 'staff']) {
    assert.match(html, new RegExp(`id="listing-eligibility-memberTypes-${type}"[^>]*checked=""`), type);
  }
  assert.match(shown, /Computer Science and Engineering \(CSE\)/);
  assert.match(shown, /None ticked: members of every department may book it\./);
  assert.match(shown, /3D Printing Basics Issued by Design and Innovation Centre · valid 365 days/);
  assert.match(shown, /Workshop Safety Induction Issued by Central Workshop · never expires · needs evidence/);
  assert.match(html, /<a[^>]*href="\/manage\/badges"/);
  assert.match(html, /id="listing-eligibility-approvalMode-manual"[^>]*checked=""/);
  // Limits, checklist, preview, submit.
  assert.match(html, /<label for="listing-limits-maxDurationMins"[^>]*>Longest booking \(minutes\)/);
  assert.match(shown, /Items \(0 of 10\)/);
  assert.match(shown, /\+ Nozzle clean/);
  assert.match(html, /aria-label="Preview of Untitled resource"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Publish listing<\/button>/);
  assert.doesNotMatch(html, /aria-disabled="true"[^>]*type="submit"/, 'a new listing can always be submitted (and checked)');
  assert.match(html, /<a[^>]*href="\/manage\/resources"[^>]*>Cancel<\/a>/);
  assert.doesNotMatch(shown, /\[object Object\]/);
  assert.doesNotMatch(html, /listing-error-summary-heading/, 'no error summary before the first submit');
});

test('new listing: the badge link opens the badge queue in a new tab, so the form typed so far is kept', async () => {
  // An in-app link would drop the unsaved form (only a reload or a closed tab is guarded), and
  // /manage/badges reviews and grants badges; it doesn't create them.
  const html = await renderForm();
  const link = html.match(/<a([^>]*)>Badge requests and grants<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/);
  assert.ok(link, 'the link says it opens in a new tab');
  assert.match(link[1], /href="\/manage\/badges"/);
  assert.match(link[1], /target="_blank"/);
  assert.match(link[1], /rel="noopener noreferrer"/);
  assert.doesNotMatch(text(html), /Manage your units/);
});

test('new listing: a manager of one unit lists for it without choosing; a non-manager is told why not', async () => {
  const single = await renderForm({ user: ONE_UNIT_MANAGER });
  assert.doesNotMatch(single, /<select id="listing-orgUnit"/);
  assert.match(text(single), /Unit Design and Innovation Centre \(DIC\) The unit you manage/);
  assert.match(text(single), /Design and Innovation Centre \(DIC\)/, 'the preview names the unit');

  const nobody = await renderForm({ user: { ...MANAGER, managedOrgUnits: [] } });
  assert.match(text(nobody), /You don't manage a unit yet/);
  assert.doesNotMatch(nobody, /Publish listing/);

  const loading = await renderForm({ units: false, badges: false });
  assert.match(text(loading), /Loading your units/);
  assert.match(text(loading), /Loading the badges/);
});

test('edit: the listing as stored, who may edit it, and every row under the id its errors link to', async () => {
  const html = await renderForm({ mode: 'edit' });
  const shown = text(html);
  assert.match(html, /<h2[^>]*>FDM 3D Printer<\/h2>/);
  assert.match(shown, /Edit listing · Design and Innovation Centre \(DIC\)/);
  assert.match(shown, /You can edit it as a manager of Design and Innovation Centre\./);
  assert.match(html, new RegExp(`<a[^>]*href="/resources/${R1}"[^>]*>.*View it as members do</a>`, 's'));
  assert.match(shown, /A resource stays with the unit that listed it\./);
  assert.doesNotMatch(html, /<select id="listing-orgUnit"/, 'the unit is fixed');
  assert.match(html, /id="listing-title"[^>]*value="FDM 3D Printer"/);
  assert.match(html, /id="listing-riskLevel-medium"[^>]*checked=""/);
  assert.match(html, /<img[^>]*alt="Listing photo 1 of 1, FDM 3D Printer"/);
  // Monday has two windows: its second is row 1, the server's availability.weekly.1.
  assert.match(html, /id="listing-availability-weekly-1-open"[^>]*value="14:00"/);
  assert.match(html, /aria-label="Remove Monday, window 2"/);
  assert.match(html, /id="listing-availability-weekly-6-close"[^>]*value="13:00"/);
  assert.match(html, /id="listing-availability-blackouts-0-start"[^>]*value="2026-11-09T09:00"/);
  assert.match(html, /id="listing-availability-blackouts-0-reason"[^>]*value="Diwali holiday"/);
  assert.match(html, /id="listing-eligibility-memberTypes-ug"(?![^>]*checked)/);
  assert.match(html, /id="listing-eligibility-memberTypes-pg"[^>]*checked=""/);
  assert.match(html, new RegExp(`id="listing-eligibility-departments-${CSE}"[^>]*checked=""`));
  assert.match(html, new RegExp(`id="listing-eligibility-badges-${BADGE_3DP}"[^>]*checked=""`));
  assert.match(html, /id="listing-limits-maxDurationMins"[^>]*value="240"/);
  assert.match(shown, /= 4 h\./);
  assert.match(html, /id="listing-checklist-1"[^>]*value="Build plate undamaged"/);
  assert.match(shown, /No changes yet\./);
  assert.match(html, /<button[^>]*aria-disabled="true"[^>]*type="submit"[^>]*>Save changes<\/button>/, 'nothing to save until something changes');
  // The preview reads the server's wording of the hours.
  assert.match(shown, /Mon 09:00–13:00, 14:00–17:00; Tue–Fri 09:00–17:00; Sat 09:00–13:00 · 1 closure planned · 30-minute slots/);

  // Every control an error can point at is on the page under that id.
  const m = await model();
  const focus = await load('/src/features/manage/resources/focus.js');
  const values = m.formValues(m.formFromResource(detail()));
  for (const path of m.formPathOrder(values)) {
    if (path === 'orgUnit' || /^availability\.(weekly|blackouts)\.\d+$/.test(path)) continue; // fixed, or a row (its first input)
    const id = m.fieldDomId(focus.focusPathFor(path));
    assert.match(html, new RegExp(`id="${id}"`), `${path} → #${id}`);
  }
});

test('edit: a selection the lists no longer offer stays visible instead of being dropped', async () => {
  const goneBadge = { _id: '64b0000000000000000b0ld0', name: 'Old Kiln Training', code: 'old-kiln', orgUnit: { _id: LIB, name: 'Old Lab' } };
  const html = await renderForm({
    mode: 'edit',
    resource: detail({ eligibility: { ...detail().eligibility, badges: [goneBadge] } }),
  });
  const shown = text(html);
  assert.match(shown, /Also required Old Kiln Training Its unit isn't active any more\. Untick to remove it\./);
  assert.match(html, /id="listing-eligibility-badges-64b0000000000000000b0ld0"[^>]*checked=""/);
});

test('edit: read-only when canManage is false; loading; and a 404 with its message, request id and retry', async () => {
  const locked = await renderForm({ mode: 'edit', user: MEMBER, resource: detail({ canManage: false }) });
  assert.match(text(locked), /You can't edit this listing\./);
  assert.match(text(locked), /You are neither, so it is read-only for you\./);
  assert.doesNotMatch(locked, /Save changes/);

  const loading = await renderForm({ mode: 'edit', resource: null });
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the listing/);

  const { manageResourceKeys } = await api();
  const missing = await renderForm({
    mode: 'edit',
    resource: null,
    errors: [[manageResourceKeys.detail(R1), { status: 404, code: 'NOT_FOUND', message: 'Resource not found.', requestId: 'req-404' }]],
  });
  const shown = text(missing);
  assert.match(missing, /role="alert"/);
  assert.match(shown, /Couldn't load the resource/);
  assert.match(shown, /Resource not found\./);
  assert.match(shown, /ref: req-404/);
  assert.match(shown, /Try again/);
  assert.match(missing, /href="\/manage\/resources"/);
});

test('the error summary links each problem to its control and counts them', async () => {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ErrorSummary } = await load('/src/features/manage/resources/ErrorSummary.jsx');
  const m = await model();
  const values = m.formValues(m.emptyForm());
  const items = m.errorSummary(m.validateListing(values, { mode: 'new' }), values);
  const html = renderToStaticMarkup(
    React.createElement(ErrorSummary, { items, other: [{ path: 'status', message: "This field can't be set." }], action: 'publishing' }),
  );
  // Read when it takes focus after a refused submit; not live, or each keystroke would re-read it.
  assert.match(html, /^<div tabindex="-1" role="region" aria-labelledby="listing-error-summary-heading"/);
  assert.doesNotMatch(html, /role="alert"|aria-live/);
  assert.match(text(html), /Fix 5 problems before publishing/);
  assert.match(html, /href="#listing-orgUnit"/);
  assert.match(html, /href="#listing-title"/);
  assert.match(html, /href="#listing-checklist"/);
  assert.match(text(html), /status: This field can't be set\./);
  assert.equal(renderToStaticMarkup(React.createElement(ErrorSummary, { items: [] })), '');
});
