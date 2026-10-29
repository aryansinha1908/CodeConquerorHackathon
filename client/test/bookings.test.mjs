// Tests for the member's booking pages (frontend.md §6.2; judge steps 5, 8, 9, 12): My bookings,
// the booking detail, and the check-in / check-out wizard, with their helpers in
// features/bookings/components. Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/foundations.test.mjs. Requests go to a
// fake axios adapter; pages render with react-dom/server from a pre-filled React Query cache holding
// data shaped exactly as docs/api.md describes (populated resource with a location object,
// borrower, orgUnit, allowedActions, timeline items), so a crash such as rendering an object as
// text shows up here.
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

// routes: { 'POST /bookings/b1/check-in': (config) => answer }. An answer is { status, data, meta }
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

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PHOTO_A = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000000/campuscommons/photos/a1.jpg',
  publicId: 'campuscommons/photos/a1',
};
const PHOTO_B = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000001/campuscommons/photos/b2.jpg',
  publicId: 'campuscommons/photos/b2',
};

// The resource's location is an object (api.md "Resources": location?: { building?, room?, floor? }).
const LOCATION = { building: 'Design and Innovation Centre', room: 'Prototyping Lab', floor: 'Ground' };

const BORROWER = {
  _id: 'user-aarav',
  name: 'Aarav Student',
  roles: ['member'],
  memberType: 'ug',
  verification: { status: 'approved', reason: null, submittedAt: null },
};
const MANAGER = {
  _id: 'mgr-1',
  name: 'Priya Manager',
  roles: ['member', 'manager'],
  managedOrgUnits: ['u-dic'],
  verification: { status: 'approved', reason: null, submittedAt: null },
};

// A GET /bookings/mine item: resource { _id, title, slug, location }, waitlistPosition on waitlisted.
const mineBooking = (overrides = {}) => ({
  _id: 'b1',
  resource: { _id: 'r1', title: 'FDM 3D Printer #2', slug: 'fdm-3d-printer-2', location: LOCATION },
  orgUnit: 'u-dic',
  borrower: 'user-aarav',
  start: '2026-11-03T04:30:00.000Z',
  end: '2026-11-03T06:30:00.000Z',
  purpose: 'Printing the chassis for the robotics club',
  status: 'approved',
  eligibilitySnapshot: [{ rule: 'ACCOUNT_VERIFIED', passed: true, message: 'Your ID card is verified.' }],
  decision: { action: 'approve', by: 'mgr-1', at: '2026-10-29T06:00:00.000Z' },
  incidents: [],
  flags: { overdue: false },
  createdAt: '2026-10-28T21:19:35.000Z',
  updatedAt: '2026-10-29T06:00:00.000Z',
  __v: 0,
  ...overrides,
});

// GET /bookings/:id: populated resource (with bookingMode and checklist), borrower and orgUnit, plus
// allowedActions, isOverdue and waitlistPosition. By default the check-in window is open now.
const detailBooking = (overrides = {}) => {
  const start = new Date(Date.now() + 10 * MINUTE).toISOString();
  const end = new Date(Date.now() + 2 * HOUR + 10 * MINUTE).toISOString();
  return {
    ...mineBooking({ start, end }),
    resource: {
      _id: 'r1',
      title: 'FDM 3D Printer #2',
      slug: 'fdm-3d-printer-2',
      location: LOCATION,
      bookingMode: 'slot',
      checklist: ['Nozzle clean', 'Build plate undamaged', 'Filament loaded'],
    },
    borrower: {
      _id: 'user-aarav',
      name: 'Aarav Student',
      memberType: 'ug',
      department: { _id: 'u-cse', code: 'cse', name: 'Computer Science and Engineering' },
    },
    orgUnit: { _id: 'u-dic', name: 'Design and Innovation Centre', code: 'dic' },
    allowedActions: ['cancel', 'checkIn'],
    isOverdue: false,
    waitlistPosition: null,
    ...overrides,
  };
};

const CHECK_IN_REPORT = {
  kind: 'condition_report',
  at: '2026-11-03T04:25:00.000Z',
  phase: 'check_in',
  overall: 'minor_issue',
  items: [
    { label: 'Nozzle clean', ok: true },
    { label: 'Build plate undamaged', ok: false, note: 'Slight scratch on the bed' },
    { label: 'Filament loaded', ok: true },
  ],
  photos: [PHOTO_A, PHOTO_B],
  notes: 'Bed slightly scratched',
  by: 'Aarav Student',
  text: 'Check-in report: minor issue, 1 item flagged, 2 photos',
};

const TIMELINE = [
  {
    kind: 'event',
    at: '2026-10-28T21:19:35.000Z',
    action: 'booking.requested',
    actor: { role: 'member', name: 'Aarav Student' },
    reason: null,
    text: 'Aarav Student requested this booking',
  },
  {
    kind: 'event',
    at: '2026-10-29T06:00:00.000Z',
    action: 'booking.approved',
    actor: { role: 'manager', name: 'Priya Manager' },
    reason: null,
    text: 'Manager (DIC) approved this booking',
  },
  CHECK_IN_REPORT,
  {
    kind: 'event',
    at: '2026-11-03T04:25:01.000Z',
    action: 'booking.checked_in',
    actor: { role: 'member', name: 'Aarav Student' },
    reason: null,
    text: 'Aarav Student checked in',
  },
  {
    kind: 'incident',
    id: 'inc-1',
    type: 'damage',
    severity: 'low',
    status: 'open',
    event: 'opened',
    at: '2026-11-03T07:00:00.000Z',
    text: 'Incident opened: low-severity damage',
  },
];

// ── Rendering ─────────────────────────────────────────────────────────────────

// Renders inside a router (with `route` as the Route path, so useParams works) and a QueryClient
// whose cache holds `cache` ([key, data] pairs) and `errors` ([key, error] pairs, as a query that
// failed and isn't retried on mount).
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

const view = () => load('/src/features/bookings/components/bookingView.js');
const form = () => load('/src/features/bookings/components/handoverForm.js');
const bookingsApi = () => load('/src/features/bookings/api.js');

// ── bookingView.js ────────────────────────────────────────────────────────────

test('formatLocation reads the location object (room, building, floor) and never returns an object', async () => {
  const { formatLocation } = await view();
  assert.equal(formatLocation(LOCATION), 'Prototyping Lab, Design and Innovation Centre, Ground floor');
  assert.equal(formatLocation({ building: 'Central Workshop', floor: '2' }), 'Central Workshop, Floor 2');
  assert.equal(formatLocation({ room: 'Lab 4', floor: 'First floor' }), 'Lab 4, First floor');
  assert.equal(formatLocation({ building: '  ' }), null);
  assert.equal(formatLocation({}), null);
  assert.equal(formatLocation(undefined), null);
  assert.equal(formatLocation('DIC Lab 2'), 'DIC Lab 2');
  assert.equal(formatLocation(42), null);
});

