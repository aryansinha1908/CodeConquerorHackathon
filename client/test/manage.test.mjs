// Tests for the manager pages (frontend.md §6.3; judge steps 7 and 10): the review queue
// (features/manage/RequestsPage), today's handovers (HandoversPage) and the return check
// (ReturnConfirmPage), with their helpers (features/manage/components/manageView.js) and
// components. Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/foundations.test.mjs. Requests go to a
// fake axios adapter; pages render with react-dom/server from a React Query cache holding data
// shaped exactly as docs/api.md describes, so a crash such as rendering an object as text shows up.
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

// routes: { 'POST /bookings/b1/approve': (config) => answer }. An answer is { status, data, meta } or
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

// A normalised error as lib/http.js produces it, for the error states.
const failure = (overrides = {}) => ({
  status: 500,
  code: 'INTERNAL',
  message: 'Something went wrong.',
  details: undefined,
  retryAfter: null,
  requestId: 'req-abc123',
  ...overrides,
});

// ── Data shaped as docs/api.md says ─────────────────────────────────────────

const PHOTO_A = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000000/campuscommons/photos/a1.jpg',
  publicId: 'campuscommons/photos/a1',
};
const PHOTO_B = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000001/campuscommons/photos/b2.jpg',
  publicId: 'campuscommons/photos/b2',
};
const PHOTO_C = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000002/campuscommons/photos/c3.jpg',
  publicId: 'campuscommons/photos/c3',
};

const CSE = { _id: 'u-cse', code: 'cse', name: 'Computer Science and Engineering' };
const EE = { _id: 'u-ee', code: 'ee', name: 'Electrical Engineering' };
const AARAV = { _id: 'user-aarav', name: 'Aarav Student', memberType: 'ug', department: CSE };
const DIYA = { _id: 'user-diya', name: 'Diya Student', memberType: 'pg', department: EE };

// The user view of GET /auth/me for the seeded DIC manager.
const MANAGER = {
  _id: 'mgr-1',
  name: 'Priya Manager',
  email: 'manager@demo.campuscommons.test',
  roles: ['member', 'manager'],
  memberType: 'faculty',
  department: { _id: 'u-dic', code: 'dic', name: 'Design and Innovation Centre' },
  managedOrgUnits: ['u-dic'],
  emailVerified: true,
  verification: { status: 'approved', reason: null, submittedAt: null },
  strikes: 0,
  suspendedUntil: null,
  suspensionReason: null,
  emailHints: null,
};
const ADMIN = { ...MANAGER, _id: 'admin-1', name: 'Asha Admin', roles: ['member', 'admin'], managedOrgUnits: [] };

const RULES = [
  ['ACCOUNT_VERIFIED', 'Your ID card is verified.'],
  ['NOT_SUSPENDED', 'Your account is in good standing.'],
  ['RESOURCE_ACTIVE', 'This resource is open for booking.'],
  ['MEMBER_TYPE', 'Undergraduates can book this.'],
  ['DEPARTMENT', 'Open to all departments.'],
  ['BADGES', 'You hold every badge this needs.'],
  ['OPEN_HOURS', 'Inside the opening hours.'],
  ['DURATION', '2 h is within the allowed length.'],
  ['BOOKING_WINDOW', 'The start time is within the booking window.'],
  ['WEEKLY_HOURS', '2 of 6 h used this week.'],
  ['ACTIVE_BOOKINGS', 'You hold 0 of 2 active bookings allowed here.'],
  ['AVAILABILITY', 'The slot is free.'],
];
// eligibilitySnapshot: [{ rule, passed, message }]; `failing` maps a rule to its failed message.
const snapshot = (failing = {}) =>
  RULES.map(([rule, message]) =>
    rule in failing ? { rule, passed: false, message: failing[rule] } : { rule, passed: true, message },
  );

// GET /bookings/manage: resource { _id, title, slug, quantity }, borrower { _id, name, memberType,
// department }, never an email.
const RESOURCE = { _id: 'r1', title: 'FDM 3D Printer #2', slug: 'fdm-3d-printer-2', quantity: 1 };
const manageBooking = (overrides = {}) => ({
  _id: 'b1',
  resource: RESOURCE,
  orgUnit: 'u-dic',
  borrower: AARAV,
  start: '2026-11-03T04:30:00.000Z',
  end: '2026-11-03T06:30:00.000Z',
  purpose: 'Printing the chassis for the robotics club',
  status: 'pending',
  eligibilitySnapshot: snapshot(),
  incidents: [],
  flags: { overdue: false },
  createdAt: '2026-10-29T05:00:00.000Z',
  updatedAt: '2026-10-29T05:00:00.000Z',
  __v: 0,
  ...overrides,
});

// Judge steps 5–6: Aarav asks first; Diya's overlapping request joins the waitlist as #1.
const PENDING = manageBooking();
const WAITLISTED = manageBooking({
  _id: 'b2',
  borrower: DIYA,
  start: '2026-11-03T05:30:00.000Z',
  end: '2026-11-03T07:30:00.000Z',
  purpose: 'Prototype enclosure for the EE lab project',
  status: 'waitlisted',
  waitlistPosition: 1,
  eligibilitySnapshot: snapshot({ AVAILABILITY: 'This slot is held by an earlier request.' }),
  createdAt: '2026-10-29T05:10:00.000Z',
});
const GROUP = {
  resource: RESOURCE,
  start: '2026-11-03T04:30:00.000Z',
  end: '2026-11-03T07:30:00.000Z',
  bookings: [PENDING, WAITLISTED],
};

// GET /bookings/:id for the return check: populated resource (with checklist), borrower, orgUnit,
// plus allowedActions, isOverdue and waitlistPosition.
const CHECKLIST = ['Nozzle clean', 'Build plate undamaged', 'Filament spool mounted'];
const returnBooking = (overrides = {}) => ({
  ...manageBooking({ _id: 'b3' }),
  resource: {
    _id: 'r1',
    title: 'FDM 3D Printer #2',
    slug: 'fdm-3d-printer-2',
    location: 'DIC Lab 2',
    bookingMode: 'slot',
    checklist: CHECKLIST,
  },
  orgUnit: { _id: 'u-dic', name: 'Design and Innovation Centre', code: 'dic' },
  status: 'checked_out',
  decision: { action: 'approve', by: 'mgr-1', at: '2026-10-29T06:00:00.000Z' },
  checkIn: { at: '2026-11-03T04:25:00.000Z', by: 'user-aarav', report: 'cr-1' },
  checkOut: { at: '2026-11-03T07:00:00.000Z', by: 'user-aarav', report: 'cr-2' },
  allowedActions: ['confirmOk', 'confirmIssue'],
  isOverdue: false,
  waitlistPosition: null,
  ...overrides,
});

const TIMELINE = [
  {
    kind: 'event',
    at: '2026-10-29T05:00:00.000Z',
    action: 'booking.requested',
    actor: { role: 'member', name: 'Aarav Student' },
    reason: null,
    text: 'Aarav Student requested this booking',
  },
  {
    kind: 'condition_report',
    at: '2026-11-03T04:25:00.000Z',
    phase: 'check_in',
    overall: 'good',
    items: CHECKLIST.map((label) => ({ label, ok: true })),
    photos: [PHOTO_A, PHOTO_B],
    notes: null,
    by: 'Aarav Student',
    text: 'Check-in report: good, 2 photos',
  },
  {
    kind: 'condition_report',
    at: '2026-11-03T07:00:00.000Z',
    phase: 'check_out',
    overall: 'minor_issue',
    items: [
      { label: 'Nozzle clean', ok: true },
      { label: 'Build plate undamaged', ok: false, note: 'Bed slightly scratched' },
      { label: 'Filament spool mounted', ok: true },
    ],
    photos: [PHOTO_C],
    notes: 'Bed slightly scratched near the corner',
    by: 'Aarav Student',
    text: 'Check-out report: minor issue, 1 item flagged, 1 photo',
  },
  {
    kind: 'event',
    at: '2026-11-03T07:00:01.000Z',
    action: 'booking.checked_out',
    actor: { role: 'member', name: 'Aarav Student' },
    reason: null,
    text: 'Aarav Student checked out',
  },
];

