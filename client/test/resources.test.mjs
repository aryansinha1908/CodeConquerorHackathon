// Tests for Explore, the resource detail page and the booking panel (features/resources, the two
// pages) against docs/api.md "Resources", "Org units" and "Bookings" (check and create). Run with
// `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/foundations.test.mjs. Requests go to a
// fake axios adapter; components render with react-dom/server from a pre-filled React Query cache
// holding data shaped exactly as docs/api.md describes, so a crash such as rendering an object as
// text (a location, a badge) shows up here.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AxiosError } from 'axios';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let load;
let http;

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
});

after(async () => {
  await server?.close();
});

const api = () => load('/src/features/resources/api.js');
const format = () => load('/src/features/resources/format.js');
const slots = () => load('/src/features/resources/slots.js');

// ── Fakes ─────────────────────────────────────────────────────────────────────

// routes: { 'GET /resources': (config) => answer }. An answer is { status, data, meta } or
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

const DIC = { _id: '64a000000000000000000d1c', name: 'Design and Innovation Centre', code: 'dic', type: 'centre' };
const BADGE = {
  _id: '64b0000000000000000000b1',
  name: '3D Printing Basics',
  code: '3d-printing-basics',
  orgUnit: { _id: DIC._id, name: DIC.name },
};
const RESOURCE_ID = '64c000000000000000000001';
const MON_TO_SAT = [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '17:00' }));

// A Card from GET /resources.
const card = (overrides = {}) => ({
  _id: RESOURCE_ID,
  title: 'FDM 3D Printer',
  slug: 'fdm-3d-printer',
  description: 'Single-nozzle FDM printer with a 250 × 210 × 220 mm build volume.',
  images: [],
  category: 'equipment',
  bookingMode: 'slot',
  quantity: 1,
  riskLevel: 'medium',
  location: { building: 'Design and Innovation Centre', room: 'Prototyping Lab', floor: 'Ground' },
  status: 'active',
  availability: { weekly: MON_TO_SAT, slotMinutes: 30 },
  eligibility: {
    memberTypes: ['ug', 'pg', 'rs', 'faculty', 'staff'],
    departments: [],
    badges: [BADGE],
    approvalMode: 'manual',
  },
  limits: {
    minDurationMins: 30,
    maxDurationMins: 240,
    maxHoursPerWeek: 6,
    maxActiveBookings: 1,
    leadTimeMins: 120,
    maxAdvanceDays: 14,
  },
  orgUnit: DIC,
  openHours: 'Mon–Sat 09:00–17:00',
  createdAt: '2026-10-20T04:30:00.000Z',
  updatedAt: '2026-10-20T04:30:00.000Z',
  ...overrides,
});

// The Detail of GET /resources/:id: the card plus usageRules, checklist, blackouts, canManage.
const detail = (overrides = {}) => {
  const base = card();
  return {
    ...base,
    usageRules: 'PLA and PETG only; no ABS or resin.\nStay with the printer until the first layer is down.',
    checklist: ['Nozzle clean', 'Build plate undamaged'],
    availability: { ...base.availability, blackouts: [] },
    canManage: false,
    ...overrides,
  };
};

const UNITS = [
  { _id: '64a000000000000000000c5e', code: 'cse', name: 'Computer Science and Engineering', type: 'department', isActive: true },
  { _id: DIC._id, code: 'dic', name: 'Design and Innovation Centre', type: 'centre', isActive: true },
];

const rule = (id, passed, message, extra = {}) => ({
  rule: id,
  hard: id !== 'AVAILABILITY',
  passed,
  message,
  fixHint: null,
  ...extra,
});

// GET /resources/:id/eligibility without a slot: the 7 member rules and the quota.
const memberEligibility = () => ({
  eligible: false,
  results: [
    rule('ACCOUNT_VERIFIED', true, 'Your ID card is verified.'),
    rule('NOT_SUSPENDED', true, 'Your account is in good standing.'),
    rule('RESOURCE_ACTIVE', true, 'This resource is open for booking.'),
    rule('MEMBER_TYPE', true, 'UG students can book this.'),
    rule('DEPARTMENT', true, 'Open to all departments.'),
    rule('BADGES', false, 'Missing badge: 3D Printing Basics.', {
      fixHint: 'Request it from Design and Innovation Centre.',
      meta: { badges: [{ id: BADGE._id, name: '3D Printing Basics', issue: 'missing' }] },
    }),
    rule('ACTIVE_BOOKINGS', true, 'You hold 0 of 1 active bookings allowed here.', { meta: { used: 0, limit: 1 } }),
  ],
  quota: { hoursThisWeek: 4, maxHoursPerWeek: 6, activeCount: 1, maxActiveBookings: 1 },
});

// POST /bookings/check: all 12 rules, the slot taken.
const slotTakenCheck = () => ({
  eligible: true,
  outcome: 'slot_taken',
  waitlistPosition: 1,
  results: [
    rule('ACCOUNT_VERIFIED', true, 'Your ID card is verified.'),
    rule('NOT_SUSPENDED', true, 'Your account is in good standing.'),
    rule('RESOURCE_ACTIVE', true, 'This resource is open for booking.'),
    rule('MEMBER_TYPE', true, 'UG students can book this.'),
    rule('DEPARTMENT', true, 'Open to all departments.'),
    rule('BADGES', true, 'You hold 3D Printing Basics.'),
    rule('OPEN_HOURS', true, 'Within opening hours (Mon–Sat 09:00–17:00).'),
    rule('DURATION', true, '2 h is within the allowed length.'),
    rule('BOOKING_WINDOW', true, 'The start time is within the booking window.'),
    rule('WEEKLY_HOURS', true, '0 of 6 hours used this week; this booking adds 2.', {
      meta: { used: 0, requested: 2, limit: 6 },
    }),
    rule('ACTIVE_BOOKINGS', true, 'You hold 0 of 1 active bookings allowed here.', { meta: { used: 0, limit: 1 } }),
    rule('AVAILABILITY', false, 'This slot is held by an earlier request.', {
      fixHint: 'Join the waitlist as #1?',
      meta: { taken: 1, quantity: 1, waitlistPosition: 1 },
    }),
  ],
});

// The Booking object as stored (POST /bookings answers with bare ids).
const storedBooking = (overrides = {}) => ({
  _id: '64d0000000000000000000b1',
  resource: RESOURCE_ID,
  orgUnit: DIC._id,
  borrower: '64e000000000000000000a01',
  start: '2026-11-03T04:30:00.000Z',
  end: '2026-11-03T06:30:00.000Z',
  purpose: 'Printing the chassis for the robotics club',
  status: 'pending',
  eligibilitySnapshot: [{ rule: 'ACCOUNT_VERIFIED', passed: true, message: 'Your ID card is verified.' }],
  incidents: [],
  flags: { overdue: false },
  createdAt: '2026-10-29T06:00:00.000Z',
  updatedAt: '2026-10-29T06:00:00.000Z',
  __v: 0,
  ...overrides,
});

// "2026-11-03", "10:00" (IST) → the ISO instant.
const ist = (dateKey, time) => new Date(`${dateKey}T${time}:00+05:30`).toISOString();

// The server's openWindows for Mon–Sat 09:00–17:00 over [from, from + days), with a Wednesday
// afternoon closure cut out, like engines/availability.js.
function windowsFor(dateKeys, { cut = null } = {}) {
  return dateKeys.flatMap((key) => {
    const weekday = new Date(`${key}T12:00:00+05:30`).getUTCDay();
    if (weekday === 0) return [];
    if (cut && cut.dateKey === key) return [{ start: ist(key, '09:00'), end: ist(key, cut.from) }];
    return [{ start: ist(key, '09:00'), end: ist(key, '17:00') }];
  });
}