test('slots read in IST with the weekday, and a length', async () => {
  const { formatSlot, slotLength, resourceTitle } = await view();
  // 04:30 UTC is 10:00 IST; 3 Nov 2026 is a Tuesday.
  assert.equal(formatSlot('2026-11-03T04:30:00.000Z', '2026-11-03T06:30:00.000Z'), 'Tue 3 Nov, 10:00–12:00 IST');
  assert.equal(formatSlot('2026-11-03T10:30:00.000Z', '2026-11-05T04:30:00.000Z'), 'Tue 3 Nov, 16:00 – 5 Nov, 10:00 IST');
  assert.equal(formatSlot(null, '2026-11-03T06:30:00.000Z'), null);
  assert.equal(slotLength('2026-11-03T04:30:00.000Z', '2026-11-03T06:00:00.000Z'), '1 h 30 min');
  assert.equal(slotLength('2026-11-03T06:00:00.000Z', '2026-11-03T04:30:00.000Z'), null);
  assert.equal(resourceTitle(mineBooking()), 'FDM 3D Printer #2');
  assert.equal(resourceTitle({ resource: 'r1' }), 'Booking', 'a bare id is not a title');
  assert.equal(resourceTitle(null, 'x'), 'x');
});

test('tabs: ?tab picks Upcoming, Requests or Past with the statuses frontend.md §6.2 lists', async () => {
  const { readTab } = await view();
  assert.equal(readTab(null).id, 'upcoming');
  assert.equal(readTab('nonsense').id, 'upcoming');
  assert.deepEqual(readTab('upcoming').statuses, ['approved', 'checked_in']);
  assert.deepEqual(readTab('requests').statuses, ['pending', 'waitlisted']);
  assert.deepEqual(readTab('past').statuses.sort(), [
    'cancelled',
    'checked_out',
    'completed',
    'expired',
    'flagged',
    'no_show',
    'rejected',
  ]);
});

test("each tab asks GET /bookings/mine for its statuses as a comma list and keeps meta", async () => {
  const { readTab } = await view();
  const { listMyBookings, MINE_PAGE_SIZE } = await bookingsApi();
  const calls = fakeApi({
    'GET /bookings/mine': () => ({
      status: 200,
      data: [mineBooking(), mineBooking({ _id: 'b2', status: 'checked_in' })],
      meta: { page: 2, limit: 20, total: 45 },
    }),
  });
  const res = await listMyBookings({ status: readTab('upcoming').statuses, page: 2, limit: MINE_PAGE_SIZE });
  assert.equal(calls[0].key, 'GET /bookings/mine');
  assert.deepEqual(calls[0].params, { status: 'approved,checked_in', page: 2, limit: 20 });
  assert.equal(res.data.length, 2);
  assert.deepEqual(res.meta, { page: 2, limit: 20, total: 45 });

  await listMyBookings({ status: readTab('requests').statuses, page: 1 });
  assert.equal(calls[1].params.status, 'pending,waitlisted');
});

test('card hints: starts in, due back, overdue since, place in line', async () => {
  const { cardHint } = await view();
  const now = Date.parse('2026-11-03T02:30:00.000Z'); // two hours before the 10:00 IST start
  assert.equal(cardHint(mineBooking(), now), 'Starts in 2 h');
  assert.equal(cardHint(mineBooking(), Date.parse('2026-11-03T05:00:00.000Z')), 'Started 30 min ago');
  assert.equal(cardHint(mineBooking({ status: 'checked_in' }), now), 'Due back 12:00 IST');
  assert.equal(cardHint(mineBooking({ status: 'checked_in', flags: { overdue: true } }), now), 'Overdue since 12:00 IST');
  assert.equal(cardHint(mineBooking({ status: 'waitlisted', waitlistPosition: 2 }), now), '#2 in line');
  assert.equal(cardHint(mineBooking({ status: 'pending' }), now), 'Waiting for a manager');
  assert.equal(cardHint(mineBooking({ status: 'completed' }), now), null);
});

test('decisionSummary follows the current status, not only the stored action', async () => {
  const { decisionSummary } = await view();
  const rejected = decisionSummary(
    mineBooking({ status: 'rejected', decision: { action: 'reject', by: 'mgr-1', at: '2026-10-29T06:00:00.000Z', reason: 'Clashes with a lab session' } }),
    BORROWER,
  );
  assert.equal(rejected.title, 'Request rejected');
  assert.equal(rejected.reason, 'Clashes with a lab session');

  const waitlist = { action: 'waitlist', by: 'mgr-1', at: '2026-10-29T06:00:00.000Z', reason: 'Printer reserved for the M.Des jury' };
  assert.equal(decisionSummary(mineBooking({ status: 'waitlisted', decision: waitlist }), BORROWER).title, 'Moved to the waitlist');
  // Promotion keeps the old decision on the server: the page says it was promoted.
  const promoted = decisionSummary(mineBooking({ status: 'pending', decision: waitlist }), BORROWER);
  assert.equal(promoted.title, 'Promoted from the waitlist');
  assert.equal(promoted.reasonLabel, 'Earlier waitlist reason');
  for (const status of ['approved', 'checked_in', 'checked_out', 'completed', 'flagged', 'no_show']) {
    assert.equal(decisionSummary(mineBooking({ status, decision: waitlist }), BORROWER).title, 'Promoted from the waitlist', status);
  }
  // The sweeper expires a waitlisted request whose slot never freed, and leaves its decision: it
  // was moved to the waitlist, never promoted, and a manager did decide on it.
  const lapsed = decisionSummary(mineBooking({ status: 'expired', decision: waitlist }), BORROWER);
  assert.equal(lapsed.title, 'Moved to the waitlist');
  assert.equal(lapsed.reasonLabel, 'Reason');
  assert.equal(lapsed.reason, 'Printer reserved for the M.Des jury');
  const { statusExplanation } = await view();
  assert.doesNotMatch(statusExplanation(mineBooking({ status: 'expired', decision: waitlist })), /Nobody decided/);
  assert.match(statusExplanation(mineBooking({ status: 'expired', decision: waitlist })), /waitlist/);
  assert.match(statusExplanation(mineBooking({ status: 'expired', decision: undefined })), /Nobody decided/);

  const auto = decisionSummary(mineBooking({ decision: { action: 'approve', at: '2026-10-29T06:00:00.000Z', reason: 'Auto-approved' } }), BORROWER);
  assert.equal(auto.title, 'Approved automatically');
  assert.equal(auto.reason, null);
  assert.equal(decisionSummary(mineBooking(), BORROWER).title, 'Approved by a manager');

  const mine = decisionSummary(
    mineBooking({ status: 'cancelled', cancellation: { by: 'user-aarav', at: '2026-10-30T06:00:00.000Z' } }),
    BORROWER,
  );
  assert.equal(mine.title, 'You cancelled this booking');
  assert.equal(mine.reason, null);
  const byManager = decisionSummary(
    mineBooking({ status: 'cancelled', cancellation: { by: 'mgr-1', at: '2026-10-30T06:00:00.000Z', reason: 'Machine under repair' } }),
    BORROWER,
  );
  assert.equal(byManager.title, 'Cancelled by a manager');
  assert.equal(byManager.reason, 'Machine under repair');
  assert.equal(decisionSummary(mineBooking({ status: 'pending', decision: undefined }), BORROWER), null);
});