// ── Rendering ─────────────────────────────────────────────────────────────────

// Renders inside a router and a QueryClient whose cache holds `cache` ([key, data] pairs) and
// `errors` ([key, error] pairs, as a query that failed). `route` mounts the element under a
// <Route path={route}> so useParams works.
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

// What no page may ever show: an object rendered as text, or a missing value spelled out.
function assertNoJunk(html) {
  const shown = text(html);
  assert.doesNotMatch(shown, /\[object Object\]/);
  assert.doesNotMatch(shown, /\bundefined\b|\bNaN\b/);
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

// The background and text colours a class list sets, as #rrggbb (null when unset).
function colours(className) {
  const pick = (prefix) => {
    const hex = className.match(new RegExp(`(?:^|\\s)${prefix}-\\[(#[0-9a-fA-F]{6})\\]`));
    if (hex) return hex[1].toLowerCase();
    if (new RegExp(`(?:^|\\s)${prefix}-white(?:\\s|$)`).test(className)) return '#ffffff';
    return null;
  };
  return { bg: pick('bg'), fg: pick('text') };
}

const view = () => load('/src/features/manage/components/manageView.js');
const bookingsApi = () => load('/src/features/bookings/api.js');

// ── manageView: people, permissions, the queue ──────────────────────────────

test('requesterView and departmentLabel show name, member type and department, never more', async () => {
  const { requesterView, departmentLabel } = await view();
  assert.deepEqual(requesterView(AARAV), {
    name: 'Aarav Student',
    memberType: 'Undergraduate (UG)',
    department: 'Computer Science and Engineering (CSE)',
  });
  assert.deepEqual(requesterView(null), { name: 'A member', memberType: 'Not set', department: 'No department' });
  assert.equal(departmentLabel({ name: 'Electrical Engineering' }), 'Electrical Engineering');
  assert.equal(departmentLabel('u-ee'), 'No department', 'a bare id is not a department to show');
});

test('blocksOwnDecision: a manager may not decide on their own booking; an admin may', async () => {
  const { blocksOwnDecision, isAdmin } = await view();
  const own = manageBooking({ borrower: { ...AARAV, _id: 'mgr-1' } });
  assert.equal(blocksOwnDecision(own, MANAGER), true);
  assert.equal(blocksOwnDecision(own, { ...ADMIN, _id: 'mgr-1' }), false);
  assert.equal(blocksOwnDecision(PENDING, MANAGER), false);
  assert.equal(blocksOwnDecision(manageBooking({ borrower: 'mgr-1' }), MANAGER), true, 'bare ids too');
  assert.equal(isAdmin(ADMIN), true);
  assert.equal(isAdmin(MANAGER), false);
});

test('snapshotSummary counts the rules, keeps a taken slot apart from a failed rule', async () => {
  const { snapshotSummary, ruleLabel } = await view();
  const clean = snapshotSummary(PENDING.eligibilitySnapshot);
  assert.equal(clean.total, 12);
  assert.equal(clean.passed, 12);
  assert.deepEqual(clean.hardFailed, []);
  assert.equal(clean.slotTaken, false);

  const waiting = snapshotSummary(WAITLISTED.eligibilitySnapshot);
  assert.equal(waiting.passed, 11);
  assert.deepEqual(waiting.hardFailed, [], 'AVAILABILITY is soft');
  assert.equal(waiting.slotTaken, true);

  const failing = snapshotSummary(snapshot({ BADGES: 'Missing badge: 3D Printing Basics.' }));
  assert.equal(failing.hardFailed.length, 1);
  assert.equal(failing.hardFailed[0].label, 'Badges');
  assert.equal(failing.hardFailed[0].message, 'Missing badge: 3D Printing Basics.');

  assert.equal(snapshotSummary(undefined).total, 0);
  assert.equal(snapshotSummary([null, 'x', { rule: 'NEW_RULE', passed: true }]).items[0].label, 'new rule');
  assert.equal(ruleLabel('AVAILABILITY'), 'Slot free');
});

test('group helpers: counts, key, quantity and slot text in IST', async () => {
  const { groupCounts, groupKey, quantityText, slotText } = await view();
  assert.deepEqual(groupCounts(GROUP), { total: 2, pending: 1, waitlisted: 1 });
  assert.equal(groupKey(GROUP), 'r1:b1');
  assert.equal(quantityText(1), '1 unit');
  assert.equal(quantityText(3), '3 units');
  assert.equal(quantityText(undefined), null);
  assert.equal(slotText(GROUP.start, GROUP.end), '3 Nov, 10:00–13:00 (3 h)');
  assert.equal(slotText(null, GROUP.end), 'Time not set');
});

test('decision helpers: the variables sent, how a failure is read, the success line', async () => {
  const { decisionVars, decisionFailure, decisionMessage } = await view();
  assert.deepEqual(decisionVars('approve', PENDING, '  Enjoy the printer  '), {
    id: 'b1',
    note: 'Enjoy the printer',
    resourceId: 'r1',
  });
  assert.deepEqual(decisionVars('reject', PENDING, ' Clashes with a lab session. '), {
    id: 'b1',
    reason: 'Clashes with a lab session.',
    resourceId: 'r1',
  });
  assert.deepEqual(decisionVars('waitlist', PENDING, 'An earlier request holds this slot.').reason, 'An earlier request holds this slot.');

  assert.equal(decisionFailure('approve', { code: 'SLOT_TAKEN' }), 'slotTaken');
  assert.equal(decisionFailure('reject', { code: 'SLOT_TAKEN' }), 'stay');
  assert.equal(decisionFailure('approve', { code: 'INVALID_TRANSITION' }), 'stale');
  assert.equal(decisionFailure('waitlist', { code: 'NOT_FOUND' }), 'stale');
  assert.equal(decisionFailure('approve', { code: 'FORBIDDEN' }), 'stay');
  assert.equal(decisionFailure('reject', { code: 'VALIDATION_ERROR' }), 'stay');

  assert.equal(decisionMessage('approve', PENDING), "Approved Aarav Student's request for FDM 3D Printer #2.");
  assert.equal(decisionMessage('waitlist', WAITLISTED), "Moved Diya Student's request for FDM 3D Printer #2 to the waitlist.");
});

// ── The queue's requests (through the shared hooks) ────────────────────────────

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
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { onResult: (value) => results.push(value) }),
    ),
  );
  return { result: results[results.length - 1], invalidated, client };
}

test('the queue reads GET /bookings/manage?status=pending and unwraps the groups and meta', async () => {
  const { listManageBookings, bookingKeys, MANAGE_PAGE_SIZE } = await bookingsApi();
  const calls = fakeApi({
    'GET /bookings/manage': () => ({ status: 200, data: [GROUP], meta: { page: 2, limit: 20, total: 21 } }),
  });
  const res = await listManageBookings({ status: 'pending', page: 2, limit: MANAGE_PAGE_SIZE });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, { status: 'pending', page: 2, limit: 20 });
  assert.deepEqual(res.data, [GROUP]);
  assert.deepEqual(res.meta, { page: 2, limit: 20, total: 21 });
  assert.deepEqual(bookingKeys.manageList({ status: 'pending', page: 2, limit: 20 }), [
    'bookings',
    'manage',
    { status: 'pending', page: 2, limit: 20 },
  ]);
});