const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];

// ── Rendering ─────────────────────────────────────────────────────────────────

// Renders inside a router and a QueryClient whose cache holds `cache` ([key, data] pairs) and
// `errors` ([key, error] pairs, as a query that failed), as in foundations.test.mjs.
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

// The whole element whose opening tag contains `index` (static markup, so tags are balanced and
// void elements are the usual few).
function elementAt(html, index) {
  const start = html.lastIndexOf('<', index);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(start))[1];
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

// WCAG 2.1 contrast of two #rrggbb colours.
function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── api.js: requests ──────────────────────────────────────────────────────────

test('listResources sends the filters GET /resources takes and unwraps data and meta', async () => {
  const { listResources } = await api();
  const calls = fakeApi({
    'GET /resources': () => ({ status: 200, data: [card()], meta: { page: 2, limit: 12, total: 13 } }),
  });
  const res = await listResources({
    q: '  3D printer  ',
    category: 'equipment',
    orgUnit: DIC._id,
    eligibleOnly: true,
    page: 2,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'GET /resources');
  assert.deepEqual(calls[0].params, {
    q: '3D printer',
    category: 'equipment',
    orgUnit: DIC._id,
    eligibleOnly: true,
    page: 2,
    limit: 12,
  });
  const url = http.getUri({ url: calls[0].config.url, params: calls[0].params });
  assert.match(url, /eligibleOnly=true/);
  assert.deepEqual(res.meta, { page: 2, limit: 12, total: 13 });
  assert.equal(res.data[0].title, 'FDM 3D Printer');
});

test('"all" is never sent: unknown categories, non-id units and a false eligibleOnly are left out', async () => {
  const { listResources, resourceListParams } = await api();
  const calls = fakeApi({ 'GET /resources': () => ({ status: 200, data: [], meta: { page: 1, limit: 12, total: 0 } }) });
  await listResources({ q: '   ', category: 'all', orgUnit: 'all', eligibleOnly: false });
  assert.deepEqual(calls[0].params, { page: 1, limit: 12 });
  const url = http.getUri({ url: calls[0].config.url, params: calls[0].params });
  assert.doesNotMatch(url, /all|eligibleOnly|category|orgUnit/);
  // The old mock categories aren't the backend's enum.
  assert.equal(resourceListParams({ category: '3d_printer' }).category, undefined);
  assert.equal(resourceListParams({ q: 'x'.repeat(150) }).q.length, 100);
  assert.equal(resourceListParams({ page: '0', limit: 500 }).page, 1);
  assert.equal(resourceListParams({ limit: 500 }).limit, 50);
  assert.equal(resourceListParams({ eligibleOnly: 'true' }).eligibleOnly, true);
});

test('getResource, availability and eligibility call their routes with the right params', async () => {
  const { getResource, getResourceAvailability, getResourceEligibility } = await api();
  const calls = fakeApi({
    [`GET /resources/${RESOURCE_ID}`]: () => ({ status: 200, data: detail() }),
    [`GET /resources/${RESOURCE_ID}/availability`]: () => ({
      status: 200,
      data: { quantity: 1, openWindows: [], busy: [] },
    }),
    [`GET /resources/${RESOURCE_ID}/eligibility`]: () => ({ status: 200, data: memberEligibility() }),
  });
  const one = await getResource(RESOURCE_ID);
  assert.equal(one.data.usageRules.startsWith('PLA'), true);
  assert.equal(one.meta, undefined);

  await getResourceAvailability(RESOURCE_ID, { from: new Date(ist('2026-11-02', '00:00')), to: ist('2026-11-09', '00:00') });
  assert.deepEqual(calls[1].params, { from: '2026-11-01T18:30:00.000Z', to: '2026-11-08T18:30:00.000Z' });

  const member = await getResourceEligibility(RESOURCE_ID);
  assert.equal(calls[2].params, undefined, 'no slot: neither start nor end');
  assert.deepEqual(member.data.quota, memberEligibility().quota);

  await getResourceEligibility(RESOURCE_ID, { start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00') });
  assert.deepEqual(calls[3].params, { start: '2026-11-03T04:30:00.000Z', end: '2026-11-03T06:30:00.000Z' });
  await getResourceEligibility(RESOURCE_ID, { start: ist('2026-11-03', '10:00') });
  assert.equal(calls[4].params, undefined, 'start and end go together or not at all');
});

test('a failed request rejects with the normalised error, never a made-up answer', async () => {
  const { getResource, listResources } = await api();
  fakeApi({
    [`GET /resources/${RESOURCE_ID}`]: () => ({ status: 404, code: 'NOT_FOUND', message: 'Resource not found.' }),
    'GET /resources': () => ({ status: 500, code: 'INTERNAL', message: 'Something went wrong.' }),
  });
  const err = await rejection(getResource(RESOURCE_ID));
  assert.equal(err.status, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'Resource not found.');
  assert.equal(err.requestId, 'req-err');
  const listErr = await rejection(listResources({}));
  assert.equal(listErr.code, 'INTERNAL');
});

test('the Explore URL round-trips its filters and any filter change goes back to page 1', async () => {
  const { readExploreFilters, writeExploreFilters, hasExploreFilters } = await api();
  const read = (query) => readExploreFilters(new URLSearchParams(query));
  assert.deepEqual(read(''), { q: '', category: '', orgUnit: '', eligibleOnly: false, page: 1 });
  assert.deepEqual(read(`q=printer&category=equipment&unit=${DIC._id}&eligibleOnly=true&page=3`), {
    q: 'printer',
    category: 'equipment',
    orgUnit: DIC._id,
    eligibleOnly: true,
    page: 3,
  });
  assert.deepEqual(read('category=all&unit=all&eligibleOnly=1&page=-2'), {
    q: '',
    category: '',
    orgUnit: '',
    eligibleOnly: false,
    page: 1,
  });

  const start = new URLSearchParams('q=printer&page=3');
  assert.equal(writeExploreFilters(start, { category: 'tool' }).toString(), 'q=printer&category=tool');
  assert.equal(writeExploreFilters(start, { page: 4 }).toString(), 'q=printer&page=4');
  assert.equal(writeExploreFilters(start, { page: 1 }).toString(), 'q=printer');
  assert.equal(writeExploreFilters(start, { q: '  ' }).toString(), '');
  assert.equal(writeExploreFilters(start, { eligibleOnly: true }).toString(), 'q=printer&eligibleOnly=true');
  assert.equal(writeExploreFilters(start, { orgUnit: 'all' }).toString(), 'q=printer');
  assert.equal(writeExploreFilters('', { orgUnit: DIC._id }).toString(), `unit=${DIC._id}`);
  assert.equal(hasExploreFilters(read('page=2')), false);
  assert.equal(hasExploreFilters(read('eligibleOnly=true')), true);
});

test('the resource query keys follow frontend.md §8.2, and a booking change marks them stale', async () => {
  const { resourceKeys } = await api();
  const { keysToInvalidate } = await load('/src/features/bookings/api.js');
  const { QueryClient } = await import('@tanstack/react-query');
  const range = { from: ist('2026-11-02', '00:00'), to: ist('2026-11-09', '00:00') };
  const slot = { start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00') };
  assert.deepEqual(resourceKeys.detail(RESOURCE_ID), ['resource', RESOURCE_ID]);
  assert.deepEqual(resourceKeys.availability(RESOURCE_ID, range), ['resource', RESOURCE_ID, 'availability', range]);
  assert.deepEqual(resourceKeys.eligibility(RESOURCE_ID), ['resource', RESOURCE_ID, 'eligibility', null]);
  assert.deepEqual(resourceKeys.eligibility(RESOURCE_ID, slot), ['resource', RESOURCE_ID, 'eligibility', slot]);
  assert.deepEqual(resourceKeys.list({ category: 'all' }), ['resources', { page: 1, limit: 12 }]);

  const client = new QueryClient();
  const keys = {
    availability: resourceKeys.availability(RESOURCE_ID, range),
    member: resourceKeys.eligibility(RESOURCE_ID),
    check: resourceKeys.eligibility(RESOURCE_ID, slot),
    detail: resourceKeys.detail(RESOURCE_ID),
    list: resourceKeys.list({}),
  };
  for (const key of Object.values(keys)) client.setQueryData(key, { data: {} });
  for (const queryKey of keysToInvalidate({ id: 'b1', resourceId: RESOURCE_ID })) {
    await client.invalidateQueries({ queryKey, refetchType: 'none' });
  }
  const stale = (key) => client.getQueryState(key).isInvalidated;
  assert.equal(stale(keys.availability), true);
  assert.equal(stale(keys.member), true);
  assert.equal(stale(keys.check), true, 'the pre-check sits under the eligibility key, so it re-checks');
  assert.equal(stale(keys.detail), false);
  assert.equal(stale(keys.list), false);
  client.clear();
});

// ── format.js ─────────────────────────────────────────────────────────────────

test('categories are the backend enum with readable labels; risk, status and approval have labels', async () => {
  const { CATEGORY_OPTIONS, categoryLabel, riskView, resourceStatusView, approvalView, bookingModeLabel, formatQuantity } =
    await format();
  assert.deepEqual(
    CATEGORY_OPTIONS.map((o) => o.value),
    ['space', 'equipment', 'computing', 'tool'],
  );
  assert.deepEqual(
    CATEGORY_OPTIONS.map((o) => o.label),
    ['Spaces', 'Equipment', 'Computing', 'Tools'],
  );
  assert.equal(categoryLabel('tool'), 'Tool');
  assert.equal(categoryLabel('lab_bench'), 'Lab bench');
  assert.equal(riskView('high').label, 'High risk');
  assert.equal(riskView('high').variant, 'red');
  assert.equal(riskView(undefined).label, 'Risk not set');
  assert.equal(resourceStatusView('maintenance').label, 'Under maintenance');
  assert.equal(approvalView('auto').label, 'Instant approval');
  assert.equal(approvalView(undefined).label, 'Manager approval', 'manual is the default');
  assert.equal(bookingModeLabel('loan'), 'Loan (pick up and return)');
  assert.equal(formatQuantity(1), '1 unit');
  assert.equal(formatQuantity(3), '3 units');
});

test('formatLocation turns the location object into one line', async () => {
  const { formatLocation } = await format();
  assert.equal(
    formatLocation({ building: 'Design and Innovation Centre', room: 'Prototyping Lab', floor: 'Ground' }),
    'Prototyping Lab, Design and Innovation Centre (Ground floor)',
  );
  assert.equal(formatLocation({ building: 'Central Workshop', floor: '1' }), 'Central Workshop (floor 1)');
  assert.equal(formatLocation({ room: 'Lab 2', floor: 'First floor' }), 'Lab 2 (First floor)');
  assert.equal(formatLocation({ floor: 'Ground' }), 'Ground floor');
  assert.equal(formatLocation({}), null);
  assert.equal(formatLocation(undefined), null);
  assert.equal(formatLocation('DIC Lab 2'), 'DIC Lab 2');
});

test('quotaView reads like frontend.md §7, with and without limits', async () => {
  const { quotaView, formatHours } = await format();
  const view = quotaView({ hoursThisWeek: 4, maxHoursPerWeek: 6, activeCount: 1, maxActiveBookings: 1 });
  assert.equal(view.text, '4 of 6 h this week · 1 of 1 active booking');
  assert.equal(view.hours.ratio, 4 / 6);
  assert.equal(view.active.ratio, 1);
  const open = quotaView({ hoursThisWeek: 1.5, maxHoursPerWeek: null, activeCount: 2, maxActiveBookings: null });
  assert.equal(open.text, '1.5 h this week (no weekly limit) · 2 active bookings (no limit)');
  assert.equal(open.hours.limit, null);
  assert.equal(quotaView(null), null);
  assert.equal(formatHours(2.25), '2.3');
  assert.equal(formatHours(8), '8');
});

test('limitsList, memberTypesText and departmentsText describe the rules in words', async () => {
  const { limitsList, memberTypesText, departmentsText } = await format();
  assert.deepEqual(limitsList(card().limits), [
    { label: 'Length', value: '30 min to 4 h' },
    { label: 'Weekly limit', value: '6 h per member' },
    { label: 'Active bookings', value: 'at most 1 at a time' },
    { label: 'Book ahead', value: 'at least 2 h' },
    { label: 'Furthest ahead', value: '14 days' },
  ]);
  assert.deepEqual(limitsList({ maxDurationMins: 4320 }), [{ label: 'Longest booking', value: '3 days' }]);
  assert.deepEqual(limitsList(undefined), []);
  assert.equal(memberTypesText(['ug', 'pg', 'rs', 'faculty', 'staff']), 'Everyone');
  assert.equal(memberTypesText([]), 'Everyone');
  assert.equal(memberTypesText(['pg', 'rs', 'faculty']), 'PG students, Research scholars and Faculty');
  assert.equal(departmentsText([]), 'All departments');
  assert.equal(
    departmentsText([
      { _id: 'a', code: 'cse', name: 'CSE' },
      { _id: 'b', code: 'ece', name: 'ECE' },
    ]),
    'CSE and ECE',
  );
});

test('fix links: a failed BADGES rule links to /badges?request=<code>, via the meta id', async () => {
  const { fixLinksFor, ruleLabel, isBlocking } = await format();
  const resource = detail();
  const badges = memberEligibility().results.find((r) => r.rule === 'BADGES');
  assert.deepEqual(fixLinksFor(badges, resource), [
    { to: '/badges?request=3d-printing-basics', label: 'Request 3D Printing Basics' },
  ]);
  const expired = { ...badges, meta: { badges: [{ id: BADGE._id, name: '3D Printing Basics', issue: 'expired' }] } };
  assert.deepEqual(fixLinksFor(expired, resource), [
    { to: '/badges?request=3d-printing-basics', label: 'Renew 3D Printing Basics' },
  ]);
  const requested = { ...badges, meta: { badges: [{ id: BADGE._id, name: '3D Printing Basics', issue: 'requested' }] } };
  assert.deepEqual(fixLinksFor(requested, resource), [
    { to: '/badges', label: 'See your 3D Printing Basics request' },
  ]);
  // A 422's details carry no meta: the resource's one required badge is the one to request.
  const fromDetails = { rule: 'BADGES', passed: false, message: 'Missing badge: 3D Printing Basics.', fixHint: null };
  assert.deepEqual(fixLinksFor(fromDetails, resource), [
    { to: '/badges?request=3d-printing-basics', label: 'Request 3D Printing Basics' },
  ]);
  assert.deepEqual(fixLinksFor({ rule: 'ACCOUNT_VERIFIED', passed: false }, resource), [
    { to: '/verification', label: 'Go to ID verification' },
  ]);
  assert.deepEqual(fixLinksFor({ rule: 'RESOURCE_ACTIVE', passed: false }, resource), [
    { to: '/explore?category=equipment', label: 'See similar resources' },
  ]);
  assert.deepEqual(fixLinksFor({ rule: 'BADGES', passed: true }, resource), []);
  assert.equal(ruleLabel('WEEKLY_HOURS'), 'Weekly hours');
  assert.equal(ruleLabel('SOMETHING_NEW'), 'Something new');
  assert.equal(isBlocking(rule('AVAILABILITY', false, 'Taken')), false, 'AVAILABILITY is soft');
  assert.equal(isBlocking(rule('DURATION', false, 'Too long')), true);
});

// ── slots.js ──────────────────────────────────────────────────────────────────

// Mon 2 – Sun 8 Nov 2026; Mon–Sat 09:00–17:00; a closure on Wed from 13:00; the Tuesday 10:00–12:00
// slot held by a booking; now is Mon 2 Nov, 11:10 IST.
async function sampleGrid(overrides = {}) {
  const { buildSlotGrid, availabilityRange } = await slots();
  const range = availabilityRange('2026-11-02');
  return buildSlotGrid({
    range,
    slotMinutes: 30,
    openWindows: windowsFor(WEEK, { cut: { dateKey: '2026-11-04', from: '13:00' } }),
    busy: [{ start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00'), inUse: 1, full: true }],
    quantity: 1,
    weekly: MON_TO_SAT,
    blackouts: [
      { _id: 'bl1', start: ist('2026-11-04', '13:00'), end: ist('2026-11-04', '18:00'), reason: 'Printer service' },
    ],
    now: ist('2026-11-02', '11:10'),
    ...overrides,
  });
}

test('availabilityRange runs from IST midnight for 7 days', async () => {
  const { availabilityRange } = await slots();
  assert.deepEqual(availabilityRange('2026-11-02'), {
    from: '2026-11-01T18:30:00.000Z',
    to: '2026-11-08T18:30:00.000Z',
  });
  // Any instant on that IST day gives the same range (a stable query key).
  assert.deepEqual(availabilityRange(Date.parse(ist('2026-11-02', '23:59'))), availabilityRange('2026-11-02'));
  assert.equal(availabilityRange('not a day'), null);
});

test('buildSlotGrid marks free, taken, past, closure and closed slots from the availability answer', async () => {
  const model = await sampleGrid();
  assert.equal(model.days.length, 7);
  assert.equal(model.rows.length, 16, '09:00 to 16:30 in 30-minute steps');
  assert.equal(model.rows[0].label, '09:00');
  assert.equal(model.rows.at(-1).label, '16:30');
  assert.deepEqual(
    model.days.map((d) => d.label),
    ['Mon, 2 Nov', 'Tue, 3 Nov', 'Wed, 4 Nov', 'Thu, 5 Nov', 'Fri, 6 Nov', 'Sat, 7 Nov', 'Sun, 8 Nov'],
  );
  const [mon, tue, wed, , , , sun] = model.days;
  assert.equal(mon.isToday, true);
  assert.equal(mon.cells[0].state, 'past');
  assert.equal(mon.cells[4].state, 'past', '11:00 started before 11:10');
  assert.equal(mon.cells[5].state, 'free');
  assert.equal(mon.cells[5].start, ist('2026-11-02', '11:30'));
  assert.equal(tue.cells[2].state, 'full');
  assert.equal(tue.cells[5].state, 'full', '11:30 is still held');
  assert.equal(tue.cells[6].state, 'free', 'free again from 12:00');
  assert.equal(wed.cells[7].state, 'free');
  assert.equal(wed.cells[8].state, 'blackout');
  assert.equal(wed.cells[8].reason, 'Printer service');
  assert.ok(sun.cells.every((c) => c.state === 'closed'));
  assert.equal(sun.open, false);
  assert.equal(model.hasOpenSlots, true);

  // Two units, one in use: some in use, not full.
  const shared = await sampleGrid({
    quantity: 2,
    busy: [{ start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00'), inUse: 1, full: false }],
  });
  assert.equal(shared.days[1].cells[2].state, 'partial');
  assert.equal(shared.days[1].cells[2].inUse, 1);

  const { buildSlotGrid } = await slots();
  const closed = buildSlotGrid({ range: { from: ist('2026-11-02', '00:00'), to: ist('2026-11-09', '00:00') } });
  assert.equal(closed.rows.length, 0);
  assert.equal(closed.hasOpenSlots, false);
  assert.equal(buildSlotGrid({ range: null }).days.length, 0);
});

test('pickCell: a first pick selects one slot; a later one in the same window extends it', async () => {
  const { pickCell } = await slots();
  const model = await sampleGrid();
  const mon = model.days[0];
  const tue = model.days[1];

  let state = pickCell({ cell: mon.cells[5] });
  assert.deepEqual(state.selection, { start: ist('2026-11-02', '11:30'), end: ist('2026-11-02', '12:00') });
  assert.equal(state.anchor.key, mon.cells[5].key);

  state = pickCell({ ...state, cell: mon.cells[7] });
  assert.deepEqual(state.selection, { start: ist('2026-11-02', '11:30'), end: ist('2026-11-02', '13:00') });
  assert.equal(state.anchor, null);

  // Before the anchor, or another day in slot mode: start again from the new slot.
  const anchored = pickCell({ cell: mon.cells[8] });
  const back = pickCell({ ...anchored, cell: mon.cells[6] });
  assert.deepEqual(back.selection, { start: ist('2026-11-02', '12:00'), end: ist('2026-11-02', '12:30') });
  const otherDay = pickCell({ ...anchored, cell: tue.cells[4] });
  assert.equal(otherDay.selection.start, ist('2026-11-03', '11:00'));

  // A loan can end on another day.
  const loan = pickCell({ ...anchored, cell: tue.cells[4], mode: 'loan' });
  assert.deepEqual(loan.selection, { start: ist('2026-11-02', '13:00'), end: ist('2026-11-03', '11:30') });

  // A taken slot can be picked (the booking joins the waitlist); past, closed and closure slots can't.
  assert.equal(pickCell({ cell: tue.cells[2] }).selection.start, ist('2026-11-03', '10:00'));
  const unchanged = { selection: { start: 'a', end: 'b' }, anchor: null };
  assert.deepEqual(pickCell({ ...unchanged, cell: mon.cells[0] }), unchanged);
  assert.deepEqual(pickCell({ ...unchanged, cell: model.days[6].cells[3] }), unchanged);
  assert.deepEqual(pickCell({ ...unchanged, cell: model.days[2].cells[9] }), unchanged);
});

test('the pickers offer starts per day and ends inside the window (slot) or any later open slot (loan)', async () => {
  const { startDayOptions, startTimeOptions, endOptions, endDayOptions, selectionFromStart, defaultEnd } = await slots();
  const model = await sampleGrid();
  assert.deepEqual(
    startDayOptions(model).map((o) => o.label),
    ['Mon, 2 Nov', 'Tue, 3 Nov', 'Wed, 4 Nov', 'Thu, 5 Nov', 'Fri, 6 Nov', 'Sat, 7 Nov'],
  );
  const monStarts = startTimeOptions(model, '0');
  assert.equal(monStarts[0].label, '11:30', 'past slots are not offered');
  const tueStarts = startTimeOptions(model, '1');
  assert.equal(tueStarts[2].label, '10:00 (taken, waitlist)');
  assert.equal(startTimeOptions(model, '2').length, 8, 'Wednesday closes at 13:00');
  assert.deepEqual(startTimeOptions(model, ''), [], 'no day chosen, no times');

  const start = ist('2026-11-02', '11:30');
  const slotEnds = endOptions(model, start, 'slot');
  assert.equal(slotEnds.length, 11);
  assert.equal(slotEnds[0].label, '12:00 (30 min)');
  assert.equal(slotEnds.at(-1).label, '17:00 (5 h 30 min)');
  assert.ok(slotEnds.every((o) => o.dayIndex === 0));

  const loanEnds = endOptions(model, ist('2026-11-02', '16:00'), 'loan');
  assert.deepEqual(
    endDayOptions(model, loanEnds).map((o) => o.label),
    ['Mon, 2 Nov', 'Tue, 3 Nov', 'Wed, 4 Nov', 'Thu, 5 Nov', 'Fri, 6 Nov', 'Sat, 7 Nov'],
  );

  assert.equal(defaultEnd(model, start, 'slot', 60), ist('2026-11-02', '12:30'));
  assert.deepEqual(selectionFromStart(model, start, { previousEnd: ist('2026-11-02', '14:00') }), {
    start,
    end: ist('2026-11-02', '14:00'),
  });
  assert.deepEqual(selectionFromStart(model, start, { previousEnd: ist('2026-11-03', '14:00'), minMinutes: 30 }), {
    start,
    end: ist('2026-11-02', '12:00'),
  });
  assert.equal(selectionFromStart(model, ist('2026-11-02', '09:00')), null, 'a past start');
});

test('selections and cells are described in IST words', async () => {
  const { describeSelection, describeCell, selectionKey, selectionFromKey, isCellSelected } = await slots();
  const model = await sampleGrid();
  const selection = { start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00') };
  assert.equal(describeSelection(selection), 'Tue, 3 Nov, 10:00–12:00 (2 h)');
  assert.equal(
    describeSelection({ start: ist('2026-11-02', '16:00'), end: ist('2026-11-04', '10:00') }),
    'Mon, 2 Nov, 16:00 → Wed, 4 Nov, 10:00 (1 day 18 h)',
  );
  assert.equal(describeSelection(null), null);
  assert.equal(describeCell(model.days[1].cells[2], 1), 'Tue, 3 Nov, 10:00–10:30: taken, waitlist only');
  assert.equal(describeCell(model.days[2].cells[8], 1), 'Wed, 4 Nov, 13:00–13:30: closed: Printer service');
  assert.equal(describeCell(model.days[0].cells[5], 2), 'Mon, 2 Nov, 11:30–12:00: free, 2 units');
  const key = selectionKey(selection);
  assert.equal(key, '2026-11-03T04:30:00.000Z|2026-11-03T06:30:00.000Z');
  assert.deepEqual(selectionFromKey(key), selection);
  assert.equal(selectionKey({ start: selection.start }), '');
  assert.equal(isCellSelected(model.days[1].cells[2], selection), true);
  assert.equal(isCellSelected(model.days[1].cells[5], selection), true);
  assert.equal(isCellSelected(model.days[1].cells[6], selection), false);
});

// ── Components ────────────────────────────────────────────────────────────────

test('ResourceCard shows unit, risk, approval, badges, the formatted location and open hours', async () => {
  const { ResourceCard } = await load('/src/features/resources/components/ResourceCard.jsx');
  const html = await render((React) => React.createElement(ResourceCard, { resource: card() }));
  const t = text(html);
  assert.match(t, /FDM 3D Printer/);
  assert.match(t, /Design and Innovation Centre \(DIC\)/);
  assert.match(t, /Medium risk/);
  assert.match(t, /Manager approval/);
  assert.match(t, /3D Printing Basics/);
  assert.match(t, /Prototyping Lab, Design and Innovation Centre \(Ground floor\)/);
  assert.match(t, /Mon–Sat 09:00–17:00/);
  assert.match(t, /Equipment/);
  assert.doesNotMatch(t, /\[object Object\]/);
  assert.match(html, new RegExp(`href="/resources/${RESOURCE_ID}"`));
  assert.doesNotMatch(html, /<a[^>]*>[^<]*<button/, 'no button inside a link');

  const loan = text(
    await render((React) =>
      React.createElement(ResourceCard, {
        resource: card({
          bookingMode: 'loan',
          quantity: 5,
          location: undefined,
          eligibility: { ...card().eligibility, badges: [], approvalMode: 'auto' },
          status: 'maintenance',
        }),
      }),
    ),
  );
  assert.match(loan, /Instant approval · Loan \(pick up and return\) · 5 units/);
  assert.match(loan, /Badges needed None/);
  assert.match(loan, /Location not listed/);
  assert.match(loan, /Under maintenance/);
});

test('ResourceCard shows a listing image only from Cloudinary, never from any host the server stored', async () => {
  // The server doesn't check where listing images come from (api.md "Resources"), so an image on
  // another host would be fetched by every member who opens Explore: a tracking pixel.
  const { ResourceCard } = await load('/src/features/resources/components/ResourceCard.jsx');
  const { isListingImage } = await format();
  const ours = {
    url: 'https://res.cloudinary.com/demo/image/upload/v1730000000/campuscommons/resources/printer.jpg',
    publicId: 'campuscommons/resources/printer',
  };
  const shown = await render((React) => React.createElement(ResourceCard, { resource: card({ images: [ours] }) }));
  assert.ok(shown.includes(`src="${ours.url}"`));

  const foreign = [
    { url: 'https://attacker.example/p.gif?u=dic', publicId: 'x' },
    { url: 'http://res.cloudinary.com/demo/image/upload/v1/campuscommons/resources/printer.jpg', publicId: 'campuscommons/resources/printer' },
    { url: 'https://res.cloudinary.com.attacker.example/demo/image/upload/v1/a.jpg', publicId: 'a' },
    { url: 'https://user@res.cloudinary.com/demo/image/upload/v1/a.jpg', publicId: 'a' },
    { url: 'https://res.cloudinary.com/demo/image/fetch/https://attacker.example/p.gif', publicId: 'p' },
    { url: 'https://res.cloudinary.com/demo/image/upload/l_fetch:aHR0cHM6Ly9hLmV4/v1/a.jpg', publicId: 'a' },
    { url: '//attacker.example/p.gif', publicId: 'p' },
    { url: 'javascript:alert(1)', publicId: 'p' },
  ];
  for (const image of foreign) {
    assert.equal(isListingImage(image), false, image.url);
    const html = await render((React) => React.createElement(ResourceCard, { resource: card({ images: [image] }) }));
    assert.doesNotMatch(html, /<img/, image.url);
  }
  assert.equal(isListingImage(ours), true);
  assert.equal(isListingImage({ url: ours.url }), false, 'a stored image has its publicId');
  assert.equal(isListingImage(null), false);
  // The first usable image is shown; a foreign one before it is skipped.
  const mixed = await render((React) =>
    React.createElement(ResourceCard, { resource: card({ images: [foreign[0], ours] }) }),
  );
  assert.ok(mixed.includes(`src="${ours.url}"`));
  assert.doesNotMatch(mixed, /attacker/);
});

test('EligibilityChecklist renders the server messages, fix hints and the badge request link', async () => {
  const { EligibilityChecklist } = await load('/src/features/resources/components/EligibilityChecklist.jsx');
  const html = await render((React) =>
    React.createElement(EligibilityChecklist, { results: memberEligibility().results, resource: detail() }),
  );
  const t = text(html);
  assert.match(t, /Missing badge: 3D Printing Basics\./);
  assert.match(t, /What to do: Request it from Design and Innovation Centre\./);
  assert.match(t, /1 to fix/);
  assert.match(html, /href="\/badges\?request=3d-printing-basics"/);
  assert.match(t, /ID card verified : Passed/);
  assert.match(t, /Badges : Not met/);

  const soft = text(
    await render((React) =>
      React.createElement(EligibilityChecklist, { results: slotTakenCheck().results, resource: detail() }),
    ),
  );
  assert.match(soft, /Waitlist only/);
  assert.match(soft, /Slot availability : Slot taken/);
  assert.match(soft, /Join the waitlist as #1\?/);
});

test('QuotaMeter shows the quota text and an accessible meter per limit', async () => {
  const { QuotaMeter } = await load('/src/features/resources/components/QuotaMeter.jsx');
  const html = await render((React) => React.createElement(QuotaMeter, { quota: memberEligibility().quota }));
  assert.match(text(html), /4 of 6 h this week · 1 of 1 active booking/);
  assert.equal((html.match(/role="meter"/g) ?? []).length, 2);
  assert.match(html, /aria-valuetext="4 of 6 h"/);
  const none = await render((React) =>
    React.createElement(QuotaMeter, {
      quota: { hoursThisWeek: 0, maxHoursPerWeek: null, activeCount: 0, maxActiveBookings: null },
    }),
  );
  assert.doesNotMatch(none, /role="meter"/);
  assert.equal(await render((React) => React.createElement(QuotaMeter, { quota: null })), '');
});

test('AvailabilityGrid: a free slot stands out from past and closed ones by more than a pale tint', async () => {
  // WCAG 1.4.11: the free cell's border is its only cue (no glyph), so it needs 3:1 against the
  // white table and its own fill; at 50% alpha it was 2.8:1.
  const { AvailabilityGrid } = await load('/src/features/resources/components/AvailabilityGrid.jsx');
  const model = await sampleGrid();
  const html = await render((React) => React.createElement(AvailabilityGrid, { model }));
  const free = html.match(/<td[^>]*aria-label="[^"]*: free"[^>]*>/)?.[0];
  assert.ok(free, 'a free cell is on the grid');
  const className = free.match(/class="([^"]*)"/)[1];
  assert.doesNotMatch(className, /border-\[#[0-9a-f]{6}\]\/\d+/i, 'an opaque border');
  const border = className.match(/(?:^|\s)border-\[(#[0-9a-fA-F]{6})\]/)?.[1];
  const fill = className.match(/(?:^|\s)bg-\[(#[0-9a-fA-F]{6})\]/)?.[1];
  assert.ok(border && fill);
  assert.ok(contrast(border, '#ffffff') >= 3, `free border on white: ${contrast(border, '#ffffff').toFixed(2)}:1`);
  assert.ok(contrast(border, fill) >= 3, `free border on its fill: ${contrast(border, fill).toFixed(2)}:1`);
});

test('AvailabilityGrid is a role="grid" with one tab stop, selected cells and unit counts, never names', async () => {
  const { AvailabilityGrid } = await load('/src/features/resources/components/AvailabilityGrid.jsx');
  const model = await sampleGrid();
  const selection = { start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00') };
  const html = await render((React) => React.createElement(AvailabilityGrid, { model, selection }));
  assert.match(html, /role="grid"/);
  assert.equal((html.match(/role="gridcell"/g) ?? []).length, 7 * 16);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, 'one roving tab stop');
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 4, '10:00 to 12:00 is four slots');
  assert.match(html, /aria-label="Tue, 3 Nov, 10:00–10:30: taken, waitlist only, selected"/);
  assert.match(html, /aria-label="Wed, 4 Nov, 13:00–13:30: closed: Printer service"/);
  assert.match(text(html), /Today/);
  assert.match(text(html), /Times are IST, in 30-minute slots/);

  const loading = await render((React) => React.createElement(AvailabilityGrid, { model: null, loading: true }));
  assert.match(text(loading), /Loading availability/);
  const failed = text(
    await render((React) =>
      React.createElement(AvailabilityGrid, {
        model: null,
        error: { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-av' },
        onRetry: () => {},
      }),
    ),
  );
  assert.match(failed, /Couldn't load the availability/);
  assert.match(failed, /ref: req-av/);
  assert.match(failed, /Try again/);
});

test('PreCheck says what POST /bookings/check found, rule by rule', async () => {
  const { PreCheck } = await load('/src/features/resources/components/BookingPanel.jsx');
  const resource = detail();
  const idle = text(await render((React) => React.createElement(PreCheck, { hasSelection: false, resource })));
  assert.match(idle, /Pick a time to check it/);
  const taken = text(
    await render((React) =>
      React.createElement(PreCheck, { hasSelection: true, result: slotTakenCheck(), resource }),
    ),
  );
  assert.match(taken, /This slot is taken/);
  assert.match(taken, /You can join the waitlist as #1\./);
  assert.match(taken, /Opening hours : Passed/);
  const ineligible = {
    eligible: false,
    outcome: 'ineligible',
    waitlistPosition: null,
    results: [rule('DURATION', false, 'Maximum booking length is 4 h.', { fixHint: 'Pick a shorter slot.' })],
  };
  const bad = text(
    await render((React) => React.createElement(PreCheck, { hasSelection: true, result: ineligible, resource })),
  );
  assert.match(bad, /You can't book this time yet/);
  assert.match(bad, /What to do: Pick a shorter slot\./);
  const failed = text(
    await render((React) =>
      React.createElement(PreCheck, {
        hasSelection: true,
        error: { status: 404, code: 'NOT_FOUND', message: 'Resource not found.', requestId: 'req-404' },
        resource,
      }),
    ),
  );
  assert.match(failed, /Couldn't check this time/);
  assert.match(failed, /ref: req-404/);
});

test('PreCheck keeps one live region through every state, so the first answer is announced', async () => {
  // A live region inserted with its text already in it is usually not read out: the region must
  // exist (same element, same place) before the answer arrives in it.
  const { PreCheck } = await load('/src/features/resources/components/BookingPanel.jsx');
  const resource = detail();
  const states = {
    idle: { hasSelection: false },
    checking: { hasSelection: true },
    answered: { hasSelection: true, result: slotTakenCheck() },
    rechecking: { hasSelection: true, result: slotTakenCheck(), loading: true, stale: true },
    failed: { hasSelection: true, error: { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try later.', requestId: 'req-503' } },
  };
  const opening = /^<div><div role="status" aria-live="polite"/;
  for (const [name, props] of Object.entries(states)) {
    const html = await render((React) => React.createElement(PreCheck, { resource, ...props }));
    assert.match(html, opening, `${name}: the region is the first element, in every state`);
    assert.equal((html.match(/role="status"/g) ?? []).length, 1, `${name}: one status region`);
  }
  const answered = await render((React) => React.createElement(PreCheck, { resource, ...states.answered }));
  const region = elementAt(answered, answered.indexOf('<div role="status"'));
  assert.match(text(region), /This slot is taken/);
  assert.match(text(region), /join the waitlist as #1/);
  const checking = await render((React) => React.createElement(PreCheck, { resource, ...states.checking }));
  assert.match(text(elementAt(checking, checking.indexOf('<div role="status"'))), /Checking this time/);
});

test('BookingConfirmation handles pending, auto-approved and waitlisted, and links to the booking', async () => {
  const { BookingConfirmation } = await load('/src/features/resources/components/BookingPanel.jsx');
  const resource = detail();
  const show = async (booking, waitlistPosition = null) =>
    render((React) =>
      React.createElement(BookingConfirmation, {
        result: { booking, evaluation: { eligible: true, outcome: booking.status, results: [] }, waitlistPosition },
        resource,
        onBookAnother: () => {},
      }),
    );
  const pending = await show(storedBooking());
  assert.match(text(pending), /Request sent/);
  assert.match(text(pending), /Awaiting review/);
  assert.match(text(pending), /Tue, 3 Nov, 10:00–12:00 \(2 h\)/);
  assert.match(text(pending), /awaiting review by Design and Innovation Centre/);
  assert.match(pending, /href="\/bookings\/64d0000000000000000000b1"/);
  const approved = text(await show(storedBooking({ status: 'approved', decision: { action: 'approve', at: 'x', reason: 'Auto-approved' } })));
  assert.match(approved, /You're booked/);
  assert.match(approved, /Approved automatically/);
  const waitlisted = text(await show(storedBooking({ status: 'waitlisted' }), 1));
  assert.match(waitlisted, /You're on the waitlist/);
  assert.match(waitlisted, /Waitlisted \(#1\)/);
  assert.match(waitlisted, /You're #1 in line/);
});

test('BookingRefusal: SLOT_TAKEN offers the waitlist, INELIGIBLE lists the rules, 429 shows the wait', async () => {
  const { BookingRefusal } = await load('/src/features/resources/components/BookingPanel.jsx');
  const resource = detail();
  const show = (error, props = {}) =>
    render((React) => React.createElement(BookingRefusal, { error, resource, ...props }));

  const taken = text(
    await show({
      status: 409,
      code: 'SLOT_TAKEN',
      message: 'This slot is held by an earlier request. You can join the waitlist as #2.',
      details: { waitlistPosition: 2 },
      requestId: 'req-409',
    }),
  );
  assert.match(taken, /This slot is held by an earlier request/);
  assert.match(taken, /Join the waitlist as #2/);
  assert.match(taken, /Choose another time/);

  const ineligibleHtml = await show({
    status: 422,
    code: 'INELIGIBLE',
    message: "You're not eligible to book this.",
    details: [
      { rule: 'BADGES', passed: false, message: 'Missing badge: 3D Printing Basics.', fixHint: 'Request it from Design and Innovation Centre.' },
      { rule: 'WEEKLY_HOURS', passed: false, message: "You've used 6 of 6 hours this week on this resource.", fixHint: 'Try next week.' },
    ],
    requestId: 'req-422',
  });
  const ineligible = text(ineligibleHtml);
  assert.match(ineligible, /You can't book this time/);
  assert.match(ineligible, /Missing badge: 3D Printing Basics\./);
  assert.match(ineligible, /What to do: Try next week\./);
  assert.match(ineligible, /2 to fix/);
  assert.match(ineligibleHtml, /href="\/badges\?request=3d-printing-basics"/);
  assert.match(ineligible, /ref: req-422/);

  const limited = text(
    await show(
      {
        status: 429,
        code: 'RATE_LIMITED',
        message: "You've sent 10 booking requests in the last hour. Try again in 41 minutes.",
        details: { tier: 'bookingCreate', limit: 10, retryAfterSeconds: 2480 },
        retryAfter: 2480,
        requestId: 'req-429',
      },
      { secondsLeft: 2480 },
    ),
  );
  assert.match(limited, /Too many booking requests/);
  assert.match(limited, /You can send again in 41:20/);
  assert.match(limited, /ref: req-429/);
  // The countdown changes every second: inside role="alert" a screen reader would read it out
  // every second. The alert holds the refusal; the clock sits outside it.
  const limitedHtml = await show(
    { status: 429, code: 'RATE_LIMITED', message: 'Try again in 41 minutes.', retryAfter: 2480, requestId: 'req-429' },
    { secondsLeft: 2480 },
  );
  const alert = elementAt(limitedHtml, limitedHtml.indexOf('role="alert"'));
  assert.match(text(alert), /Too many booking requests/);
  assert.match(text(alert), /Try again in 41 minutes\./);
  assert.doesNotMatch(alert, /41:20/);
  assert.doesNotMatch(alert, /aria-live/);
  const clock = limitedHtml.slice(limitedHtml.indexOf('41:20') - 400, limitedHtml.indexOf('41:20'));
  assert.doesNotMatch(clock.slice(clock.lastIndexOf('<p')), /aria-live|role="(?:alert|status)"/);

  const other = text(
    await show({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Booking is temporarily unavailable. Please try again in a moment.', requestId: 'req-503' }, { onRetry: () => {} }),
  );
  assert.match(other, /Your booking wasn't sent/);
  assert.match(other, /Booking is temporarily unavailable/);
  assert.match(other, /ref: req-503/);
  assert.match(other, /Try again/);
  assert.equal(await show(null), '');
});

test('BookingPanel shows the chosen time in its pickers and the cached pre-check of that time', async () => {
  const { BookingPanel } = await load('/src/features/resources/components/BookingPanel.jsx');
  const { resourceKeys } = await api();
  const resource = detail();
  const model = await sampleGrid();
  const selection = { start: ist('2026-11-03', '10:00'), end: ist('2026-11-03', '12:00') };
  const html = await render(
    (React) => React.createElement(BookingPanel, { resource, model, selection, onSelectionChange: () => {} }),
    { cache: [[resourceKeys.eligibility(RESOURCE_ID, selection), { data: slotTakenCheck() }]] },
  );
  const t = text(html);
  assert.match(html, /<h2[^>]*>Book this resource<\/h2>/);
  assert.match(t, /Selected: Tue, 3 Nov, 10:00–12:00 \(2 h\)/);
  assert.match(html, /<option value="1" selected="">Tue, 3 Nov<\/option>/);
  assert.match(html, new RegExp(`<option value="${selection.start}" selected="">10:00 \\(taken, waitlist\\)</option>`));
  assert.match(html, new RegExp(`<option value="${selection.end}" selected="">12:00 \\(2 h\\)</option>`));
  assert.match(t, /This slot is taken/);
  assert.match(t, /Join the waitlist as #1/, 'the submit offers the waitlist');
  assert.match(html, /<label[^>]*>What(&#x27;|')s it for\?<\/label>/);
  assert.match(t, /10–300 characters/);
  assert.match(t, /Length: 30 min to 4 h/);

  // No time yet: nothing is checked, and the button asks for a booking.
  const empty = text(
    await render((React) => React.createElement(BookingPanel, { resource, model, selection: null })),
  );
  assert.match(empty, /Nothing selected yet/);
  assert.match(empty, /Pick a time to check it/);
  assert.match(empty, /Request booking/);

  const auto = text(
    await render((React) =>
      React.createElement(BookingPanel, {
        resource: detail({ eligibility: { ...detail().eligibility, approvalMode: 'auto' } }),
        model,
      }),
    ),
  );
  assert.match(auto, /Book now/);

  const loan = await render((React) =>
    React.createElement(BookingPanel, { resource: detail({ bookingMode: 'loan' }), model }),
  );
  assert.match(text(loan), /Pickup day/);
  assert.match(text(loan), /Return day/);

  const maintenance = text(
    await render((React) => React.createElement(BookingPanel, { resource: detail({ status: 'maintenance' }), model })),
  );
  assert.match(maintenance, /under maintenance/);
  assert.doesNotMatch(maintenance, /Request booking/);
});

// ── Pages ─────────────────────────────────────────────────────────────────────

test('ExplorePage renders the grid from GET /resources, the units from GET /org-units and the URL filters', async () => {
  const { default: ExplorePage } = await load('/src/pages/ExplorePage.jsx');
  const { resourceKeys, readExploreFilters } = await api();
  const { orgUnitKeys } = await load('/src/features/verification/api.js');
  const query = 'q=printer&category=equipment&eligibleOnly=true';
  const filters = readExploreFilters(new URLSearchParams(query));
  const html = await render((React) => React.createElement(ExplorePage), {
    path: `/explore?${query}`,
    cache: [
      [resourceKeys.list(filters), { data: [card()], meta: { page: 1, limit: 12, total: 1 } }],
      [orgUnitKeys.active, { success: true, data: UNITS, requestId: 'req-units' }],
    ],
  });
  const t = text(html);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(t, /Explore campus resources/);
  assert.match(t, /1 resource you can book/);
  assert.match(t, /FDM 3D Printer/);
  assert.match(html, /value="printer"/);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, /aria-pressed="true"[^>]*>Equipment</);
  assert.match(html, /<optgroup label="Departments"><option value="64a000000000000000000c5e">Computer Science and Engineering \(CSE\)<\/option>/);
  assert.match(html, /<optgroup label="Centres">/);
  assert.match(t, /Clear filters/);
  assert.doesNotMatch(t, /\[object Object\]/);
  assert.doesNotMatch(html, /Page 1 of/, 'one page, no pagination');

  const paged = await render((React) => React.createElement(ExplorePage), {
    path: '/explore?page=2',
    cache: [
      [resourceKeys.list({ page: 2 }), { data: [card()], meta: { page: 2, limit: 12, total: 25 } }],
      [orgUnitKeys.active, { success: true, data: UNITS, requestId: 'req-units' }],
    ],
  });
  assert.match(text(paged), /25 resources on campus/);
  assert.match(text(paged), /Page 2 of 3/);
});

test('ExplorePage shows the empty state, and the error with its request id and a retry', async () => {
  const { default: ExplorePage } = await load('/src/pages/ExplorePage.jsx');
  const { resourceKeys } = await api();
  const { orgUnitKeys } = await load('/src/features/verification/api.js');
  const empty = text(
    await render((React) => React.createElement(ExplorePage), {
      path: '/explore?eligibleOnly=true',
      cache: [
        [resourceKeys.list({ eligibleOnly: true }), { data: [], meta: { page: 1, limit: 12, total: 0, capped: false } }],
        [orgUnitKeys.active, { success: true, data: UNITS, requestId: 'r' }],
      ],
    }),
  );
  assert.match(empty, /Nothing matches these filters/);
  assert.match(empty, /Only show what I can book/);
  // Its "Clear filters" goes away once pressed; focus moves to the results heading, which can take it.
  const emptyHtml = await render((React) => React.createElement(ExplorePage), {
    path: '/explore?eligibleOnly=true',
    cache: [
      [resourceKeys.list({ eligibleOnly: true }), { data: [], meta: { page: 1, limit: 12, total: 0, capped: false } }],
      [orgUnitKeys.active, { success: true, data: UNITS, requestId: 'r' }],
    ],
  });
  assert.match(emptyHtml, /<h2 id="explore-results-heading" tabindex="-1"/);

  const failed = text(
    await render((React) => React.createElement(ExplorePage), {
      path: '/explore',
      errors: [
        [resourceKeys.list({}), { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-500' }],
        [orgUnitKeys.active, { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try later.', requestId: 'req-u' }],
      ],
    }),
  );
  assert.match(failed, /Couldn't load the resources/);
  assert.match(failed, /Something went wrong\./);
  assert.match(failed, /ref: req-500/);
  assert.match(failed, /Try again/);
  assert.match(failed, /Couldn't load the units: Try later\./);
});

async function renderDetail(cache, errors = []) {
  const { default: ResourceDetailPage } = await load('/src/pages/ResourceDetailPage.jsx');
  const { Routes, Route } = await import('react-router-dom');
  return render(
    (React) =>
      React.createElement(
        Routes,
        null,
        React.createElement(Route, { path: '/resources/:id', element: React.createElement(ResourceDetailPage) }),
      ),
    { path: `/resources/${RESOURCE_ID}`, cache, errors },
  );
}

test('ResourceDetailPage renders the header, rules, server checklist, quota, the 7-day grid and the panel', async () => {
  const { resourceKeys } = await api();
  const { availabilityRange } = await slots();
  const { istDateKey } = await load('/src/lib/time.js');
  // The page asks for today's 7 days, so the cached answer covers the same range.
  const range = availabilityRange(istDateKey(Date.now()));
  const dayKeys = Array.from({ length: 7 }, (_, i) => istDateKey(Date.parse(range.from) + i * 86400000));
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '17:00' }));
  const availability = {
    quantity: 1,
    openWindows: dayKeys.map((key) => ({ start: ist(key, '09:00'), end: ist(key, '17:00') })),
    busy: [{ start: ist(dayKeys[1], '10:00'), end: ist(dayKeys[1], '12:00'), inUse: 1, full: true }],
  };
  const resource = detail({
    availability: {
      weekly: everyDay,
      slotMinutes: 30,
      blackouts: [{ _id: 'bl1', start: ist(dayKeys[3], '13:00'), end: ist(dayKeys[3], '17:00'), reason: 'Printer service' }],
    },
  });
  const html = await renderDetail([
    [resourceKeys.detail(RESOURCE_ID), { data: resource }],
    [resourceKeys.eligibility(RESOURCE_ID), { data: memberEligibility() }],
    [resourceKeys.availability(RESOURCE_ID, range), { data: availability }],
  ]);
  const t = text(html);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>FDM 3D Printer<\/h1>/);
  assert.match(t, /Design and Innovation Centre \(DIC\)/);
  assert.match(t, /Prototyping Lab, Design and Innovation Centre \(Ground floor\)/);
  assert.match(t, /Medium risk/);
  assert.match(t, /Open for booking/);
  assert.match(t, /PLA and PETG only; no ABS or resin\./);
  assert.match(t, /Nozzle clean/);
  assert.match(t, /Upcoming closures/);
  assert.match(t, /Printer service/);
  // The server's checklist, with its fix link.
  assert.match(t, /Can you book it\?/);
  assert.match(t, /Missing badge: 3D Printing Basics\./);
  assert.match(html, /href="\/badges\?request=3d-printing-basics"/);
  assert.match(t, /4 of 6 h this week · 1 of 1 active booking/);
  // The grid: 7 days × 16 slots, the taken slot shown as in use, and no borrower anywhere.
  assert.match(html, /role="grid"/);
  assert.equal((html.match(/role="gridcell"/g) ?? []).length, 7 * 16);
  assert.match(t, /FULL/);
  assert.match(html, /taken, waitlist only/);
  assert.match(t, /Book this resource/);
  assert.doesNotMatch(t, /\[object Object\]/);
});

test('ResourceDetailPage: 404 says not found; other failures show the error, its ref and a retry', async () => {
  const { resourceKeys } = await api();
  const missing = text(
    await renderDetail(
      [],
      [[resourceKeys.detail(RESOURCE_ID), { status: 404, code: 'NOT_FOUND', message: 'Resource not found.', requestId: 'req-404' }]],
    ),
  );
  assert.match(missing, /Resource not found/);
  assert.match(missing, /Back to Explore/);
  const failed = text(
    await renderDetail(
      [],
      [[resourceKeys.detail(RESOURCE_ID), { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-500' }]],
    ),
  );
  assert.match(failed, /Couldn't load this resource/);
  assert.match(failed, /ref: req-500/);
  assert.match(failed, /Try again/);

  // The page loaded but the checklist failed: its own error, with the request id.
  const partly = text(
    await renderDetail(
      [[resourceKeys.detail(RESOURCE_ID), { data: detail() }]],
      [[resourceKeys.eligibility(RESOURCE_ID), { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-el' }]],
    ),
  );
  assert.match(partly, /Couldn't load your eligibility/);
  assert.match(partly, /ref: req-el/);
});