test('statusExplanation gives a why for every status, with the place in line', async () => {
  const { statusExplanation } = await view();
  const { BOOKING_STATUSES } = await bookingsApi();
  for (const status of BOOKING_STATUSES) {
    assert.equal(typeof statusExplanation(mineBooking({ status })), 'string', status);
  }
  assert.match(statusExplanation(mineBooking({ status: 'waitlisted', waitlistPosition: 3 })), /#3 in line/);
  assert.match(statusExplanation(mineBooking({ status: 'checked_in', isOverdue: true })), /end time has passed/);
  assert.equal(statusExplanation({ status: 'mystery' }), null);
});

test('"Report an issue" is offered on the statuses POST /incidents takes, up to 7 days after the end for the borrower', async () => {
  const { canReportIssue } = await view();
  const end = Date.parse('2026-11-03T06:30:00.000Z');
  const booking = (status) => detailBooking({ status, start: '2026-11-03T04:30:00.000Z', end: '2026-11-03T06:30:00.000Z' });
  for (const status of ['approved', 'checked_in', 'checked_out', 'completed', 'flagged']) {
    assert.equal(canReportIssue(booking(status), BORROWER, end + DAY), true, status);
  }
  for (const status of ['pending', 'waitlisted', 'rejected', 'cancelled', 'expired', 'no_show']) {
    assert.equal(canReportIssue(booking(status), BORROWER, end + DAY), false, status);
  }
  assert.equal(canReportIssue(booking('completed'), BORROWER, end + 8 * DAY), false, 'past the 7 days');
  assert.equal(canReportIssue(booking('completed'), MANAGER, end + 30 * DAY), true, 'managers have no limit');
});

test('handoverBlock says why a handover is closed: window, ended, already done, wrong status', async () => {
  const { handoverBlock } = await view();
  const fixed = { start: '2026-11-03T04:30:00.000Z', end: '2026-11-03T06:30:00.000Z' };
  assert.equal(handoverBlock(detailBooking(), 'check_in'), null, 'allowedActions has checkIn');

  const early = handoverBlock(detailBooking({ ...fixed, allowedActions: ['cancel'] }), 'check_in', Date.parse('2026-11-03T02:00:00.000Z'));
  assert.equal(early.title, "Check-in isn't open yet");
  // Opens 15 minutes before 10:00 IST.
  assert.match(early.message, /at 3 Nov, 09:45 IST \(in 2 h 15 min\)/);
  assert.equal(early.opensAt, '2026-11-03T04:15:00.000Z');

  const late = handoverBlock(detailBooking({ ...fixed, allowedActions: [] }), 'check_in', Date.parse('2026-11-03T07:00:00.000Z'));
  assert.equal(late.title, 'This booking has ended');

  const inUse = handoverBlock(detailBooking({ status: 'checked_in', allowedActions: ['checkOut'] }), 'check_in');
  assert.equal(inUse.title, 'Already checked in');
  assert.equal(inUse.next, 'check_out');

  const first = handoverBlock(detailBooking({ allowedActions: ['cancel', 'checkIn'] }), 'check_out');
  assert.equal(first.title, 'Check in first');
  assert.equal(first.next, 'check_in');

  assert.equal(handoverBlock(detailBooking({ status: 'completed', allowedActions: [] }), 'check_out').title, 'Already checked out');
  assert.match(handoverBlock(detailBooking({ status: 'rejected', allowedActions: [] }), 'check_in').message, /It is rejected/);
  assert.equal(handoverBlock(detailBooking({ status: 'checked_in', allowedActions: ['checkOut'] }), 'check_out'), null);
});

test('route helpers encode the id', async () => {
  const { bookingPath, handoverPath, reportIssuePath } = await view();
  assert.equal(bookingPath('b1'), '/bookings/b1');
  assert.equal(handoverPath('b1', 'check_in'), '/bookings/b1/check-in');
  assert.equal(handoverPath('b1', 'check_out'), '/bookings/b1/check-out');
  assert.equal(reportIssuePath('b 1'), '/incidents/new?bookingId=b%201');
});

// ── handoverForm.js ───────────────────────────────────────────────────────────

const CHECKLIST = ['Nozzle clean', 'Build plate undamaged', 'Filament loaded'];

test('checklistOf reads resource.checklist and drops anything that is not a label', async () => {
  const { checklistOf } = await form();
  assert.deepEqual(checklistOf(detailBooking()), CHECKLIST);
  assert.deepEqual(checklistOf({ resource: { checklist: ['A', '', null, 3, 'B'] } }), ['A', 'B']);
  assert.deepEqual(checklistOf({ resource: 'r1' }), []);
  assert.deepEqual(checklistOf(null), []);
});

test('the wizard: every item answered before the photos, then the overall condition', async () => {
  const f = await form();
  let state = f.initialHandover();
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 1, 'unanswered items keep step ①');
  assert.deepEqual(Object.keys(state.errors), ['items.0.ok', 'items.1.ok', 'items.2.ok']);
  assert.equal(state.focus.target, 'items.0.ok', 'focus goes to the first unanswered item');

  state = f.handoverReducer(state, { type: 'answer', index: 0, label: 'Nozzle clean', ok: true });
  assert.equal(state.errors['items.0.ok'], undefined, 'answering clears its error');
  state = f.handoverReducer(state, { type: 'answer', index: 1, label: 'Build plate undamaged', ok: false });
  state = f.handoverReducer(state, { type: 'note', index: 1, label: 'Build plate undamaged', note: '  Scratch near the corner  ' });
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 1);
  assert.equal(state.focus.target, 'items.2.ok');
  state = f.handoverReducer(state, { type: 'answer', index: 2, label: 'Filament loaded', ok: true });
  const seq = state.focus.seq;
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 2);
  assert.equal(state.focus.target, 'step', 'a new step focuses its heading');
  assert.ok(state.focus.seq > seq);

  state = f.handoverReducer(state, { type: 'photos', photos: [PHOTO_A] });
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 3, 'photos are optional');
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 3);
  assert.equal(state.errors.overall, 'Choose the overall condition.');
  assert.equal(state.focus.target, 'overall');

  state = f.handoverReducer(state, { type: 'overall', value: 'minor_issue' });
  state = f.handoverReducer(state, { type: 'notes', value: ' Bed slightly scratched ' });
  assert.deepEqual(f.validateAll(state, CHECKLIST), {});
  assert.deepEqual(f.checklistSummary(CHECKLIST, state.answers), { total: 3, answered: 3, notOk: 1 });

  state = f.handoverReducer(state, { type: 'back' });
  assert.equal(state.step, 2);
  assert.equal(f.handoverReducer(f.initialHandover(), { type: 'back' }).step, 1);

  assert.deepEqual(f.reportFor(state, CHECKLIST), {
    items: [
      { label: 'Nozzle clean', ok: true, note: '' },
      { label: 'Build plate undamaged', ok: false, note: '  Scratch near the corner  ' },
      { label: 'Filament loaded', ok: true, note: '' },
    ],
    overall: 'minor_issue',
    notes: ' Bed slightly scratched ',
    photos: [PHOTO_A],
  });
});