test('approve, waitlist and reject post the note or reason and refresh the queue and the booking', async () => {
  const { decisionVars } = await view();
  const api = await bookingsApi();
  const calls = fakeApi({
    'POST /bookings/b1/approve': () => ({
      status: 200,
      data: { ...manageBooking({ status: 'approved' }), resource: 'r1', borrower: 'user-aarav' },
    }),
    'POST /bookings/b1/waitlist': () => ({ status: 200, data: { ...PENDING, status: 'waitlisted', resource: 'r1' } }),
    'POST /bookings/b1/reject': () => ({ status: 200, data: { ...PENDING, status: 'rejected', resource: 'r1' } }),
  });

  const approve = await withHook(api.useApproveBooking);
  const approved = await approve.result.mutateAsync(decisionVars('approve', PENDING, '  Enjoy  '));
  assert.equal(approved.data.status, 'approved');
  assert.deepEqual(calls[0].body, { note: 'Enjoy' }, 'resourceId is never sent');
  // ['bookings'] covers ['bookings', 'manage'] (frontend.md §8.2), ['booking', id] the detail.
  assert.deepEqual(approve.invalidated.slice(0, 2), [['bookings'], ['booking', 'b1']]);
  approve.client.clear();

  const blank = await withHook(api.useApproveBooking);
  await blank.result.mutateAsync(decisionVars('approve', PENDING, '   '));
  assert.deepEqual(calls[1].body, {}, 'a blank note is not sent');
  blank.client.clear();

  const waitlist = await withHook(api.useWaitlistBooking);
  await waitlist.result.mutateAsync(decisionVars('waitlist', PENDING, 'An earlier request holds this slot.'));
  assert.equal(calls[2].key, 'POST /bookings/b1/waitlist');
  assert.deepEqual(calls[2].body, { reason: 'An earlier request holds this slot.' });
  waitlist.client.clear();

  const reject = await withHook(api.useRejectBooking);
  await reject.result.mutateAsync(decisionVars('reject', PENDING, 'Clashes with a lab session.'));
  assert.equal(calls[3].key, 'POST /bookings/b1/reject');
  assert.deepEqual(calls[3].body, { reason: 'Clashes with a lab session.' });
  assert.deepEqual(reject.invalidated, [
    ['bookings'],
    ['booking', 'b1'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
  ]);
  reject.client.clear();
});

test('approve refused: 409 SLOT_TAKEN offers reject or waitlist, 409 INVALID_TRANSITION reloads, 403 stays', async () => {
  const { decisionFailure, decisionVars, OWN_BOOKING_MESSAGE } = await view();
  const api = await bookingsApi();
  fakeApi({
    'POST /bookings/b1/approve': () => ({
      status: 409,
      code: 'SLOT_TAKEN',
      message: 'Another booking already holds this slot. Reject this request or move it to the waitlist.',
    }),
    'POST /bookings/b2/approve': () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'This booking was changed by someone else just now. Refresh and try again.',
    }),
    'POST /bookings/b4/approve': () => ({ status: 403, code: 'FORBIDDEN', message: OWN_BOOKING_MESSAGE }),
  });

  const taken = await withHook(api.useApproveBooking);
  const slotErr = await rejection(taken.result.mutateAsync(decisionVars('approve', PENDING, '')));
  assert.equal(slotErr.code, 'SLOT_TAKEN');
  assert.equal(slotErr.requestId, 'req-err');
  assert.equal(decisionFailure('approve', slotErr), 'slotTaken');
  assert.deepEqual(taken.invalidated.slice(0, 2), [['bookings'], ['booking', 'b1']], 'the queue is asked for again');
  taken.client.clear();

  const changed = await withHook(api.useApproveBooking);
  const staleErr = await rejection(changed.result.mutateAsync(decisionVars('approve', WAITLISTED, '')));
  assert.equal(decisionFailure('approve', staleErr), 'stale');
  assert.match(staleErr.message, /Refresh and try again/);
  changed.client.clear();

  const own = await withHook(api.useApproveBooking);
  const ownErr = await rejection(own.result.mutateAsync(decisionVars('approve', manageBooking({ _id: 'b4' }), '')));
  assert.equal(ownErr.status, 403);
  assert.equal(ownErr.message, OWN_BOOKING_MESSAGE, 'the server message is shown as it is');
  assert.equal(decisionFailure('approve', ownErr), 'stay');
  assert.deepEqual(own.invalidated, [], 'a 403 changes nothing');
  own.client.clear();
});

// ── The review queue page ─────────────────────────────────────────────────────

async function queueKey(page = 1) {
  const { bookingKeys, MANAGE_PAGE_SIZE } = await bookingsApi();
  return bookingKeys.manageList({ status: 'pending', page, limit: MANAGE_PAGE_SIZE });
}