test('local limits: item notes at most 200, notes at most 1000 (api.md)', async () => {
  const f = await form();
  const answers = { 'Nozzle clean': { ok: true, note: 'x'.repeat(201) } };
  assert.match(f.validateChecklist(['Nozzle clean'], answers)['items.0.note'], /at most 200 characters \(now 201\)/);
  assert.deepEqual(f.validateChecklist([], {}), {}, 'an empty checklist needs no answers');
  assert.match(f.validateCondition({ overall: 'good', notes: 'y'.repeat(1001) }).notes, /at most 1000/);
  assert.equal(f.validateCondition({ overall: 'excellent' }).overall, 'Choose the overall condition.');
  assert.deepEqual(f.validateCondition({ overall: 'damaged', notes: '' }), {});
});

test('a "Not OK" item needs a note saying what is wrong (frontend.md §9), as on the return check', async () => {
  const f = await form();
  const bare = f.validateChecklist(CHECKLIST, {
    'Nozzle clean': { ok: true },
    'Build plate undamaged': { ok: false, note: '   ' },
    'Filament loaded': { ok: false },
  });
  assert.deepEqual(Object.keys(bare), ['items.1.note', 'items.2.note']);
  assert.equal(bare['items.1.note'], "Say what's wrong with it.");
  // Step ① doesn't go on, and focus goes to the first missing note.
  let state = f.initialHandover();
  state = f.handoverReducer(state, { type: 'answer', index: 0, label: 'Nozzle clean', ok: true });
  state = f.handoverReducer(state, { type: 'answer', index: 1, label: 'Build plate undamaged', ok: false });
  state = f.handoverReducer(state, { type: 'answer', index: 2, label: 'Filament loaded', ok: true });
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 1);
  assert.equal(state.focus.target, 'items.1.note');
  state = f.handoverReducer(state, { type: 'note', index: 1, label: 'Build plate undamaged', note: 'Scratch near the corner' });
  assert.equal(state.errors['items.1.note'], undefined);
  state = f.handoverReducer(state, { type: 'next', checklist: CHECKLIST });
  assert.equal(state.step, 2);
  // Marking it OK again drops the need for a note.
  assert.deepEqual(f.validateChecklist(['Nozzle clean'], { 'Nozzle clean': { ok: true, note: '' } }), {});
});