test('RequestsPage: one card per contested slot, every request with who, purpose and eligibility', async () => {
  signIn(MANAGER);
  const { default: RequestsPage } = await load('/src/features/manage/RequestsPage.jsx');
  const html = await render((React) => React.createElement(RequestsPage), {
    path: '/manage/requests',
    cache: [[await queueKey(), { data: [GROUP], meta: { page: 1, limit: 20, total: 1 } }]],
  });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /<h2[^>]*>Booking requests<\/h2>/);
  assert.match(html, /<h3[^>]*>FDM 3D Printer #2<\/h3>/);
  assert.match(shown, /Contested slot/);
  assert.match(shown, /3 Nov, 10:00–13:00 \(3 h\) IST · 1 unit/);
  assert.match(shown, /2 requests/);
  assert.match(shown, /1 pending, 1 waitlisted, oldest first/);
  assert.match(shown, /1 slot waiting/);
  // Both requests, oldest first, as h4s in an ordered list.
  assert.match(html, /<ol[^>]*aria-label="Requests for FDM 3D Printer #2, oldest first"/);
  assert.ok(shown.indexOf('Aarav Student') < shown.indexOf('Diya Student'));
  assert.match(shown, /Undergraduate \(UG\) · Computer Science and Engineering \(CSE\)/);
  assert.match(shown, /Postgraduate \(PG\) · Electrical Engineering \(EE\)/);
  assert.match(shown, /“Printing the chassis for the robotics club”/);
  assert.match(shown, /3 Nov, 10:00–12:00 \(2 h\)/);
  assert.match(shown, /Requested 29 Oct, 10:30 IST/);
  assert.match(shown, /Eligibility when requested: 12 of 12 rules passed/);
  assert.match(shown, /Eligibility when requested: 11 of 12 rules passed · slot was taken/);
  assert.match(shown, /Taken: Slot free · This slot is held by an earlier request\./);
  assert.match(shown, /Oldest request/);
  // The waitlisted one shows its place in line and has no decision buttons.
  assert.match(shown, /Waitlisted \(#1\)/);
  assert.match(shown, /#1 on the waitlist\. It moves up on its own when the slot frees\./);
  assert.match(shown, /Approve Aarav Student's request/);
  assert.match(shown, /Waitlist Aarav Student's request/);
  assert.match(shown, /Reject Aarav Student's request/);
  assert.doesNotMatch(shown, /Approve Diya Student's request/);
  assert.doesNotMatch(shown, /@/, 'no email address anywhere');
  // No dialog is open, and nothing is announced yet.
  assert.doesNotMatch(html, /role="dialog"/);
});

test("RequestsPage: a manager sees why they can't decide on their own request; an admin can", async () => {
  const { OWN_BOOKING_MESSAGE } = await view();
  const { default: RequestsPage } = await load('/src/features/manage/RequestsPage.jsx');
  const own = manageBooking({ _id: 'b9', borrower: { _id: 'mgr-1', name: 'Priya Manager', memberType: 'faculty', department: CSE } });
  const cache = [[await queueKey(), { data: [{ ...GROUP, bookings: [own] }], meta: { page: 1, limit: 20, total: 1 } }]];

  signIn(MANAGER);
  const asManager = text(await render((React) => React.createElement(RequestsPage), { cache }));
  assert.match(asManager, /Single request/);
  assert.ok(asManager.includes(`Your own request. ${OWN_BOOKING_MESSAGE}`));
  assert.doesNotMatch(asManager, /Approve Priya Manager's request/);

  signIn({ ...ADMIN, _id: 'mgr-1' });
  const asAdmin = text(await render((React) => React.createElement(RequestsPage), { cache }));
  assert.match(asAdmin, /Approve Priya Manager's request/);
  assert.doesNotMatch(asAdmin, /Your own request/);
});

test('RequestsPage: loading, empty and error (message, request id, retry) states', async () => {
  signIn(MANAGER);
  const { default: RequestsPage } = await load('/src/features/manage/RequestsPage.jsx');
  const key = await queueKey();

  const loading = await render((React) => React.createElement(RequestsPage));
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the review queue/);

  const empty = await render((React) => React.createElement(RequestsPage), {
    cache: [[key, { data: [], meta: { page: 1, limit: 20, total: 0 } }]],
  });
  assert.match(text(empty), /No requests waiting/);
  assert.match(text(empty), /0 slots waiting/);

  const failed = await render((React) => React.createElement(RequestsPage), {
    errors: [[key, failure({ status: 403, code: 'FORBIDDEN', message: 'Only unit managers can see this queue.' })]],
  });
  assert.match(failed, /role="alert"/);
  assert.match(text(failed), /Couldn't load the review queue/);
  assert.match(text(failed), /Only unit managers can see this queue\./);
  assert.match(text(failed), /ref: req-abc123/);
  assert.match(text(failed), /Try again/);
});

test('RequestsPage: a failed 30-second refresh says so above the requests it still shows', async () => {
  // React Query keeps the last data when a refetch fails (status error, data kept): the queue on
  // screen may be out of date, so the page must say it couldn't refresh, as My bookings does.
  signIn(MANAGER);
  const { default: RequestsPage } = await load('/src/features/manage/RequestsPage.jsx');
  const key = await queueKey();
  const html = await render((React) => React.createElement(RequestsPage), {
    cache: [[key, { data: [GROUP], meta: { page: 1, limit: 20, total: 1 } }]],
    errors: [[key, failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' })]],
  });
  const shown = text(html);
  assert.match(html, /role="alert"/);
  assert.match(shown, /Couldn't refresh the review queue/);
  assert.match(shown, /Try again in a moment\./);
  assert.match(shown, /ref: req-abc123/);
  assert.match(shown, /Try again/);
  assert.match(shown, /Approve Aarav Student's request/, 'the last good queue stays on screen');
  assert.doesNotMatch(shown, /Couldn't load the review queue/);
});

test('RequestsPage: a second page of groups shows the pagination', async () => {
  signIn(MANAGER);
  const { default: RequestsPage } = await load('/src/features/manage/RequestsPage.jsx');
  const html = await render((React) => React.createElement(RequestsPage), {
    path: '/manage/requests?page=2',
    cache: [[await queueKey(2), { data: [GROUP], meta: { page: 2, limit: 20, total: 25 } }]],
  });
  assert.match(html, /<nav aria-label="Review queue pages"/);
  assert.match(text(html), /Page 2 of 2/);
});

test('SlotTakenChoices: the server message, its request id, and reject or waitlist', async () => {
  const { SlotTakenChoices } = await load('/src/features/manage/components/SlotTakenDialog.jsx');
  const html = await render((React) =>
    React.createElement(SlotTakenChoices, {
      error: failure({
        status: 409,
        code: 'SLOT_TAKEN',
        message: 'Another booking already holds this slot. Reject this request or move it to the waitlist.',
      }),
      name: 'Aarav Student',
      onWaitlist: () => {},
      onReject: () => {},
      onCancel: () => {},
    }),
  );
  const shown = text(html);
  assert.match(html, /role="alert"/);
  assert.match(shown, /Another booking already holds this slot\. Reject this request or move it to the waitlist\./);
  assert.match(shown, /ref: req-abc123/);
  assert.match(shown, /Move to the waitlist/);
  assert.match(shown, /Reject instead/);
  assert.match(shown, /Go back/);
  assert.match(html, /data-autofocus/);
});

test('EligibilitySnapshot opens on a failed rule and says when nothing was recorded', async () => {
  const { EligibilitySnapshot } = await load('/src/features/manage/components/EligibilitySnapshot.jsx');
  const failing = await render((React) =>
    React.createElement(EligibilitySnapshot, { snapshot: snapshot({ BADGES: 'Missing badge: 3D Printing Basics.' }) }),
  );
  assert.match(failing, /<details[^>]*open=""/);
  assert.match(text(failing), /11 of 12 rules passed · 1 failed/);
  assert.match(text(failing), /Failed: Badges · Missing badge: 3D Printing Basics\./);

  const clean = await render((React) => React.createElement(EligibilitySnapshot, { snapshot: snapshot() }));
  assert.doesNotMatch(clean, /open=""/);

  const none = await render((React) => React.createElement(EligibilitySnapshot, { snapshot: [] }));
  assert.match(text(none), /No eligibility check was recorded/);
});

// ── Handovers ─────────────────────────────────────────────────────────────────

test('handoverFilters: today in IST for starting soon; every checked-in and checked-out booking', async () => {
  const { handoverFilters } = await view();
  const now = Date.parse('2026-11-03T03:00:00.000Z'); // 08:30 IST
  assert.deepEqual(handoverFilters('starting', { now }), {
    status: 'approved',
    page: 1,
    limit: 20,
    from: '2026-11-02T18:30:00.000Z',
    to: '2026-11-03T18:30:00.000Z',
  });
  // 23:00 IST on 3 Nov is still 3 Nov.
  assert.equal(handoverFilters('starting', { now: Date.parse('2026-11-03T17:30:00.000Z') }).from, '2026-11-02T18:30:00.000Z');
  assert.deepEqual(handoverFilters('inUse', { page: 2, now }), { status: 'checked_in', page: 2, limit: 20 });
  assert.deepEqual(handoverFilters('returns', { now }), { status: 'checked_out', page: 1, limit: 20 });
  assert.equal(handoverFilters('nope'), null);
});

test('the handover lists send status, bounds and paging to GET /bookings/manage', async () => {
  const { handoverFilters } = await view();
  const { listManageBookings } = await bookingsApi();
  const calls = fakeApi({ 'GET /bookings/manage': () => ({ status: 200, data: [], meta: { page: 1, limit: 20, total: 0 } }) });
  await listManageBookings(handoverFilters('starting', { now: Date.parse('2026-11-03T03:00:00.000Z') }));
  await listManageBookings(handoverFilters('returns'));
  assert.deepEqual(calls[0].params, {
    status: 'approved',
    from: '2026-11-02T18:30:00.000Z',
    to: '2026-11-03T18:30:00.000Z',
    page: 1,
    limit: 20,
  });
  assert.deepEqual(calls[1].params, { status: 'checked_out', page: 1, limit: 20 });
});

test('overdue, check-in window and late return read the booking times', async () => {
  const { isOverdueAt, checkInWindow, minutesPastEnd, lateReturnMinutes } = await view();
  const end = Date.parse('2026-11-03T06:30:00.000Z');
  const inUse = manageBooking({ status: 'checked_in' });
  assert.equal(isOverdueAt(inUse, end + 10 * 60000), false, 'inside the 15-minute grace');
  assert.equal(isOverdueAt(inUse, end + 16 * 60000), true);
  assert.equal(isOverdueAt({ ...inUse, flags: { overdue: true } }, end - 60000), true, "the sweeper's flag counts");
  assert.equal(isOverdueAt({ ...inUse, isOverdue: true }, end - 60000), true);
  assert.equal(isOverdueAt(manageBooking({ status: 'checked_out' }), end + 3600000), false);
  assert.equal(minutesPastEnd(inUse, end + 65 * 60000), 65);
  assert.equal(minutesPastEnd(inUse, end - 60000), 0);

  const start = Date.parse('2026-11-03T04:30:00.000Z');
  assert.equal(checkInWindow(PENDING, start - 16 * 60000), 'early');
  assert.equal(checkInWindow(PENDING, start - 15 * 60000), 'open');
  assert.equal(checkInWindow(PENDING, end - 1), 'open');
  assert.equal(checkInWindow(PENDING, end), 'ended');
  assert.equal(checkInWindow({}, start), null);

  assert.equal(lateReturnMinutes(returnBooking()), 30);
  assert.equal(lateReturnMinutes(returnBooking({ checkOut: { at: '2026-11-03T06:00:00.000Z' } })), 0);
  assert.equal(lateReturnMinutes(manageBooking()), null);
});

test('HandoversPage: starting soon, in use with the overdue one highlighted, returns to confirm', async () => {
  signIn(MANAGER);
  const { handoverFilters } = await view();
  const { bookingKeys } = await bookingsApi();
  const { default: HandoversPage } = await load('/src/features/manage/HandoversPage.jsx');
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const minutes = 60 * 1000;
  // Half a minute of margin on the future start: the page reads the clock a moment after this test
  // does (elapsed times only grow, so the past ones need none).
  const soon = manageBooking({ _id: 'b5', status: 'approved', start: iso(now + 10.5 * minutes), end: iso(now + 130 * minutes) });
  const overdue = manageBooking({
    _id: 'b6',
    borrower: DIYA,
    status: 'checked_in',
    start: iso(now - 4 * 60 * minutes),
    end: iso(now - 80 * minutes),
    checkIn: { at: iso(now - 4 * 60 * minutes), by: 'user-diya', report: 'cr-6' },
    flags: { overdue: true, overdueAt: iso(now - 60 * minutes) },
  });
  const returned = manageBooking({
    _id: 'b7',
    status: 'checked_out',
    start: iso(now - 3 * 60 * minutes),
    end: iso(now - 60 * minutes),
    checkOut: { at: iso(now - 20 * minutes), by: 'user-aarav', report: 'cr-7' },
  });
  const list = (items) => ({ data: items, meta: { page: 1, limit: 20, total: items.length } });
  const html = await render((React) => React.createElement(HandoversPage), {
    path: '/manage/handovers',
    cache: [
      [bookingKeys.manageList(handoverFilters('starting', { now })), list([soon])],
      [bookingKeys.manageList(handoverFilters('inUse', { now })), list([overdue])],
      [bookingKeys.manageList(handoverFilters('returns', { now })), list([returned])],
    ],
  });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /<h2[^>]*>Handovers<\/h2>/);
  const headings = [...html.matchAll(/<h3[^>]*>.*?<span>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Starting soon', 'In use', 'Awaiting return confirmation']);
  // Starting soon: inside the check-in window, so the check-in link is offered.
  assert.match(shown, /Starts in 10 min\./);
  assert.match(html, /href="\/bookings\/b5\/check-in"/);
  assert.match(shown, /Check in for FDM 3D Printer #2, Aarav Student/);
  // In use: the overdue one is outlined red, labelled "Overdue", and counted.
  assert.match(shown, /Overdue by 1 h 20 min/);
  assert.match(shown, /1 overdue/);
  assert.match(html, /border-\[#c0392b\][^"]*"[^>]*>(?:(?!<li>).)*Diya Student/s);
  assert.match(html, /href="\/bookings\/b6\/check-out"/);
  // Awaiting return confirmation: links to the return check.
  assert.match(shown, /Returned 20 min ago/);
  assert.match(html, /href="\/manage\/returns\/b7"/);
  assert.match(shown, /Confirm return for FDM 3D Printer #2, Aarav Student/);
});

test('HandoversPage: empty lists, a failed list with its request id, and own returns', async () => {
  const { handoverFilters, OWN_BOOKING_MESSAGE } = await view();
  const { bookingKeys } = await bookingsApi();
  const { default: HandoversPage } = await load('/src/features/manage/HandoversPage.jsx');
  const now = Date.now();
  const empty = { data: [], meta: { page: 1, limit: 20, total: 0 } };
  const own = manageBooking({
    _id: 'b8',
    status: 'checked_out',
    borrower: { _id: 'mgr-1', name: 'Priya Manager', memberType: 'faculty', department: CSE },
    checkOut: { at: new Date(now - 5 * 60000).toISOString(), by: 'mgr-1', report: 'cr-8' },
  });
  signIn(MANAGER);
  const html = await render((React) => React.createElement(HandoversPage), {
    cache: [
      [bookingKeys.manageList(handoverFilters('starting', { now })), empty],
      [bookingKeys.manageList(handoverFilters('returns', { now })), { data: [own], meta: { page: 1, limit: 20, total: 1 } }],
    ],
    errors: [[bookingKeys.manageList(handoverFilters('inUse', { now })), failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' })]],
  });
  const shown = text(html);
  assert.match(shown, /Nothing else starts today/);
  assert.match(shown, /Couldn't load the items in use/);
  assert.match(shown, /Try again in a moment\./);
  assert.match(shown, /ref: req-abc123/);
  assert.ok(shown.includes(`Your own booking. ${OWN_BOOKING_MESSAGE}`));
  assert.match(shown, /View the return for FDM 3D Printer #2, Priya Manager/);
});

// Today's handovers for the lists below: one approved booking inside the check-in window and one
// in use, both of the DIC (u-dic), borrowed by Aarav.
function handoverLists(now, unit = 'u-dic') {
  const iso = (ms) => new Date(ms).toISOString();
  const minutes = 60 * 1000;
  const soon = manageBooking({ _id: 'b5', orgUnit: unit, status: 'approved', start: iso(now + 10.5 * minutes), end: iso(now + 130 * minutes) });
  const inUse = manageBooking({
    _id: 'b6',
    orgUnit: unit,
    status: 'checked_in',
    start: iso(now - 60 * minutes),
    end: iso(now + 60 * minutes),
    checkIn: { at: iso(now - 60 * minutes), by: 'user-aarav', report: 'cr-6' },
  });
  const list = (items) => ({ data: items, meta: { page: 1, limit: 20, total: items.length } });
  return { soon, inUse, list };
}

test('HandoversPage: only the borrower or a manager of the unit is offered check-in and check-out', async () => {
  // api.md check-in / check-out: "the borrower or a manager of the unit (an admin who is neither
  // can't)". GET /bookings/manage gives an admin every unit, so the links would be dead ends.
  const { handoverFilters } = await view();
  const { bookingKeys } = await bookingsApi();
  const { default: HandoversPage } = await load('/src/features/manage/HandoversPage.jsx');
  const now = Date.now();
  const show = async (user, unit) => {
    const { soon, inUse, list } = handoverLists(now, unit);
    signIn(user);
    return render((React) => React.createElement(HandoversPage), {
      cache: [
        [bookingKeys.manageList(handoverFilters('starting', { now })), list([soon])],
        [bookingKeys.manageList(handoverFilters('inUse', { now })), list([inUse])],
        [bookingKeys.manageList(handoverFilters('returns', { now })), list([])],
      ],
    });
  };

  const asAdmin = await show(ADMIN, 'u-dic');
  assert.doesNotMatch(asAdmin, /href="\/bookings\/b5\/check-in"/);
  assert.doesNotMatch(asAdmin, /href="\/bookings\/b6\/check-out"/);
  assert.match(asAdmin, /href="\/bookings\/b5"/, 'the booking itself is still one click away');
  assert.match(asAdmin, /href="\/bookings\/b6"/);

  const asManager = await show(MANAGER, 'u-dic');
  assert.match(asManager, /href="\/bookings\/b5\/check-in"/);
  assert.match(asManager, /href="\/bookings\/b6\/check-out"/);

  // An admin who also manages the unit may (populated orgUnit, as GET /bookings/:id has it).
  const both = await show({ ...ADMIN, managedOrgUnits: ['u-dic'] }, { _id: 'u-dic', name: 'Design and Innovation Centre', code: 'dic' });
  assert.match(both, /href="\/bookings\/b5\/check-in"/);
  assert.match(both, /href="\/bookings\/b6\/check-out"/);

  // The borrower of a booking may, whoever manages its unit.
  const borrower = await show({ ...ADMIN, _id: 'user-aarav' }, 'u-other');
  assert.match(borrower, /href="\/bookings\/b5\/check-in"/);
  assert.match(borrower, /href="\/bookings\/b6\/check-out"/);
});

test('HandoversPage: a failed refresh says so above the list it still shows', async () => {
  signIn(MANAGER);
  const { handoverFilters } = await view();
  const { bookingKeys } = await bookingsApi();
  const { default: HandoversPage } = await load('/src/features/manage/HandoversPage.jsx');
  const now = Date.now();
  const { inUse, list } = handoverLists(now);
  const inUseKey = bookingKeys.manageList(handoverFilters('inUse', { now }));
  const html = await render((React) => React.createElement(HandoversPage), {
    cache: [
      [bookingKeys.manageList(handoverFilters('starting', { now })), list([])],
      [inUseKey, list([inUse])],
      [bookingKeys.manageList(handoverFilters('returns', { now })), list([])],
    ],
    errors: [[inUseKey, failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' })]],
  });
  const shown = text(html);
  assert.match(shown, /Couldn't refresh the items in use/);
  assert.match(shown, /Try again in a moment\./);
  assert.match(shown, /ref: req-abc123/);
  assert.match(html, /href="\/bookings\/b6\/check-out"/, 'the last good list stays on screen');
  assert.doesNotMatch(shown, /Couldn't load the items in use/);
});

test('ManageLayout: the active tab and the eyebrow are at least 4.5:1 (frontend.md §10.3)', async () => {
  const { ManageLayout } = await load('/src/app/layouts/ManageLayout.jsx');
  const html = await render((React) => React.createElement(ManageLayout), { path: '/manage/requests' });
  const active = html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
  assert.ok(active, 'the Review Queue tab is marked active');
  assert.match(active, /href="\/manage\/requests"/);
  const tab = colours(active.match(/class="([^"]*)"/)[1]);
  assert.ok(tab.bg && tab.fg, 'the active tab sets both colours');
  assert.ok(contrast(tab.bg, tab.fg) >= 4.5, `active tab: ${contrast(tab.bg, tab.fg).toFixed(2)}:1`);
  // The eyebrow sits on the header panel's #ede8df.
  const panel = html.match(/<div class="([^"]*)">\s*<div><span[^>]*>FACILITY MANAGER PORTAL/)?.[1];
  assert.ok(panel, 'the eyebrow is in the header panel');
  const eyebrow = colours(html.match(/<span class="([^"]*)"[^>]*>FACILITY MANAGER PORTAL<\/span>/)[1]).fg;
  const bg = colours(panel).bg;
  assert.ok(contrast(bg, eyebrow) >= 4.5, `eyebrow: ${contrast(bg, eyebrow).toFixed(2)}:1`);
});

// ── Return check: helpers ─────────────────────────────────────────────────────

test('compareChecklists lines up the checklist with both reports and marks what changed', async () => {
  const { compareChecklists } = await view();
  const { latestReport } = await bookingsApi();
  const rows = compareChecklists(CHECKLIST, latestReport(TIMELINE, 'check_in'), latestReport(TIMELINE, 'check_out'));
  assert.deepEqual(
    rows.map((row) => [row.label, row.checkIn?.ok, row.checkOut?.ok, row.changed]),
    [
      ['Nozzle clean', true, true, false],
      ['Build plate undamaged', true, false, true],
      ['Filament spool mounted', true, true, false],
    ],
  );
  assert.equal(rows[1].checkOut.note, 'Bed slightly scratched');
  // A label only an old report has still shows; a missing report is null, not a crash.
  const extra = compareChecklists(['Nozzle clean'], { items: [{ label: 'Old item', ok: false }] }, null);
  assert.deepEqual(extra.map((row) => [row.label, row.checkIn?.ok ?? null, row.checkOut]), [
    ['Nozzle clean', null, null],
    ['Old item', false, null],
  ]);
});

test('validateReturn: every item answered, a note on "not OK", a real issue for "Report issue"', async () => {
  const { validateReturn, emptyChecks } = await view();
  const checks = emptyChecks(CHECKLIST);
  assert.deepEqual(checks[0], { label: 'Nozzle clean', ok: null, note: '' });

  assert.deepEqual(Object.keys(validateReturn({ outcome: 'ok', checks })), ['items.0', 'items.1', 'items.2']);

  const answered = [
    { label: 'Nozzle clean', ok: true, note: '' },
    { label: 'Build plate undamaged', ok: false, note: '  ' },
    { label: 'Filament spool mounted', ok: true, note: 'x'.repeat(201) },
  ];
  const errors = validateReturn({ outcome: 'ok', checks: answered, note: 'y'.repeat(1001) });
  assert.equal(errors['items.1.note'], "Say what's wrong with it.");
  assert.match(errors['items.2.note'], /at most 200/);
  assert.match(errors.outcome, /You marked 1 item not OK\. Report an issue instead/);
  assert.match(errors.note, /at most 1000 characters \(now 1001\)/);

  const issue = validateReturn({
    outcome: 'issue',
    checks: answered.map((c) => ({ ...c, note: c.ok ? '' : 'Deep scratch' })),
    incident: { type: '', severity: 'extreme', description: 'Too short' },
  });
  assert.deepEqual(Object.keys(issue).sort(), ['incident.description', 'incident.severity', 'incident.type']);
  assert.match(issue['incident.description'], /at least 20 characters \(now 9\)/);

  assert.deepEqual(
    validateReturn({
      outcome: 'issue',
      checks: answered.map((c) => ({ ...c, note: c.ok ? '' : 'Deep scratch' })),
      incident: { type: 'damage', severity: 'low', description: 'A deep scratch across the print bed.' },
    }),
    {},
  );
  assert.deepEqual(validateReturn({ outcome: 'ok', checks: [] }), {}, 'no checklist, nothing to answer');
});

test('returnInput → confirm-return body: the checklist, photos, note, and an incident only for an issue', async () => {
  const { returnInput } = await view();
  const api = await bookingsApi();
  const calls = fakeApi({
    'POST /bookings/b3/confirm-return': (config) => {
      const body = JSON.parse(config.data);
      return body.outcome === 'issue'
        ? {
            status: 200,
            data: {
              booking: { ...returnBooking(), status: 'flagged', resource: 'r1', borrower: 'user-aarav', returnConfirmation: { at: '2026-11-03T07:30:00.000Z', by: 'mgr-1', outcome: 'issue', report: 'cr-9' } },
              incident: { _id: 'inc-1', booking: 'b3', resource: 'r1', orgUnit: 'u-dic', reportedBy: 'mgr-1', source: 'manager', type: 'damage', severity: 'low', description: 'A deep scratch across the print bed.', photos: [PHOTO_C], status: 'open', comments: [], createdAt: '2026-11-03T07:30:00.000Z', updatedAt: '2026-11-03T07:30:00.000Z', __v: 0 },
            },
          }
        : { status: 200, data: { booking: { ...returnBooking(), status: 'completed', resource: 'r1' }, incident: null } };
    },
  });
  const checks = [
    { label: 'Nozzle clean', ok: true, note: '' },
    { label: 'Build plate undamaged', ok: false, note: '  Deep scratch  ' },
    { label: 'Filament spool mounted', ok: true, note: '' },
  ];
  const incident = { type: 'damage', severity: 'low', description: '  A deep scratch across the print bed.  ' };

  const issue = await withHook(api.useConfirmReturn);
  const res = await issue.result.mutateAsync({
    id: 'b3',
    resourceId: 'r1',
    ...returnInput({ outcome: 'issue', checks, photos: [{ ...PHOTO_C, preview: 'blob:x' }], note: ' Seen at the desk ', incident }),
  });
  assert.equal(calls[0].key, 'POST /bookings/b3/confirm-return');
  assert.deepEqual(calls[0].body, {
    outcome: 'issue',
    items: [
      { label: 'Nozzle clean', ok: true },
      { label: 'Build plate undamaged', ok: false, note: 'Deep scratch' },
      { label: 'Filament spool mounted', ok: true },
    ],
    photos: [PHOTO_C],
    note: 'Seen at the desk',
    incident: { type: 'damage', severity: 'low', description: 'A deep scratch across the print bed.' },
  });
  // 200 { booking, incident } unwrapped; the incident lists are refreshed too.
  assert.equal(res.data.booking.status, 'flagged');
  assert.equal(res.data.incident._id, 'inc-1');
  assert.deepEqual(issue.invalidated, [
    ['bookings'],
    ['booking', 'b3'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
    ['incidents'],
  ]);
  issue.client.clear();

  const ok = await withHook(api.useConfirmReturn);
  await ok.result.mutateAsync({
    id: 'b3',
    ...returnInput({ outcome: 'ok', checks: checks.map((c) => ({ ...c, ok: true, note: '' })), photos: [], note: '', incident }),
  });
  assert.deepEqual(calls[1].body, {
    outcome: 'ok',
    items: CHECKLIST.map((label) => ({ label, ok: true })),
  }, 'no incident, photos or note for "All good" with none given');
  assert.ok(!ok.invalidated.some((key) => key[0] === 'incidents'));
  ok.client.clear();
});

test('returnErrorsFrom puts the server field errors beside the form fields', async () => {
  const { returnErrorsFrom, firstErrorField } = await view();
  const err = failure({
    status: 400,
    code: 'VALIDATION_ERROR',
    message: '4 fields are invalid.',
    details: [
      { path: 'description', message: 'Path `description` (`Too short`) is shorter than the minimum allowed length (20).' },
      { path: 'type', message: '`broken` is not a valid enum value for path `type`.' },
      { path: 'items.1.note', message: 'Path `note` is longer than the maximum allowed length (200).' },
      { path: 'photos.0', message: 'Must be a photo uploaded through /uploads/images.' },
      { path: 'notes', message: 'Can be at most 1000 characters.' },
      { path: 'items', message: 'Missing: Filament spool mounted' },
      { path: 'items', message: 'Not on this resource\'s checklist: Old item' },
    ],
  });
  const { fields, other } = returnErrorsFrom(err);
  assert.deepEqual(fields, {
    'incident.description': 'Path `description` (`Too short`) is shorter than the minimum allowed length (20).',
    'incident.type': '`broken` is not a valid enum value for path `type`.',
    'items.1.note': 'Path `note` is longer than the maximum allowed length (200).',
    photos: 'Must be a photo uploaded through /uploads/images.',
    note: 'Can be at most 1000 characters.',
  });
  assert.deepEqual(other, ['Missing: Filament spool mounted', "Not on this resource's checklist: Old item"]);
  assert.equal(firstErrorField(fields, 3), 'items.1.note');
  assert.equal(firstErrorField({ 'incident.type': 'x', outcome: 'y' }, 3), 'outcome');
  assert.deepEqual(returnErrorsFrom(failure({ status: 403, code: 'FORBIDDEN' })), { fields: {}, other: [] });
});

test('returnMessage and the outcome label', async () => {
  const { returnMessage, confirmationOutcomeLabel } = await view();
  assert.equal(
    returnMessage({ booking: { status: 'completed' }, incident: null }, { outcome: 'ok', title: 'FDM 3D Printer #2' }),
    'Return confirmed for FDM 3D Printer #2. The booking is completed.',
  );
  assert.equal(
    returnMessage({ booking: { status: 'flagged' }, incident: { _id: 'inc-1' } }, { outcome: 'issue', title: 'FDM 3D Printer #2' }),
    'Issue reported for FDM 3D Printer #2. The booking stays flagged until the incident is resolved.',
  );
  assert.equal(confirmationOutcomeLabel('ok'), 'All good');
  assert.equal(confirmationOutcomeLabel('issue'), 'Issue reported');
  assert.equal(confirmationOutcomeLabel(undefined), null);
});

// ── Return check: the page and its form ───────────────────────────────────────

async function returnCache(booking = returnBooking(), timeline = TIMELINE) {
  const { bookingKeys } = await bookingsApi();
  return [
    [bookingKeys.detail(booking._id), { data: booking }],
    [bookingKeys.timeline(booking._id), { data: timeline }],
  ];
}

const renderReturnPage = async (cache, errors = [], id = 'b3') => {
  const { default: ReturnConfirmPage } = await load('/src/features/manage/ReturnConfirmPage.jsx');
  return render((React) => React.createElement(ReturnConfirmPage), {
    cache,
    errors,
    path: `/manage/returns/${id}`,
    route: '/manage/returns/:bookingId',
  });
};

test("ReturnConfirmPage: both reports side by side, then the manager's checklist and the two outcomes", async () => {
  signIn(MANAGER);
  const html = await renderReturnPage(await returnCache());
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /<h2[^>]*>FDM 3D Printer #2<\/h2>/);
  assert.match(shown, /Returned, awaiting confirmation/);
  assert.match(shown, /Aarav Student Undergraduate \(UG\) · Computer Science and Engineering \(CSE\)/);
  assert.match(shown, /Slot \(IST\) 3 Nov, 10:00–12:00 \(2 h\)/);
  assert.match(shown, /Checked in 3 Nov, 09:55 IST/);
  assert.match(shown, /Checked out 3 Nov, 12:30 IST 30 min after the slot ended/);

  // The checklist, row by row, with the change flagged.
  assert.match(html, /<table/);
  assert.match(html, /<th scope="col"[^>]*>At check-in<\/th>/);
  assert.match(html, /<th scope="col"[^>]*>At check-out<\/th>/);
  assert.match(shown, /Build plate undamaged Changed OK Not OK Bed slightly scratched/);
  assert.match(shown, /1 item was OK at check-in and is not OK at check-out\./);
  // The photos of each report, with alt text naming the phase and the resource.
  assert.match(html, /alt="Check-in photo 1 of 2, FDM 3D Printer #2"/);
  assert.match(html, /alt="Check-in photo 2 of 2, FDM 3D Printer #2"/);
  assert.match(html, /alt="Check-out photo 1 of 1, FDM 3D Printer #2"/);
  assert.match(shown, /Notes: “Bed slightly scratched near the corner”/);
  assert.match(shown, /Minor issue/);

  // The manager's own check.
  assert.match(html, /<legend[^>]*>Your checklist<\/legend>/);
  for (const label of CHECKLIST) assert.match(html, new RegExp(`<legend[^>]*>${label}</legend>`));
  assert.match(shown, /0 of 3 answered/);
  assert.match(shown, /Mark all OK/);
  assert.match(shown, /Start from the check-out answers/);
  assert.match(html, /<label[^>]*>Return note \(optional\)<\/label>/);
  assert.match(html, /<legend[^>]*>Return photos \(optional\)<\/legend>/);
  assert.match(shown, /All good/);
  assert.match(html, /aria-expanded="false"[^>]*>.*?Report issue/s);
  // The issue fields stay closed until "Report issue" is pressed.
  assert.doesNotMatch(shown, /What kind of issue\?/);
  // The full history is there, collapsed.
  assert.match(html, /<details[^>]*>\s*<summary[^>]*>.*?Full booking history/s);
});

test('ReturnConfirmPage: already checked, not returned yet, own booking, and a failed load', async () => {
  const { OWN_BOOKING_MESSAGE } = await view();
  signIn(MANAGER);
  const done = text(
    await renderReturnPage(
      await returnCache(
        returnBooking({
          status: 'flagged',
          allowedActions: [],
          returnConfirmation: { at: '2026-11-03T07:30:00.000Z', by: 'mgr-1', outcome: 'issue', report: 'cr-9' },
        }),
      ),
    ),
  );
  assert.match(done, /This return has already been checked: issue reported on 3 Nov, 13:00 IST\./);
  assert.match(done, /stays flagged until its incident is resolved/);
  assert.doesNotMatch(done, /Your checklist/);

  const early = text(await renderReturnPage(await returnCache(returnBooking({ status: 'checked_in', allowedActions: ['checkOut'] }))));
  assert.match(early, /There's no return to confirm: this booking is in use\./);
  assert.doesNotMatch(early, /All good/);

  const own = text(
    await renderReturnPage(
      await returnCache(
        returnBooking({ borrower: { _id: 'mgr-1', name: 'Priya Manager', memberType: 'faculty', department: CSE }, allowedActions: ['checkOut'] }),
      ),
    ),
  );
  assert.ok(own.includes(OWN_BOOKING_MESSAGE));
  assert.doesNotMatch(own, /Your checklist/);

  const { bookingKeys } = await bookingsApi();
  const missing = text(
    await renderReturnPage([], [[bookingKeys.detail('b404'), failure({ status: 404, code: 'NOT_FOUND', message: 'Booking not found.' })]], 'b404'),
  );
  assert.match(missing, /Couldn't load this booking/);
  assert.match(missing, /Booking not found\./);
  assert.match(missing, /ref: req-abc123/);
  assert.match(missing, /Try again/);
  assert.match(missing, /Back to handovers/);

  const loading = await renderReturnPage([], [], 'b5');
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the return/);
});

test('ReturnConfirmPage: a failed timeline keeps the booking and offers a retry', async () => {
  signIn(MANAGER);
  const { bookingKeys } = await bookingsApi();
  const html = await renderReturnPage(
    [[bookingKeys.detail('b3'), { data: returnBooking() }]],
    [[bookingKeys.timeline('b3'), failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' })]],
  );
  const shown = text(html);
  assert.match(shown, /Couldn't load the condition reports/);
  assert.match(shown, /ref: req-abc123/);
  assert.match(shown, /Your checklist/, 'the form still works without the reports');
});

test('ReturnForm: the incident fields, and server field errors beside them with the request id', async () => {
  signIn(MANAGER);
  const { ReturnForm } = await load('/src/features/manage/components/ReturnForm.jsx');
  const error = failure({
    status: 400,
    code: 'VALIDATION_ERROR',
    message: '3 fields are invalid.',
    details: [
      { path: 'description', message: 'Path `description` is shorter than the minimum allowed length (20).' },
      { path: 'type', message: '`broken` is not a valid enum value for path `type`.' },
      { path: 'items.1.note', message: 'Path `note` is longer than the maximum allowed length (200).' },
    ],
  });
  const html = await render((React) =>
    React.createElement(ReturnForm, {
      checklist: CHECKLIST,
      subject: 'FDM 3D Printer #2',
      error,
      initialIssueOpen: true,
      onSubmit: () => {},
    }),
  );
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /<legend[^>]*>The issue<\/legend>/);
  assert.match(html, /<label[^>]*>What kind of issue\?<\/label>/);
  for (const label of ['Damage', 'Late return', 'Misuse', 'Safety', 'Conflict', 'Other']) {
    assert.match(html, new RegExp(`<option value="[a-z]+">${label}</option>`));
  }
  assert.match(html, /<legend[^>]*>How serious is it\?<\/legend>/);
  assert.match(shown, /High Unsafe or unusable\. Only an admin can resolve it\./);
  assert.match(html, /<label[^>]*>What happened\?<\/label>/);
  assert.match(shown, /20–2000 characters/);
  // Each server message beside its field, the field marked invalid, one summary with the ref.
  assert.match(shown, /Path `description` is shorter than the minimum allowed length \(20\)\./);
  assert.match(shown, /`broken` is not a valid enum value for path `type`\./);
  assert.match(shown, /Path `note` is longer than the maximum allowed length \(200\)\./);
  assert.match(html, /<textarea[^>]*aria-invalid="true"[^>]*data-field="incident.description"|<textarea[^>]*data-field="incident.description"[^>]*aria-invalid="true"/);
  assert.match(shown, /3 things to fix before you confirm\./);
  assert.match(shown, /ref: req-abc123/);
  assert.doesNotMatch(shown, /The return wasn't confirmed/, 'field errors are not repeated as a general one');
  assert.match(shown, /Report the issue/);
  assert.match(shown, /Cancel/);
});

test('ReturnForm: a refused confirm (403, 409) shows the server message and request id', async () => {
  signIn(MANAGER);
  const { OWN_BOOKING_MESSAGE } = await view();
  const { ReturnForm } = await load('/src/features/manage/components/ReturnForm.jsx');
  const forbidden = text(
    await render((React) =>
      React.createElement(ReturnForm, {
        checklist: CHECKLIST,
        error: failure({ status: 403, code: 'FORBIDDEN', message: OWN_BOOKING_MESSAGE }),
        onSubmit: () => {},
      }),
    ),
  );
  assert.match(forbidden, /The return wasn't confirmed/);
  assert.ok(forbidden.includes(OWN_BOOKING_MESSAGE));
  assert.match(forbidden, /ref: req-abc123/);

  const changed = text(
    await render((React) =>
      React.createElement(ReturnForm, {
        checklist: CHECKLIST,
        error: failure({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'The condition report must cover each checklist item once.',
          details: [{ path: 'items', message: 'Missing: Filament spool mounted' }],
        }),
        onSubmit: () => {},
      }),
    ),
  );
  assert.match(changed, /✕ Missing: Filament spool mounted/);
  assert.match(changed, /The checklist may have changed meanwhile: reload the page/);

  const pending = await render((React) =>
    React.createElement(ReturnForm, { checklist: CHECKLIST, pending: true, pendingOutcome: 'ok', onSubmit: () => {} }),
  );
  assert.match(text(pending), /Confirming…/);
  assert.match(pending, /aria-busy="true"/);
});

test('ReportPanel: a missing report says so, and a report without photos says that', async () => {
  const { ReportPanel, ChecklistComparison } = await load('/src/features/manage/components/ReportComparison.jsx');
  const none = text(await render((React) => React.createElement(ReportPanel, { phase: 'check_in', report: null })));
  assert.match(none, /No check-in report was recorded\./);
  const bare = text(
    await render((React) =>
      React.createElement(ReportPanel, {
        phase: 'check_out',
        report: { ...TIMELINE[2], photos: [], notes: null },
        subject: 'FDM 3D Printer #2',
      }),
    ),
  );
  assert.match(bare, /Check-out 3 Nov, 12:30 IST · by Aarav Student/);
  assert.match(bare, /No photos with this report\./);
  const empty = text(await render((React) => React.createElement(ChecklistComparison, { checklist: [], checkIn: null, checkOut: null })));
  assert.match(empty, /This resource has no checklist\./);
});