test('the note under a "Not OK" item is labelled as required; under an OK one it stays optional', async () => {
  const { ChecklistStep } = await load('/src/features/bookings/components/HandoverSteps.jsx');
  const html = await render((React) =>
    React.createElement(ChecklistStep, {
      prefix: 'h',
      checklist: CHECKLIST,
      answers: { 'Nozzle clean': { ok: true }, 'Build plate undamaged': { ok: false } },
      errors: { 'items.1.note': "Say what's wrong with it." },
      itemsErrors: [],
      dispatch() {},
    }),
  );
  assert.match(html, /<label for="h-items-0-note"[^>]*>Note \(optional\)<\/label>/);
  assert.match(html, /<label for="h-items-1-note"[^>]*>What(&#x27;|')s wrong with it\?<\/label>/);
  assert.match(html, /<input id="h-items-1-note"[^>]*aria-required="true"/);
  assert.doesNotMatch(html, /<input id="h-items-0-note"[^>]*aria-required/);
  assert.match(html, /<p id="h-items-1-note-error"[^>]*>.*Say what(&#x27;|')s wrong with it\./s);
});

test('server field errors land on their step and field; other errors leave the form as it is', async () => {
  const f = await form();
  const base = { ...f.initialHandover(), step: 3 };
  const validation = (details) => ({ status: 400, code: 'VALIDATION_ERROR', message: 'Check the fields.', details, requestId: 'req-400' });

  const note = f.handoverReducer(base, {
    type: 'serverError',
    error: validation([{ path: 'items.1.note', message: 'Path `note` is longer than the maximum allowed length (200).' }]),
  });
  assert.equal(note.step, 1);
  assert.equal(note.focus.target, 'items.1.note');
  assert.match(note.errors['items.1.note'], /maximum allowed length/);

  const photo = f.handoverReducer(base, {
    type: 'serverError',
    error: validation([{ path: 'photos.0', message: 'Must be a photo uploaded through /uploads/images.' }]),
  });
  assert.equal(photo.step, 2);
  assert.equal(photo.focus.target, 'step', 'the uploader has no field id: its step heading takes focus');

  const checklistChanged = f.handoverReducer(base, {
    type: 'serverError',
    error: validation([
      { path: 'items', message: 'Missing: Filament loaded' },
      { path: 'items', message: "Not on this resource's checklist: Bed clean" },
    ]),
  });
  assert.equal(checklistChanged.step, 1);
  assert.deepEqual(checklistChanged.itemsErrors, ['Missing: Filament loaded', "Not on this resource's checklist: Bed clean"]);

  const both = f.handoverReducer(base, {
    type: 'serverError',
    error: validation([
      { path: 'notes', message: 'Can be at most 1000 characters.' },
      { path: 'items.2.ok', message: 'Path `ok` is required.' },
    ]),
  });
  assert.equal(both.step, 1, 'the earliest step wins');
  assert.equal(both.focus.target, 'items.2.ok');
  assert.equal(both.errors.notes, 'Can be at most 1000 characters.');

  const windowClosed = {
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'Check-in opens 15 minutes before the start time (5 Nov, 14:30).',
    details: [],
    requestId: 'req-409',
  };
  assert.equal(f.hasFieldErrors(windowClosed), false);
  assert.equal(f.handoverReducer(base, { type: 'serverError', error: windowClosed }), base, 'shown in place, nothing moves');
  assert.equal(f.hasFieldErrors(validation([{ path: 'overall', message: 'Required.' }])), true);
  assert.equal(f.hasFieldErrors(validation([{ path: 'somethingElse', message: 'Nope.' }])), false);
});

test('fieldDomId maps a field path to the control that takes focus', async () => {
  const { fieldDomId, itemsByLabel, stepOfPath } = await form();
  assert.equal(fieldDomId('h', 'items.2.ok'), 'h-items-2-ok');
  assert.equal(fieldDomId('h', 'items.2'), 'h-items-2-ok');
  assert.equal(fieldDomId('h', 'items.0.note'), 'h-items-0-note');
  assert.equal(fieldDomId('h', 'overall'), 'h-overall-good');
  assert.equal(fieldDomId('h', 'notes'), 'h-notes');
  assert.equal(fieldDomId('h', 'step'), null);
  assert.equal(stepOfPath('photos'), 2);
  assert.equal(stepOfPath('reason'), null);
  assert.deepEqual(itemsByLabel(CHECK_IN_REPORT)['Build plate undamaged'], { ok: false, note: 'Slight scratch on the bed' });
  assert.deepEqual(itemsByLabel(null), {});
});

test('check-in and check-out send { items, overall, notes, photos } as api.md defines', async () => {
  const f = await form();
  const { checkInBooking, checkOutBooking } = await bookingsApi();
  const calls = fakeApi({
    'POST /bookings/b1/check-in': () => ({ status: 200, data: { ...mineBooking({ status: 'checked_in' }), resource: 'r1' } }),
    'POST /bookings/b1/check-out': () => ({ status: 200, data: { ...mineBooking({ status: 'checked_out' }), resource: 'r1' } }),
  });
  const state = {
    ...f.initialHandover(),
    answers: {
      'Nozzle clean': { ok: true, note: '   ' },
      'Build plate undamaged': { ok: false, note: ' Scratch near the corner ' },
      'Filament loaded': { ok: true },
    },
    photos: [{ ...PHOTO_A, previewUrl: 'blob:local' }],
    overall: 'minor_issue',
    notes: '  ',
  };
  const res = await checkInBooking('b1', f.reportFor(state, CHECKLIST));
  assert.equal(res.data.status, 'checked_in');
  assert.deepEqual(calls[0].body, {
    items: [
      { label: 'Nozzle clean', ok: true },
      { label: 'Build plate undamaged', ok: false, note: 'Scratch near the corner' },
      { label: 'Filament loaded', ok: true },
    ],
    overall: 'minor_issue',
    photos: [PHOTO_A],
  });

  await checkOutBooking('b1', f.reportFor({ ...state, photos: [], notes: 'Bed slightly scratched' }, CHECKLIST));
  assert.equal(calls[1].key, 'POST /bookings/b1/check-out');
  assert.equal(calls[1].body.notes, 'Bed slightly scratched');
  assert.equal('photos' in calls[1].body, false, 'no photos, no key');
});

test('a check-in waits for the server, then refreshes the booking, its timeline and the lists', async () => {
  const f = await form();
  const api = await bookingsApi();
  fakeApi({ 'POST /bookings/b1/check-in': () => ({ status: 200, data: { ...mineBooking({ status: 'checked_in' }), resource: 'r1' } }) });
  const state = { ...f.initialHandover(), answers: { A: { ok: true } }, overall: 'good' };
  const { result, invalidated, client } = await withHook(api.useCheckIn);
  await result.mutateAsync({ id: 'b1', resourceId: 'r1', ...f.reportFor(state, ['A']) });
  // ['booking', 'b1'] is the prefix of ['booking', 'b1', 'timeline'] (frontend.md §8.2).
  assert.deepEqual(invalidated, [
    ['bookings'],
    ['booking', 'b1'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
  ]);
  client.clear();

  fakeApi({
    'POST /bookings/b1/check-in': () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'Check-in opens 15 minutes before the start time (5 Nov, 14:30).',
    }),
  });
  const refused = await withHook(api.useCheckIn);
  const err = await rejection(refused.result.mutateAsync({ id: 'b1', ...f.reportFor(state, ['A']) }));
  assert.equal(err.status, 409);
  assert.equal(err.requestId, 'req-err');
  assert.equal(f.hasFieldErrors(err), false, 'shown above the button, with its request id');
  refused.client.clear();
});

// ── My bookings ───────────────────────────────────────────────────────────────

const mineKey = async (tabId, page = 1) => {
  const { readTab } = await view();
  const { bookingKeys, MINE_PAGE_SIZE } = await bookingsApi();
  return bookingKeys.mineList({ status: readTab(tabId).statuses, page, limit: MINE_PAGE_SIZE });
};

test('My bookings: Upcoming cards show the resource, the IST slot, the status and a link', async () => {
  const { default: MyBookingsPage } = await load('/src/features/bookings/MyBookingsPage.jsx');
  signIn(BORROWER);
  const html = await render((React) => React.createElement(MyBookingsPage), {
    path: '/bookings',
    cache: [
      [
        await mineKey('upcoming'),
        {
          data: [
            mineBooking(),
            mineBooking({ _id: 'b2', status: 'checked_in', isOverdue: undefined, flags: { overdue: true } }),
          ],
          meta: { page: 1, limit: 20, total: 45 },
        },
      ],
    ],
  });
  const shown = text(html);
  assert.match(html, /<h1[^>]*>My bookings<\/h1>/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>Upcoming<\/button>/);
  assert.match(html, /<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"[^>]*>Requests<\/button>/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /<a[^>]*href="\/bookings\/b1"[^>]*>FDM 3D Printer #2<\/a>/);
  assert.match(html, /href="\/bookings\/b2"/);
  assert.match(shown, /Tue 3 Nov, 10:00–12:00 IST · 2 h/);
  assert.match(shown, /Prototyping Lab, Design and Innovation Centre, Ground floor/);
  assert.match(shown, /Approved/);
  assert.match(shown, /Overdue/, 'flags.overdue on a list item turns In use into Overdue');
  assert.match(shown, /Overdue since 12:00 IST/);
  assert.match(shown, /Purpose: Printing the chassis/);
  assert.match(shown, /45 bookings/);
  assert.match(shown, /Page 1 of 3/);
  assert.match(html, /<nav aria-label="Upcoming pages"/);
});

test('My bookings: Requests show the waitlist place; an empty tab says what goes there', async () => {
  const { default: MyBookingsPage } = await load('/src/features/bookings/MyBookingsPage.jsx');
  signIn(BORROWER);
  const requests = await render((React) => React.createElement(MyBookingsPage), {
    path: '/bookings?tab=requests',
    cache: [
      [
        await mineKey('requests'),
        {
          data: [mineBooking({ status: 'pending' }), mineBooking({ _id: 'b3', status: 'waitlisted', waitlistPosition: 2 })],
          meta: { page: 1, limit: 20, total: 2 },
        },
      ],
    ],
  });
  const shown = text(requests);
  assert.match(requests, /aria-selected="true"[^>]*>Requests<\/button>/);
  assert.match(shown, /Awaiting review/);
  assert.match(shown, /Waitlisted \(#2\)/);
  assert.match(shown, /#2 in line/);
  assert.doesNotMatch(shown, /Page 1 of/, 'one page: no pagination');

  const empty = await render((React) => React.createElement(MyBookingsPage), {
    path: '/bookings?tab=past',
    cache: [[await mineKey('past'), { data: [], meta: { page: 1, limit: 20, total: 0 } }]],
  });
  assert.match(text(empty), /No past bookings yet/);
});

test('My bookings: loading, and an error with the message, the request id and a retry', async () => {
  const { default: MyBookingsPage } = await load('/src/features/bookings/MyBookingsPage.jsx');
  const loading = await render((React) => React.createElement(MyBookingsPage), { path: '/bookings' });
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading your bookings/);

  const failed = await render((React) => React.createElement(MyBookingsPage), {
    path: '/bookings',
    errors: [[await mineKey('upcoming'), { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-500' }]],
  });
  const shown = text(failed);
  assert.match(failed, /role="alert"/);
  assert.match(shown, /Couldn't load your bookings/);
  assert.match(shown, /Something went wrong\./);
  assert.match(shown, /ref: req-500/);
  assert.match(shown, /Try again/);
});

// ── Booking detail ────────────────────────────────────────────────────────────

async function renderDetail(booking, { timeline = TIMELINE, user = BORROWER, errors = [] } = {}) {
  const { default: BookingDetailPage } = await load('/src/features/bookings/BookingDetailPage.jsx');
  const { bookingKeys } = await bookingsApi();
  if (user) signIn(user);
  const cache = [];
  if (booking) cache.push([bookingKeys.detail('b1'), { data: booking }]);
  if (timeline) cache.push([bookingKeys.timeline('b1'), { data: timeline }]);
  return render((React) => React.createElement(BookingDetailPage), {
    path: '/bookings/b1',
    route: '/bookings/:id',
    cache,
    errors,
  });
}

test('booking detail: status, details, the action bar from allowedActions, reports and history', async () => {
  const { formatSlot } = await view();
  const booking = detailBooking();
  const html = await renderDetail(booking);
  const shown = text(html);
  assert.match(html, /<h1[^>]*tabindex="-1"[^>]*>FDM 3D Printer #2<\/h1>/);
  assert.match(shown, /Booking · Design and Innovation Centre/);
  assert.ok(shown.includes(formatSlot(booking.start, booking.end)), 'the slot in IST');
  assert.match(shown, /Approved/);
  assert.match(shown, /Approved by a manager/);
  // The action bar: check in links to the wizard; cancel opens a dialog; report goes to /incidents/new.
  assert.match(html, /<a[^>]*href="\/bookings\/b1\/check-in"[^>]*>.*Check in<\/a>/s);
  assert.match(html, /<button[^>]*type="button"[^>]*>.*Cancel booking<\/button>/s);
  assert.match(html, /href="\/incidents\/new\?bookingId=b1"/);
  assert.doesNotMatch(html, /href="\/bookings\/b1\/check-out"/, 'not in allowedActions');
  assert.doesNotMatch(shown, /Review in the requests queue/);
  // Details: the location object as text, the unit, the purpose; no borrower line for the borrower.
  assert.match(shown, /Prototyping Lab, Design and Innovation Centre, Ground floor/);
  assert.match(shown, /Design and Innovation Centre \(DIC\)/);
  assert.match(shown, /Printing the chassis for the robotics club/);
  assert.doesNotMatch(shown, /Borrower/);
  // Condition reports, side by side, and the full timeline.
  assert.match(html, /<h2[^>]*>.*Condition reports<\/h2>/s);
  assert.match(html, /alt="Check-in photo 1 of 2, FDM 3D Printer #2"/);
  assert.match(shown, /Checklist: 3 items, 1 not OK/);
  assert.match(shown, /Not OK: Build plate undamaged — Slight scratch on the bed/);
  assert.match(html, /<ol aria-label="Booking history"/);
  assert.match(shown, /Aarav Student requested this booking/);
  assert.match(html, /href="\/incidents\/inc-1"/);
});

test('booking detail: an overdue booking says so clearly, with check-out first', async () => {
  const booking = detailBooking({
    status: 'checked_in',
    start: new Date(Date.now() - 3 * HOUR).toISOString(),
    end: new Date(Date.now() - HOUR).toISOString(),
    allowedActions: ['checkOut'],
    isOverdue: true,
  });
  const html = await renderDetail(booking);
  const shown = text(html);
  assert.match(shown, /OVERDUE|Overdue/);
  assert.match(shown, /hasn't been checked out/);
  assert.match(shown, /1 h ago/);
  assert.match(html, /href="\/bookings\/b1\/check-out"/);
  assert.doesNotMatch(html, /Cancel booking/);
  assert.match(shown, /The end time has passed/);
});

test('booking detail: a rejected request shows the reason; a cancelled one has no actions', async () => {
  const rejected = await renderDetail(
    detailBooking({
      status: 'rejected',
      decision: { action: 'reject', by: 'mgr-1', at: '2026-10-29T06:00:00.000Z', reason: 'Clashes with a lab session' },
      allowedActions: [],
    }),
    { timeline: [] },
  );
  const shown = text(rejected);
  assert.match(shown, /Rejected/);
  assert.match(shown, /Request rejected/);
  assert.match(shown, /Reason: “Clashes with a lab session”/);
  assert.match(shown, /Nothing to do on this booking right now/);
  assert.match(shown, /No condition reports yet/);
  assert.match(shown, /No history yet/);
  assert.doesNotMatch(rejected, /incidents\/new/, 'no incident on a rejected booking');

  const waitlisted = await renderDetail(
    detailBooking({ status: 'waitlisted', waitlistPosition: 2, allowedActions: ['cancel'], decision: undefined }),
  );
  assert.match(text(waitlisted), /Waitlisted \(#2\)/);
  assert.match(text(waitlisted), /You're #2 in line/);
  assert.match(waitlisted, />Cancel request<\/button>/);
});

test('booking detail: before the window it says when check-in opens', async () => {
  const start = new Date(Date.now() + 2 * DAY);
  const booking = detailBooking({
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * HOUR).toISOString(),
    allowedActions: ['cancel'],
  });
  const shown = text(await renderDetail(booking));
  assert.match(shown, /Check-in isn't open yet\. Check-in opens 15 minutes before the start, at .+ IST \(in 1 day\)/);
});

test('booking detail: a manager sees the borrower and the links to the queue and the return check', async () => {
  const pending = await renderDetail(
    detailBooking({ status: 'pending', decision: undefined, allowedActions: ['approve', 'reject', 'waitlist', 'cancel'] }),
    { user: MANAGER },
  );
  const shown = text(pending);
  assert.match(shown, /Borrower Aarav Student · UG · Computer Science and Engineering/);
  assert.match(pending, /href="\/manage\/requests"/);
  assert.match(shown, /Cancel request/);

  const returned = await renderDetail(
    detailBooking({ status: 'checked_out', allowedActions: ['confirmOk', 'confirmIssue'] }),
    { user: MANAGER },
  );
  assert.match(returned, /href="\/manage\/returns\/b1"/);
  assert.match(text(returned), /Confirm the return/);
});

test('booking detail: loading, and a 404 with the message, request id, retry and a way back', async () => {
  const loading = await renderDetail(null, { timeline: null });
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the booking/);

  const { bookingKeys } = await bookingsApi();
  const missing = await renderDetail(null, {
    timeline: null,
    errors: [[bookingKeys.detail('b1'), { status: 404, code: 'NOT_FOUND', message: 'Booking not found.', requestId: 'req-404' }]],
  });
  const shown = text(missing);
  assert.match(missing, /<h1[^>]*>Booking<\/h1>/);
  assert.match(shown, /Couldn't load this booking/);
  assert.match(shown, /Booking not found\./);
  assert.match(shown, /ref: req-404/);
  assert.match(shown, /Try again/);
  assert.match(missing, /href="\/bookings"[^>]*>Back to my bookings/);
});

test('booking detail: a failed timeline keeps the booking and offers a retry for the history', async () => {
  const { bookingKeys } = await bookingsApi();
  const html = await renderDetail(detailBooking(), {
    timeline: null,
    errors: [[bookingKeys.timeline('b1'), { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again later.', requestId: 'req-503' }]],
  });
  const shown = text(html);
  assert.match(shown, /FDM 3D Printer #2/);
  assert.match(shown, /Couldn't load the booking history/);
  assert.match(shown, /ref: req-503/);
});

test('cancel asks the borrower only to confirm, and a manager for a reason (api.md cancel)', async () => {
  const { CancelBookingDialog } = await load('/src/features/bookings/components/CancelBookingDialog.jsx');
  const { ConfirmDialog } = await load('/src/components/ui/ConfirmDialog.jsx');
  const { ReasonDialog } = await load('/src/components/ui/ReasonDialog.jsx');
  const request = { isPending: false, error: null };
  const props = { open: true, onClose() {}, onConfirm() {}, request, returnFocusRef: { current: null } };

  const borrower = CancelBookingDialog({ ...props, booking: detailBooking(), user: BORROWER });
  assert.equal(borrower.type, ConfirmDialog);
  assert.equal(borrower.props.title, 'Cancel this booking?');
  assert.equal(borrower.props.confirmLabel, 'Cancel booking');
  assert.equal(borrower.props.variant, 'danger');
  assert.match(borrower.props.description, /FDM 3D Printer #2 · .+ IST/);

  let sent = null;
  CancelBookingDialog({ ...props, onConfirm: (reason) => (sent = reason), booking: detailBooking(), user: BORROWER }).props.onConfirm();
  assert.equal(sent, '', 'no reason from the borrower');

  const manager = CancelBookingDialog({ ...props, booking: detailBooking({ status: 'pending' }), user: MANAGER });
  assert.equal(manager.type, ReasonDialog);
  assert.equal(manager.props.required, true);
  assert.equal(manager.props.maxLength, 500);
  assert.equal(manager.props.title, 'Cancel this request?');
  assert.equal(CancelBookingDialog({ ...props, booking: null, user: BORROWER }), null);
});

// ── Check-in and check-out ────────────────────────────────────────────────────

async function renderHandover(phase, booking, { timeline, timelineError } = {}) {
  const { default: HandoverPage } = await load('/src/features/bookings/HandoverPage.jsx');
  const { bookingKeys } = await bookingsApi();
  signIn(BORROWER);
  const cache = booking ? [[bookingKeys.detail('b1'), { data: booking }]] : [];
  if (timeline) cache.push([bookingKeys.timeline('b1'), { data: timeline }]);
  const segment = phase === 'check_out' ? 'check-out' : 'check-in';
  return render((React) => React.createElement(HandoverPage, { phase }), {
    path: `/bookings/b1/${segment}`,
    route: `/bookings/:id/${segment}`,
    cache,
    errors: timelineError ? [[bookingKeys.timeline('b1'), timelineError]] : [],
  });
}

test('check-in wizard: ① the checklist as labelled OK / Not OK choices, ② photos, ③ condition', async () => {
  const html = await renderHandover('check_in', detailBooking());
  const shown = text(html);
  assert.match(html, /<h1[^>]*tabindex="-1"[^>]*>.*Check in<\/h1>/s);
  assert.match(shown, /FDM 3D Printer #2 · /);
  assert.match(html, /<li aria-current="step"[^>]*><span class="sr-only">Step <\/span>1\. Checklist/);
  // Every checklist label is a fieldset with two labelled radios and a labelled note.
  for (const [index, label] of CHECKLIST.entries()) {
    assert.match(html, new RegExp(`<legend[^>]*>${index + 1}\\. ${label}</legend>`));
    assert.match(html, new RegExp(`<label for="[^"]*-items-${index}-ok"`));
    assert.match(html, new RegExp(`<input id="[^"]*-items-${index}-ok" type="radio"[^>]*name="[^"]*-item-${index}"`));
    assert.match(html, new RegExp(`<input id="[^"]*-items-${index}-notok" type="radio"`));
    assert.match(html, new RegExp(`<label for="[^"]*-items-${index}-note"[^>]*>Note \\(optional\\)</label>`));
  }
  assert.match(html, /maxLength="200"/);
  // Steps ② and ③ are on the page but hidden, so the uploader keeps its state between steps.
  assert.equal((html.match(/<section hidden=""/g) ?? []).length, 2);
  assert.match(html, /<legend[^>]*>Check-in photos \(optional\)<\/legend>/);
  assert.match(html, /<legend[^>]*>Overall condition<\/legend>/);
  assert.match(html, /<input id="[^"]*-overall-good" type="radio"/);
  assert.match(html, /<textarea id="[^"]*-notes"[^>]*maxLength="1000"/);
  assert.match(shown, /Check in now/);
  assert.match(shown, /Next: Photos/);
  assert.doesNotMatch(shown, /At check-in, for reference/, 'only the check-out compares');
});

test('check-out wizard: the check-in photos and answers are shown for reference', async () => {
  const booking = detailBooking({ status: 'checked_in', allowedActions: ['checkOut'] });
  const html = await renderHandover('check_out', booking, { timeline: TIMELINE });
  const shown = text(html);
  assert.match(html, /<h1[^>]*>.*Check out<\/h1>/s);
  assert.match(shown, /At check-in, for reference/);
  assert.match(html, /alt="Check-in photo 1 of 2, FDM 3D Printer #2"/);
  assert.match(html, /alt="Check-in photo 2 of 2, FDM 3D Printer #2"/);
  assert.match(shown, /Notes at check-in: “Bed slightly scratched”/);
  assert.match(shown, /At check-in: Not OK — Slight scratch on the bed/);
  assert.match(shown, /At check-in: OK/);
  assert.match(html, /<legend[^>]*>Check-out photos \(optional\)<\/legend>/);
  assert.match(shown, /Check out now/);
});

test('check-out wizard: a failed timeline shows its error and retry; the form still works', async () => {
  const booking = detailBooking({ status: 'checked_in', allowedActions: ['checkOut'] });
  const html = await renderHandover('check_out', booking, {
    timelineError: { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-tl' },
  });
  const shown = text(html);
  assert.match(shown, /Couldn't load the check-in photos/);
  assert.match(shown, /ref: req-tl/);
  assert.match(shown, /Check out now/);
});

test('the wizard explains a closed handover instead of showing the form', async () => {
  const start = new Date(Date.now() + 2 * DAY);
  const early = await renderHandover(
    'check_in',
    detailBooking({ start: start.toISOString(), end: new Date(start.getTime() + 2 * HOUR).toISOString(), allowedActions: ['cancel'] }),
  );
  const shown = text(early);
  assert.match(shown, /Check-in isn't open yet/);
  assert.match(shown, /Check again/);
  assert.match(early, /href="\/bookings\/b1"[^>]*>Back to the booking/);
  assert.doesNotMatch(early, /<form/);

  const already = await renderHandover('check_in', detailBooking({ status: 'checked_in', allowedActions: ['checkOut'] }));
  assert.match(text(already), /Already checked in/);
  assert.match(already, /href="\/bookings\/b1\/check-out"[^>]*>Go to check-out/);

  const notYet = await renderHandover('check_out', detailBooking());
  assert.match(text(notYet), /Check in first/);
  assert.match(notYet, /href="\/bookings\/b1\/check-in"[^>]*>Go to check-in/);
});

test('the wizard: loading, and a booking that failed to load', async () => {
  const loading = await renderHandover('check_in', null);
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the booking/);
  assert.match(loading, /<h1[^>]*>.*Check in<\/h1>/s);
});

test('a resource without a checklist goes straight on', async () => {
  const booking = detailBooking({ resource: { ...detailBooking().resource, checklist: [] } });
  const shown = text(await renderHandover('check_in', booking));
  assert.match(shown, /This resource has no checklist/);
});

// ── Step components with errors ──────────────────────────────────────────────

test('ChecklistStep links each error to its radios and announces how many are left', async () => {
  const { ChecklistStep } = await load('/src/features/bookings/components/HandoverSteps.jsx');
  const html = await render((React) =>
    React.createElement(ChecklistStep, {
      prefix: 'h',
      checklist: CHECKLIST,
      answers: { 'Nozzle clean': { ok: true } },
      errors: { 'items.1.ok': 'Choose OK or Not OK.', 'items.2.ok': 'Choose OK or Not OK.', 'items.0.note': 'Too long.' },
      itemsErrors: [],
      dispatch() {},
    }),
  );
  const shown = text(html);
  assert.match(html, /<p role="alert"[^>]*>Answer every item before you go on \(2 left\)/);
  assert.match(html, /<input id="h-items-1-ok" type="radio"[^>]*aria-describedby="h-items-1-error"[^>]*name="h-item-1"/);
  assert.match(html, /<p id="h-items-1-error"/);
  assert.match(html, /<input id="h-items-0-ok" type="radio"[^>]*name="h-item-0" checked=""/);
  assert.match(html, /id="h-items-0-note"[^>]*aria-invalid="true"[^>]*aria-describedby="h-items-0-note-help h-items-0-note-error"/);
  assert.match(shown, /Too long\./);

  const changed = await render((React) =>
    React.createElement(ChecklistStep, {
      prefix: 'h',
      checklist: CHECKLIST,
      answers: {},
      errors: {},
      itemsErrors: ['Missing: Spool holder'],
      dispatch() {},
      onReload() {},
    }),
  );
  assert.match(text(changed), /The checklist has changed since this page loaded/);
  assert.match(text(changed), /Missing: Spool holder/);
  assert.match(text(changed), /Load the current checklist/);
  // 44 px targets on the handover screens (frontend.md §10.3).
  assert.match(changed, /<button[^>]*class="[^"]*min-h-\[44px\][^"]*"[^>]*>.*Load the current checklist<\/button>/s);
  assert.doesNotMatch(changed, /min-h-\[40px\]/);
});

test('the handover screens keep every control at least 44 px tall (frontend.md §10.3)', async () => {
  const html = await renderHandover('check_in', detailBooking());
  assert.match(html, /<a(?=[^>]*class="[^"]*min-h-\[44px\])(?=[^>]*href="\/bookings\/b1")[^>]*>(?:(?!<\/a>).)*Back to the booking<\/a>/s);
  assert.doesNotMatch(html, /min-h-\[(?:3\d|40)px\]/);
});

test('ConditionStep: required overall condition with an announced error, notes with a counter', async () => {
  const { ConditionStep } = await load('/src/features/bookings/components/HandoverSteps.jsx');
  const html = await render((React) =>
    React.createElement(ConditionStep, {
      prefix: 'h',
      overall: '',
      notes: 'Bed slightly scratched',
      errors: { overall: 'Choose the overall condition.', notes: 'Can be at most 1000 characters.' },
      summary: { total: 3, answered: 3, notOk: 1 },
      photoCount: 2,
      checkOut: true,
      dispatch() {},
    }),
  );
  const shown = text(html);
  assert.match(html, /<fieldset[^>]*aria-describedby="h-overall-error"/);
  assert.match(html, /<p id="h-overall-error" role="alert"/);
  for (const label of ['Good condition', 'Minor issue', 'Damaged']) assert.match(shown, new RegExp(label));
  assert.match(html, /<textarea id="h-notes"[^>]*aria-invalid="true"[^>]*aria-describedby="h-notes-help h-notes-error"/);
  assert.match(shown, /22\/1000/);
  assert.match(shown, /Checklist: 2 of 3 OK, 1 not OK/);
  assert.match(shown, /Photos: 2 of 3/);

  const good = await render((React) =>
    React.createElement(ConditionStep, {
      prefix: 'h',
      overall: 'good',
      notes: '',
      errors: {},
      summary: { total: 3, answered: 3, notOk: 1 },
      photoCount: 0,
      checkOut: false,
      dispatch() {},
    }),
  );
  assert.match(good, /<input id="h-overall-good" type="radio"[^>]*name="h-overall" checked="" value="good"/);
  assert.match(text(good), /You marked 1 item as not OK/);
  assert.match(text(good), /Photos: none/);
});

test('StepProgress marks the current step and the done ones for a screen reader', async () => {
  const { StepProgress } = await load('/src/features/bookings/components/HandoverSteps.jsx');
  const html = await render((React) => React.createElement(StepProgress, { step: 2 }));
  assert.match(html, /<ol aria-label="Progress"/);
  assert.match(html, /<li aria-current="step"[^>]*>.*Photos/s);
  assert.match(text(html), /1\. Checklist \(done\)/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
});
