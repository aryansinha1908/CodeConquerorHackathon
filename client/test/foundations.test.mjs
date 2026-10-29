// Tests for the shared booking foundation: lib/time.js, lib/errors.js, lib/paging.js,
// lib/reason.js, lib/bookingStatus.js, features/bookings/api.js, features/uploads/api.js, the UI
// kit (StatusBadge, ErrorState, ReasonForm, Pagination, Badge, Button, Input, Select, CardTitle),
// BookingTimeline, PhotoUploader and the routes. Run with `npm test` (node:test, no extra
// dependencies).
//
// The real modules load through Vite's SSR loader, like test/verification.test.mjs. Requests go
// to a fake axios adapter; components render with react-dom/server from data shaped exactly as
// docs/api.md describes, so a crash such as rendering an object as text shows up here.
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

// routes: { 'POST /bookings/b1/cancel': (config) => answer }. An answer is { status, data, meta } or
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
    if (answer.network) throw new AxiosError('Network Error', 'ERR_NETWORK', config, {});
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

const PHOTO_A = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000000/campuscommons/photos/a1.jpg',
  publicId: 'campuscommons/photos/a1',
};
const PHOTO_B = {
  url: 'https://res.cloudinary.com/demo/image/upload/v1730000001/campuscommons/photos/b2.jpg',
  publicId: 'campuscommons/photos/b2',
};

// The Booking object as stored (create, decisions, handovers): references are bare ids.
const storedBooking = (overrides = {}) => ({
  _id: 'b1',
  resource: 'r1',
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

// GET /bookings/:id: populated resource, borrower and orgUnit, plus allowedActions and friends.
const detailBooking = (overrides = {}) => ({
  ...storedBooking(),
  resource: {
    _id: 'r1',
    title: 'FDM 3D Printer #2',
    slug: 'fdm-3d-printer-2',
    location: 'DIC Lab 2',
    bookingMode: 'slot',
    checklist: ['Bed clean', 'Nozzle intact'],
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
});

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
    action: 'booking.waitlisted',
    actor: { role: 'manager', name: 'Priya Manager' },
    reason: 'Printer reserved for the M.Des jury',
    text: 'Manager (DIC) moved this request to the waitlist: "Printer reserved for the M.Des jury"',
  },
  {
    kind: 'event',
    at: '2026-10-30T02:30:00.000Z',
    action: 'booking.promoted',
    actor: { role: 'system', name: null },
    reason: null,
    text: 'System promoted this request from the waitlist and confirmed it',
  },
  {
    kind: 'condition_report',
    at: '2026-11-03T04:25:00.000Z',
    phase: 'check_in',
    overall: 'minor_issue',
    items: [
      { label: 'Bed clean', ok: true },
      { label: 'Nozzle intact', ok: false, note: 'Slight scratch on the bed' },
    ],
    photos: [PHOTO_A, PHOTO_B],
    notes: 'Bed slightly scratched',
    by: 'Aarav Student',
    text: 'Check-in report: minor issue, 1 item flagged, 2 photos',
  },
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
    status: 'resolved',
    event: 'opened',
    at: '2026-11-03T07:00:00.000Z',
    text: 'Incident opened: low-severity damage',
  },
  {
    kind: 'incident',
    id: 'inc-1',
    type: 'damage',
    severity: 'low',
    status: 'resolved',
    event: 'resolved',
    at: '2026-11-04T05:00:00.000Z',
    outcome: 'warning',
    text: 'Incident resolved. Outcome: Warning',
  },
];

// ── Rendering ─────────────────────────────────────────────────────────────────

// Renders inside a router and a QueryClient whose cache holds `cache` ([key, data] pairs) and
// `errors` ([key, error] pairs, as a query that failed). A failed query would be fetched again on
// mount, so with `errors` the client doesn't retry on mount: the page sees the error it would show
// once that fetch failed in the browser.
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

// The background and text colours a class list sets, as #rrggbb (null when transparent).
function colours(className) {
  const pick = (prefix) => {
    const hex = className.match(new RegExp(`(?:^|\\s)${prefix}-\\[(#[0-9a-fA-F]{6})\\]`));
    if (hex) return hex[1].toLowerCase();
    if (new RegExp(`(?:^|\\s)${prefix}-white(?:\\s|$)`).test(className)) return '#ffffff';
    return null;
  };
  return { bg: pick('bg'), fg: pick('text') };
}

// ── lib/time.js ───────────────────────────────────────────────────────────────

test('IST formatters read the instant in IST, the way the server writes slots', async () => {
  const t = await load('/src/lib/time.js');
  // 04:30 UTC is 10:00 IST (UTC+05:30); 3 Nov 2026 is a Tuesday.
  assert.equal(t.formatIstTime('2026-11-03T04:30:00.000Z'), '10:00');
  assert.equal(t.formatIstDate('2026-11-03T04:30:00.000Z'), '3 Nov');
  assert.equal(t.formatIstDate('2026-11-03T04:30:00.000Z', { weekday: true }), 'Tue, 3 Nov');
  assert.equal(t.formatIstDate('2026-11-03T04:30:00.000Z', { year: true }), '3 Nov 2026');
  assert.equal(t.formatIstShortDateTime('2026-11-03T04:30:00.000Z'), '3 Nov, 10:00');
  assert.equal(t.formatIstRange('2026-11-03T04:30:00.000Z', '2026-11-03T06:30:00.000Z'), '3 Nov, 10:00–12:00');
  assert.equal(
    t.formatIstRange('2026-11-03T10:30:00.000Z', '2026-11-05T04:30:00.000Z'),
    '3 Nov, 16:00 – 5 Nov, 10:00',
  );
  // 21:19 UTC on 28 Oct is already 29 Oct in IST.
  assert.equal(t.istDateKey('2026-10-28T21:19:35.000Z'), '2026-10-29');
  assert.equal(t.formatIstShortDateTime('2026-10-28T21:19:35.000Z'), '29 Oct, 02:49');
  assert.ok(t.isSameIstDay('2026-10-28T19:00:00.000Z', '2026-10-29T18:00:00.000Z'));
  assert.ok(!t.isSameIstDay('2026-10-28T18:00:00.000Z', '2026-10-28T19:00:00.000Z'));
  // Epoch milliseconds and Dates work too; missing and invalid values give null.
  assert.equal(t.formatIstTime(Date.parse('2026-11-03T04:30:00.000Z')), '10:00');
  assert.equal(t.formatIstTime(new Date('2026-11-03T04:30:00.000Z')), '10:00');
  for (const bad of [null, undefined, '', 'not a date']) {
    assert.equal(t.formatIstTime(bad), null);
    assert.equal(t.formatIstDate(bad), null);
    assert.equal(t.formatIstRange(bad, '2026-11-03T06:30:00.000Z'), null);
    assert.equal(t.formatIstDateTime(bad), null);
  }
});

test('formatIstDateTime keeps the full timestamp format the verification pages use', async () => {
  const t = await load('/src/lib/time.js');
  const shown = t.formatIstDateTime('2026-10-28T21:19:35.000Z');
  assert.match(shown, /29 Oct 2026, 02:49 am IST/i);
  // Still importable from its old home for the existing importers.
  const verification = await load('/src/features/verification/api.js');
  assert.equal(verification.formatIstDateTime, t.formatIstDateTime);
});

test('datetime-local values are IST wall time, whatever zone the browser is in', async () => {
  const t = await load('/src/lib/time.js');
  assert.equal(t.toIstInputValue('2026-11-03T04:30:00.000Z'), '2026-11-03T10:00');
  assert.equal(t.toIstInputValue('2026-10-28T21:19:35.000Z'), '2026-10-29T02:49');
  assert.equal(t.toIstInputValue(null), '');
  assert.equal(t.fromIstInputValue('2026-11-03T10:00'), '2026-11-03T04:30:00.000Z');
  assert.equal(t.fromIstInputValue('2026-11-03T00:15'), '2026-11-02T18:45:00.000Z');
  assert.equal(t.fromIstInputValue('2026-11-03T10:00:30'), '2026-11-03T04:30:30.000Z');
  // Round trip.
  assert.equal(t.fromIstInputValue(t.toIstInputValue('2026-12-31T20:00:00.000Z')), '2026-12-31T20:00:00.000Z');
  // Not a real date or time: refused, never rolled over to another day.
  for (const bad of ['2026-02-30T10:00', '2026-11-03T24:00', '2026-13-01T10:00', '', 'tomorrow', null]) {
    assert.equal(t.fromIstInputValue(bad), null, String(bad));
  }
  assert.equal(t.toIstDateInputValue('2026-10-28T21:19:35.000Z'), '2026-10-29');
});

test('istDayBounds gives IST midnight to the next IST midnight, as [from, to)', async () => {
  const t = await load('/src/lib/time.js');
  assert.deepEqual(t.istDayBounds('2026-11-03'), {
    start: '2026-11-02T18:30:00.000Z',
    end: '2026-11-03T18:30:00.000Z',
  });
  // Any instant on the day: 21:19 UTC on 28 Oct is 29 Oct in IST.
  assert.deepEqual(t.istDayBounds('2026-10-28T21:19:35.000Z'), {
    start: '2026-10-28T18:30:00.000Z',
    end: '2026-10-29T18:30:00.000Z',
  });
  assert.equal(t.istDayBounds('nope'), null);
});

test('relative times and durations read like "in 2 h" and "1 h 30 min"', async () => {
  const t = await load('/src/lib/time.js');
  const now = Date.parse('2026-11-03T04:30:00.000Z');
  const at = (minutes) => new Date(now + minutes * 60 * 1000).toISOString();
  assert.equal(t.formatRelative(at(120), now), 'in 2 h');
  assert.equal(t.formatRelative(at(90), now), 'in 1 h 30 min');
  assert.equal(t.formatRelative(at(320), now), 'in 5 h');
  assert.equal(t.formatRelative(at(15), now), 'in 15 min');
  assert.equal(t.formatRelative(at(-45), now), '45 min ago');
  assert.equal(t.formatRelative(at(0.3), now), 'now');
  assert.equal(t.formatRelative(at(3 * 1440), now), 'in 3 days');
  assert.equal(t.formatRelative(at(-1440), now), '1 day ago');
  assert.equal(t.formatRelative(at(20 * 1440), now), '23 Nov');
  assert.equal(t.formatRelative('bad', now), null);

  assert.equal(t.formatDuration(30), '30 min');
  assert.equal(t.formatDuration(120), '2 h');
  assert.equal(t.formatDuration(90), '1 h 30 min');
  assert.equal(t.formatDuration(1440), '1 day');
  assert.equal(t.formatDuration(2880), '2 days');
  assert.equal(t.formatDuration(null), null);
  assert.equal(t.minutesBetween('2026-11-03T04:30:00.000Z', '2026-11-03T06:30:00.000Z'), 120);
});

// ── lib/errors.js, lib/paging.js, lib/reason.js ───────────────────────────────

test('error helpers: field errors, messages, retry rules', async () => {
  const e = await load('/src/lib/errors.js');
  const invalid = {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: '2 fields are invalid.',
    details: [
      { path: 'items.1.note', message: 'Can be at most 200 characters.' },
      { path: 'photos.0', message: 'Must be a photo uploaded through /uploads/images.' },
      { path: 'photos.0', message: 'Second message.' },
    ],
    requestId: 'req-1',
  };
  assert.deepEqual(e.fieldErrorsFrom(invalid), {
    'items.1.note': 'Can be at most 200 characters.',
    'photos.0': 'Must be a photo uploaded through /uploads/images.',
  });
  assert.deepEqual(e.fieldErrorsFrom({ code: 'SLOT_TAKEN', details: { waitlistPosition: 1 } }), {});
  // The same function is still exported where the verification pages used to import it.
  assert.equal((await load('/src/features/verification/api.js')).fieldErrorsFrom, e.fieldErrorsFrom);

  const network = { status: 0, code: 'UNKNOWN', message: 'Network Error', details: [], requestId: null };
  assert.match(e.errorMessage(network), /couldn't reach the server/);
  assert.equal(e.errorToastText(network), e.errorMessage(network));
  const limited = { status: 429, code: 'RATE_LIMITED', message: 'Too many requests.', retryAfter: 30, requestId: 'req-2' };
  assert.equal(e.errorMessage(limited), 'Too many requests. Try again in 30 s.');
  assert.equal(e.errorToastText(limited), 'Too many requests. Try again in 30 s. (ref req-2)');

  assert.ok(e.isRetryable(network));
  assert.ok(e.isRetryable({ status: 503, code: 'SERVICE_UNAVAILABLE' }));
  assert.ok(!e.isRetryable({ status: 403, code: 'FORBIDDEN' }));
  assert.ok(!e.isRetryable(null));
  // Reads retry once on a 5xx, never on a 4xx.
  assert.equal(e.retryReads(0, { status: 500, code: 'INTERNAL' }), true);
  assert.equal(e.retryReads(1, { status: 500, code: 'INTERNAL' }), false);
  assert.equal(e.retryReads(0, { status: 404, code: 'NOT_FOUND' }), false);
});

test('paging helpers read ?page and meta defensively', async () => {
  const { readPage, pageCount } = await load('/src/lib/paging.js');
  assert.equal(readPage('3'), 3);
  assert.equal(readPage('0'), 1);
  assert.equal(readPage('2.5'), 1);
  assert.equal(readPage(null), 1);
  assert.equal(readPage('99999'), 10000);
  assert.equal(pageCount({ page: 1, limit: 20, total: 0 }), 1);
  assert.equal(pageCount({ page: 1, limit: 20, total: 41 }), 3);
  assert.equal(pageCount(undefined), 1);
});

test('readReason: required, trimmed, at most 500 characters (api.md)', async () => {
  const { readReason, REASON_MAX_LENGTH } = await load('/src/lib/reason.js');
  assert.equal(REASON_MAX_LENGTH, 500);
  assert.deepEqual(readReason('  Clashes with a lab session  '), { value: 'Clashes with a lab session', error: null });
  assert.match(readReason('   ').error, /Give a reason/);
  assert.deepEqual(readReason('   ', { required: false }), { value: '', error: null });
  assert.match(readReason('x'.repeat(501)).error, /at most 500/);
  assert.equal(readReason('x'.repeat(500)).error, null);
  assert.match(readReason('ok', { minLength: 10 }).error, /at least 10/);
  // frontend.md §7 / §9: a required reason is 10–500 characters, so "no" isn't one. An optional
  // note (approve) has no minimum.
  const { REASON_MIN_LENGTH } = await load('/src/lib/reason.js');
  assert.equal(REASON_MIN_LENGTH, 10);
  assert.match(readReason('no').error, /at least 10 characters/);
  assert.match(readReason('  too short ').error, /at least 10/, 'counted after trimming');
  assert.equal(readReason('Machine down').error, null);
  assert.deepEqual(readReason('OK', { required: false }), { value: 'OK', error: null });
});

// ── Booking status styles ─────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending: 'Awaiting review',
  approved: 'Approved',
  waitlisted: 'Waitlisted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
  checked_in: 'In use',
  checked_out: 'Returned, awaiting confirmation',
  completed: 'Completed',
  flagged: 'Issue reported',
  no_show: 'No-show',
};

test('every booking status has the frontend.md §10.2 label, an icon and a readable colour', async () => {
  const { BOOKING_STATUSES, bookingStatusView } = await load('/src/lib/bookingStatus.js');
  const { Badge } = await load('/src/components/ui/Badge.jsx');
  assert.deepEqual([...BOOKING_STATUSES].sort(), Object.keys(STATUS_LABELS).sort());
  const neutral = Badge({ variant: 'neutral', children: 'x' }).props.className;
  const seen = new Set();
  for (const status of BOOKING_STATUSES) {
    const view = bookingStatusView(status);
    assert.equal(view.label, STATUS_LABELS[status], status);
    assert.equal(typeof view.icon, 'object', `${status} has an icon`);
    const className = Badge({ variant: view.variant, children: 'x' }).props.className;
    assert.notEqual(className, neutral, `${status} uses a real Badge variant (${view.variant})`);
    const { bg, fg } = colours(className);
    assert.ok(contrast(bg, fg) >= 4.5, `${status}: ${fg} on ${bg} is ${contrast(bg, fg).toFixed(2)}:1`);
    seen.add(view.variant);
  }
  assert.ok(seen.size >= 10, 'statuses are told apart by colour as well as icon and label');
  // Overdue only applies to a checked-in booking; the waitlist place is part of the label.
  assert.equal(bookingStatusView('checked_in', { overdue: true }).label, 'Overdue');
  assert.equal(bookingStatusView('approved', { overdue: true }).label, 'Approved');
  assert.equal(bookingStatusView('waitlisted', { waitlistPosition: 2 }).label, 'Waitlisted (#2)');
  assert.equal(bookingStatusView('waitlisted', { waitlistPosition: null }).label, 'Waitlisted');
  assert.equal(bookingStatusView('mystery').label, 'mystery');
});

test('StatusBadge reads a Booking object: status, isOverdue / flags.overdue, waitlistPosition', async () => {
  const { StatusBadge } = await load('/src/components/ui/StatusBadge.jsx');
  const show = async (props) => text(await render((React) => React.createElement(StatusBadge, props)));
  assert.equal(await show({ booking: detailBooking() }), 'Approved');
  assert.equal(await show({ booking: detailBooking({ status: 'checked_in', isOverdue: true }) }), 'Overdue');
  // A list item (GET /bookings/manage) has flags.overdue instead of isOverdue.
  assert.equal(await show({ booking: storedBooking({ status: 'checked_in', flags: { overdue: true } }) }), 'Overdue');
  assert.equal(await show({ booking: storedBooking({ status: 'waitlisted', waitlistPosition: 3 }) }), 'Waitlisted (#3)');
  assert.equal(await show({ status: 'pending' }), 'Awaiting review');
  const html = await render((React) => React.createElement(StatusBadge, { status: 'no_show' }));
  assert.match(html, /<svg[^>]*aria-hidden="true"/); // the icon is decorative; the label says it
});

test('kit contrast: every Badge variant and the filled Buttons are at least 4.5:1', async () => {
  const { Badge } = await load('/src/components/ui/Badge.jsx');
  const { Button } = await load('/src/components/ui/Button.jsx');
  const variants = [
    'forest', 'red', 'amber', 'gold', 'blue', 'teal', 'violet', 'neutral', 'dark',
    'green', 'emerald', 'slate', 'slateLight', 'orange', 'rose', 'overdue',
  ];
  for (const variant of variants) {
    const { bg, fg } = colours(Badge({ variant, children: 'x' }).props.className);
    assert.ok(bg && fg, `${variant} sets both colours`);
    assert.ok(contrast(bg, fg) >= 4.5, `Badge ${variant}: ${contrast(bg, fg).toFixed(2)}:1`);
  }
  for (const variant of ['primary', 'danger', 'forest']) {
    const { bg, fg } = colours(Button({ variant, children: 'x' }).props.className);
    assert.ok(contrast(bg, fg) >= 4.5, `Button ${variant}: ${contrast(bg, fg).toFixed(2)}:1`);
  }
});

test('Input and Select ids come from useId: stable across renders, unique per control', async () => {
  const { Input } = await load('/src/components/ui/Input.jsx');
  const { Select } = await load('/src/components/ui/Select.jsx');
  const tree = (React) =>
    React.createElement(
      'div',
      null,
      React.createElement(Input, { label: 'Purpose', hint: 'At least 10 characters.' }),
      React.createElement(Input, { label: 'Notes' }),
      React.createElement(Select, { label: 'Overall', options: [{ value: 'good', label: 'Good' }] }),
    );
  const first = await render(tree);
  assert.equal(await render(tree), first, 'the same markup on every render (Math.random is gone)');
  const ids = [...first.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const fors = [...first.matchAll(/ for="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(fors.length, 3);
  for (const id of fors) assert.ok(ids.includes(id), `label for=${id} names a control`);
  assert.equal(new Set(fors).size, 3, 'each control has its own id');
  assert.match(first, /aria-describedby="input-[^"]+-hint"/);
  // An explicit id still wins.
  assert.match(await render((React) => React.createElement(Input, { id: 'purpose', label: 'Purpose' })), /id="purpose"/);
});

test('CardTitle renders the heading level it is given', async () => {
  const { CardTitle } = await load('/src/components/ui/Card.jsx');
  assert.match(await render((React) => React.createElement(CardTitle, null, 'Default')), /^<h3/);
  assert.match(await render((React) => React.createElement(CardTitle, { as: 'h2' }, 'Section')), /^<h2[^>]*>Section<\/h2>$/);
});

// ── ErrorState, Pagination, ReasonForm ────────────────────────────────────────

test('ErrorState shows the message, the request id and a retry', async () => {
  const { ErrorState } = await load('/src/components/ui/ErrorState.jsx');
  const error = { status: 409, code: 'INVALID_TRANSITION', message: "Can't cancel a booking that is completed.", requestId: 'req-409' };
  const html = await render((React) =>
    React.createElement(ErrorState, { error, title: "Couldn't cancel", onRetry: () => {} }),
  );
  assert.match(html, /role="alert"/);
  const shown = text(html);
  assert.match(shown, /Couldn't cancel/);
  assert.match(shown, /Can't cancel a booking that is completed\./);
  assert.match(shown, /ref: req-409/);
  assert.match(shown, /Try again/);
  // A 44 px target (frontend.md §10.3): it is the recovery action on the check-in screens too.
  assert.match(html, /<button[^>]*class="[^"]*min-h-\[44px\][^"]*"[^>]*>.*Try again<\/button>/s);
  assert.doesNotMatch(html, /min-h-\[40px\]/);
  assert.equal(await render((React) => React.createElement(ErrorState, { error: null })), '');
  // The old admin name still works for the page that imports it.
  const { RequestError } = await load('/src/features/admin/components/RequestError.jsx');
  assert.equal(RequestError, ErrorState);
});

test('Pagination keeps both buttons focusable and only moves to real pages', async () => {
  const { Pagination } = await load('/src/components/ui/Pagination.jsx');
  const pages = [];
  const props = { page: 1, pageCount: 3, onPageChange: (p) => pages.push(p) };
  const html = await render((React) => React.createElement(Pagination, props));
  assert.match(html, /<nav aria-label="Pages"/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /<button[^>]*aria-disabled="true"[^>]*>.*?Previous/);
  assert.match(text(html), /Page 1 of 3/);

  const busy = await render((React) => React.createElement(Pagination, { ...props, page: 2, busy: true }));
  assert.equal((busy.match(/aria-disabled="true"/g) ?? []).length, 2);
  assert.doesNotMatch(busy, /disabled=""/);

  // Pagination has no hooks, so its element tree can be inspected directly.
  const [previous, , next] = Pagination(props).props.children;
  previous.props.onClick();
  next.props.onClick();
  const [, , busyNext] = Pagination({ ...props, busy: true }).props.children;
  busyNext.props.onClick();
  assert.deepEqual(pages, [2]);
  assert.equal(await render((React) => React.createElement(Pagination, { ...props, pageCount: 1 })), '');
});

test('ReasonForm: a labelled, required field with a counter, quick picks and server errors', async () => {
  const { ReasonForm } = await load('/src/components/ui/ReasonDialog.jsx');
  const base = {
    label: 'Reason for rejecting',
    templates: ['Clashes with a lab session', 'Missing safety training'],
    submitLabel: 'Reject request',
    onSubmit: () => {},
    onCancel: () => {},
  };
  const html = await render((React) => React.createElement(ReasonForm, base));
  const fieldId = html.match(/<textarea[^>]*id="([^"]+)"/)[1];
  assert.match(html, new RegExp(`<label for="${fieldId.replace(/[^\w-]/g, '\\$&')}"[^>]*>Reason for rejecting</label>`));
  assert.match(html, /<textarea[^>]*maxLength="500"[^>]*required=""/);
  assert.match(html, /aria-required="true"/);
  assert.match(html, /data-autofocus/);
  assert.match(html, /role="group" aria-label="Common reasons"/);
  const shown = text(html);
  assert.match(shown, /0\/500/);
  assert.match(shown, /Required, 10–500 characters/);
  assert.match(shown, /Clashes with a lab session/);
  assert.match(shown, /Reject request/);

  // A VALIDATION_ERROR on `reason` sits beside the field; nothing else is shown for it.
  const invalid = {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'A reason is required.',
    details: [{ path: 'reason', message: 'Required' }],
    requestId: 'req-400',
  };
  const withField = await render((React) => React.createElement(ReasonForm, { ...base, error: invalid }));
  assert.match(withField, /aria-invalid="true"/);
  assert.match(withField, /role="alert"[^>]*>.*Required/);
  assert.doesNotMatch(text(withField), /ref: req-400/);

  // Anything else (409: decided meanwhile) is an ErrorState with the request id.
  const stale = {
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'This booking was changed by someone else just now. Refresh and try again.',
    details: [],
    requestId: 'req-409',
  };
  const withStale = text(
    await render((React) =>
      React.createElement(ReasonForm, { ...base, error: stale, errorTitle: "The rejection wasn't saved" }),
    ),
  );
  assert.match(withStale, /The rejection wasn't saved/);
  assert.match(withStale, /changed by someone else/);
  assert.match(withStale, /ref: req-409/);

  // Optional (a borrower's cancel) and busy.
  const optional = await render((React) =>
    React.createElement(ReasonForm, { ...base, label: 'Reason', required: false, pending: true, pendingLabel: 'Cancelling…' }),
  );
  assert.match(text(optional), /Reason \(optional\)/);
  assert.match(text(optional), /Optional, at most 500 characters/);
  assert.doesNotMatch(optional, /required=""/);
  assert.match(optional, /aria-busy="true"[^>]*>.*Cancelling…/);
});

// ── features/bookings/api.js: requests ────────────────────────────────────────

test('checkBooking and createBooking post instants and only send joinWaitlist when true', async () => {
  const api = await load('/src/features/bookings/api.js');
  const evaluation = { eligible: true, outcome: 'pending', results: [], waitlistPosition: null };
  const calls = fakeApi({
    'POST /bookings/check': () => ({ status: 200, data: evaluation }),
    'POST /bookings': () => ({
      status: 201,
      data: { booking: storedBooking({ status: 'pending' }), evaluation, waitlistPosition: null },
    }),
  });

  const checked = await api.checkBooking({
    resourceId: 'r1',
    start: new Date('2026-11-03T04:30:00.000Z'),
    end: '2026-11-03T06:30:00.000Z',
  });
  assert.deepEqual(checked, { data: evaluation, meta: undefined });
  assert.deepEqual(calls[0].body, {
    resourceId: 'r1',
    start: '2026-11-03T04:30:00.000Z',
    end: '2026-11-03T06:30:00.000Z',
  });

  const created = await api.createBooking({
    resourceId: 'r1',
    start: '2026-11-03T04:30:00.000Z',
    end: '2026-11-03T06:30:00.000Z',
    purpose: '  Printing the chassis for the robotics club ',
  });
  assert.equal(created.data.booking.status, 'pending');
  assert.equal(calls[1].body.purpose, 'Printing the chassis for the robotics club');
  assert.ok(!('joinWaitlist' in calls[1].body), 'never "false": the server truthy-checks it');

  await api.createBooking({ resourceId: 'r1', start: 'a', end: 'b', purpose: 'p', joinWaitlist: true });
  assert.equal(calls[2].body.joinWaitlist, true);
  await api.createBooking({ resourceId: 'r1', start: 'a', end: 'b', purpose: 'p', joinWaitlist: 'false' });
  assert.ok(!('joinWaitlist' in calls[3].body));
});

test('a refused booking rejects with the code, details and request id (SLOT_TAKEN, INELIGIBLE)', async () => {
  const api = await load('/src/features/bookings/api.js');
  fakeApi({
    'POST /bookings': () => ({
      status: 409,
      code: 'SLOT_TAKEN',
      message: 'This slot is held by an earlier request. You can join the waitlist as #1.',
      details: { waitlistPosition: 1 },
    }),
  });
  const taken = await rejection(api.createBooking({ resourceId: 'r1', start: 'a', end: 'b', purpose: 'p' }));
  assert.equal(taken.status, 409);
  assert.equal(taken.code, 'SLOT_TAKEN');
  assert.deepEqual(taken.details, { waitlistPosition: 1 });
  assert.equal(taken.requestId, 'req-err');

  const failed = [{ rule: 'BADGES', passed: false, message: 'Missing badge: 3D Printing Basics', fixHint: 'Request it' }];
  fakeApi({ 'POST /bookings': () => ({ status: 422, code: 'INELIGIBLE', message: 'Not eligible.', details: failed }) });
  const ineligible = await rejection(api.createBooking({ resourceId: 'r1', start: 'a', end: 'b', purpose: 'p' }));
  assert.equal(ineligible.code, 'INELIGIBLE');
  assert.deepEqual(ineligible.details, failed);
});

test('the lists send status, paging and bounds, and keep meta', async () => {
  const api = await load('/src/features/bookings/api.js');
  const mine = [{ ...storedBooking({ status: 'waitlisted' }), resource: { _id: 'r1', title: 'FDM 3D Printer #2', slug: 'fdm', location: 'DIC' }, waitlistPosition: 1 }];
  const groups = [
    {
      resource: { _id: 'r1', title: 'FDM 3D Printer #2', slug: 'fdm', quantity: 1 },
      start: '2026-11-03T04:30:00.000Z',
      end: '2026-11-03T06:30:00.000Z',
      bookings: [storedBooking({ status: 'pending' }), storedBooking({ _id: 'b2', status: 'waitlisted', waitlistPosition: 1 })],
    },
  ];
  const calls = fakeApi({
    'GET /bookings/mine': () => ({ status: 200, data: mine, meta: { page: 2, limit: 20, total: 21 } }),
    'GET /bookings/manage': () => ({ status: 200, data: groups, meta: { page: 1, limit: 20, total: 1 } }),
  });

  const res = await api.listMyBookings({ status: ['pending', 'waitlisted'], page: 2 });
  assert.deepEqual(calls[0].params, { status: 'pending,waitlisted', page: 2, limit: 20 });
  assert.deepEqual(res, { data: mine, meta: { page: 2, limit: 20, total: 21 } });

  await api.listMyBookings();
  assert.deepEqual(calls[1].params, { page: 1, limit: 20 }, 'no status means every status');

  const queue = await api.listManageBookings({
    status: 'pending',
    from: new Date('2026-11-02T18:30:00.000Z'),
    to: '2026-11-03T18:30:00.000Z',
    resourceId: undefined,
  });
  assert.deepEqual(calls[2].params, {
    status: 'pending',
    from: '2026-11-02T18:30:00.000Z',
    to: '2026-11-03T18:30:00.000Z',
    page: 1,
    limit: 20,
  });
  assert.equal(queue.data[0].bookings[1].waitlistPosition, 1);
  assert.equal(queue.meta.total, 1);
});

test('detail and timeline URL-encode the id and unwrap data', async () => {
  const api = await load('/src/features/bookings/api.js');
  const calls = fakeApi({
    'GET /bookings/b%2F1': () => ({ status: 200, data: detailBooking() }),
    'GET /bookings/b%2F1/timeline': () => ({ status: 200, data: TIMELINE }),
  });
  const detail = await api.getBooking('b/1');
  assert.deepEqual(detail.data.allowedActions, ['cancel', 'checkIn']);
  const timeline = await api.getBookingTimeline('b/1');
  assert.equal(timeline.data.length, TIMELINE.length);
  assert.deepEqual(calls.map((c) => c.key), ['GET /bookings/b%2F1', 'GET /bookings/b%2F1/timeline']);

  fakeApi({ 'GET /bookings/b1': () => ({ status: 403, code: 'FORBIDDEN', message: "You can't view this booking." }) });
  const err = await rejection(api.getBooking('b1'));
  assert.equal(err.message, "You can't view this booking.");
});

test('decisions send note or reason, trimmed; blank optional text is left out', async () => {
  const api = await load('/src/features/bookings/api.js');
  const calls = fakeApi({
    'POST /bookings/b1/approve': () => ({ status: 200, data: storedBooking() }),
    'POST /bookings/b1/reject': () => ({ status: 200, data: storedBooking({ status: 'rejected' }) }),
    'POST /bookings/b1/waitlist': () => ({ status: 200, data: storedBooking({ status: 'waitlisted' }) }),
    'POST /bookings/b1/cancel': () => ({ status: 200, data: storedBooking({ status: 'cancelled' }) }),
  });
  await api.approveBooking('b1', { note: '  ' });
  await api.approveBooking('b1', { note: ' Enjoy the print ' });
  await api.rejectBooking('b1', { reason: ' Clashes with a lab session ' });
  await api.waitlistBooking('b1', { reason: 'Slot held by an earlier request' });
  await api.cancelBooking('b1');
  const cancelled = await api.cancelBooking('b1', { reason: 'Plans changed' });
  assert.deepEqual(
    calls.map((c) => [c.key, c.body]),
    [
      ['POST /bookings/b1/approve', {}],
      ['POST /bookings/b1/approve', { note: 'Enjoy the print' }],
      ['POST /bookings/b1/reject', { reason: 'Clashes with a lab session' }],
      ['POST /bookings/b1/waitlist', { reason: 'Slot held by an earlier request' }],
      ['POST /bookings/b1/cancel', {}],
      ['POST /bookings/b1/cancel', { reason: 'Plans changed' }],
    ],
  );
  assert.equal(cancelled.data.status, 'cancelled');
});

test('check-in and check-out send the report: every item, trimmed notes, bare photo refs', async () => {
  const api = await load('/src/features/bookings/api.js');
  const calls = fakeApi({
    'POST /bookings/b1/check-in': () => ({ status: 200, data: storedBooking({ status: 'checked_in' }) }),
    'POST /bookings/b1/check-out': () => ({ status: 200, data: storedBooking({ status: 'checked_out' }) }),
  });
  const report = {
    items: [
      { label: 'Bed clean', ok: true, note: '  ' },
      { label: 'Nozzle intact', ok: false, note: ' Slight scratch ' },
    ],
    overall: 'minor_issue',
    notes: '  Bed slightly scratched ',
    // A photo as PhotoUploader keeps it, with nothing else riding along.
    photos: [{ ...PHOTO_A, preview: 'blob:x' }],
  };
  const res = await api.checkInBooking('b1', report);
  assert.equal(res.data.status, 'checked_in');
  assert.deepEqual(calls[0].body, {
    items: [
      { label: 'Bed clean', ok: true },
      { label: 'Nozzle intact', ok: false, note: 'Slight scratch' },
    ],
    overall: 'minor_issue',
    notes: 'Bed slightly scratched',
    photos: [PHOTO_A],
  });
  await api.checkOutBooking('b1', { items: [{ label: 'Bed clean', ok: true }], overall: 'good', photos: [] });
  assert.deepEqual(calls[1].body, { items: [{ label: 'Bed clean', ok: true }], overall: 'good' });
  assert.equal(calls[1].key, 'POST /bookings/b1/check-out');

  fakeApi({
    'POST /bookings/b1/check-in': () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'Check-in opens 15 minutes before the start time (3 Nov, 09:45).',
    }),
  });
  const early = await rejection(api.checkInBooking('b1', report));
  assert.match(early.message, /Check-in opens/);
});

test('confirm-return sends an incident only for an issue, and unwraps { booking, incident }', async () => {
  const api = await load('/src/features/bookings/api.js');
  const incident = {
    _id: 'inc-1', booking: 'b1', resource: 'r1', orgUnit: 'u-dic', reportedBy: 'mgr-1', source: 'manager',
    type: 'damage', severity: 'low', description: 'The bed has a deep scratch near the corner.',
    photos: [], status: 'open', comments: [], createdAt: '2026-11-03T07:00:00.000Z',
    updatedAt: '2026-11-03T07:00:00.000Z', __v: 0,
  };
  const calls = fakeApi({
    'POST /bookings/b1/confirm-return': (config) => {
      const body = JSON.parse(config.data);
      return body.outcome === 'issue'
        ? { status: 200, data: { booking: storedBooking({ status: 'flagged' }), incident } }
        : { status: 200, data: { booking: storedBooking({ status: 'completed' }), incident: null } };
    },
  });
  const ok = await api.confirmBookingReturn('b1', {
    outcome: 'ok',
    items: [],
    note: '  ',
    incident: { type: 'damage', severity: 'low', description: 'ignored for ok' },
  });
  assert.deepEqual(calls[0].body, { outcome: 'ok' });
  assert.equal(ok.data.booking.status, 'completed');
  assert.equal(ok.data.incident, null);

  const issue = await api.confirmBookingReturn('b1', {
    outcome: 'issue',
    items: [{ label: 'Bed clean', ok: false, note: 'Scratched' }],
    photos: [PHOTO_B],
    note: 'Seen at the desk',
    incident: { type: 'damage', severity: 'low', description: '  The bed has a deep scratch near the corner. ' },
  });
  assert.deepEqual(calls[1].body, {
    outcome: 'issue',
    items: [{ label: 'Bed clean', ok: false, note: 'Scratched' }],
    photos: [PHOTO_B],
    note: 'Seen at the desk',
    incident: { type: 'damage', severity: 'low', description: 'The bed has a deep scratch near the corner.' },
  });
  assert.equal(issue.data.booking.status, 'flagged');
  assert.equal(issue.data.incident._id, 'inc-1');
});

test('booking helpers: allowedActions, borrower, check-in opening, latest report', async () => {
  const api = await load('/src/features/bookings/api.js');
  const booking = detailBooking();
  assert.ok(api.canDo(booking, 'checkIn'));
  assert.ok(!api.canDo(booking, 'approve'));
  assert.ok(!api.canDo(storedBooking(), 'cancel'), 'a stored booking has no allowedActions');
  assert.ok(api.isBorrower(booking, { _id: 'user-aarav' }));
  assert.ok(api.isBorrower(storedBooking(), { _id: 'user-aarav' }), 'a bare borrower id works too');
  assert.ok(!api.isBorrower(booking, { _id: 'mgr-1' }));
  assert.equal(api.checkInOpensAt(booking), '2026-11-03T04:15:00.000Z');
  assert.equal(api.latestReport(TIMELINE, 'check_in').overall, 'minor_issue');
  assert.equal(api.latestReport(TIMELINE, 'check_out'), null);
  assert.equal(api.idOf({ _id: 'r1', title: 'x' }), 'r1');
  assert.equal(api.idOf('r1'), 'r1');
  assert.equal(api.idOf(null), null);
  // The tabs cover every status exactly once.
  const tabbed = api.MINE_TABS.flatMap((tab) => tab.statuses).sort();
  assert.deepEqual(tabbed, [...api.BOOKING_STATUSES].sort());
});

// ── features/bookings/api.js: keys and hooks ──────────────────────────────────

test('query keys follow frontend.md §8.2 and sit under the prefixes mutations invalidate', async () => {
  const { bookingKeys, keysToInvalidate, resourceBookingKeys } = await load('/src/features/bookings/api.js');
  assert.deepEqual(bookingKeys.detail('b1'), ['booking', 'b1']);
  assert.deepEqual(bookingKeys.timeline('b1'), ['booking', 'b1', 'timeline']);
  assert.deepEqual(bookingKeys.timeline('b1').slice(0, 2), bookingKeys.detail('b1'));
  assert.deepEqual(bookingKeys.mineList({ status: ['approved', 'checked_in'] }), [
    'bookings', 'mine', { status: 'approved,checked_in', page: 1, limit: 20 },
  ]);
  // Equal filters, written differently, share one cache entry.
  assert.deepEqual(bookingKeys.mineList({ status: 'approved,checked_in' }), bookingKeys.mineList({ status: ['approved', 'checked_in'], page: 1 }));
  assert.deepEqual(bookingKeys.mineList({}).slice(0, 2), bookingKeys.mine);
  assert.deepEqual(bookingKeys.manageList({ status: 'pending', resourceId: '' }), [
    'bookings', 'manage', { status: 'pending', page: 1, limit: 20 },
  ]);
  assert.deepEqual(bookingKeys.manageList({}).slice(0, 2), bookingKeys.manage);
  assert.deepEqual(bookingKeys.mine.slice(0, 1), bookingKeys.all);
  assert.deepEqual(resourceBookingKeys.availability('r1'), ['resource', 'r1', 'availability']);

  assert.deepEqual(keysToInvalidate({ id: 'b1', resourceId: 'r1' }), [
    ['bookings'],
    ['booking', 'b1'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
  ]);
  assert.deepEqual(keysToInvalidate({ id: 'b1', incident: true }), [['bookings'], ['booking', 'b1'], ['incidents']]);
});

// Renders `useHook` once and hands back its result, with a QueryClient that records invalidations.
// The mutation then runs outside render (mutateAsync works without a mounted observer).
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
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { onResult: (value) => results.push(value) }),
    ),
  );
  return { result: results[results.length - 1], invalidated, client };
}

test('lifecycle mutations wait for the server, then invalidate the booking, lists and resource', async () => {
  const api = await load('/src/features/bookings/api.js');
  fakeApi({ 'POST /bookings/b1/cancel': () => ({ status: 200, data: storedBooking({ status: 'cancelled' }) }) });
  const { result, invalidated, client } = await withHook(api.useCancelBooking, {
    cache: [[api.bookingKeys.detail('b1'), { data: detailBooking() }]],
  });
  const res = await result.mutateAsync({ id: 'b1', reason: 'Plans changed' });
  assert.equal(res.data.status, 'cancelled');
  // The resource id comes from the answer (a bare id on a stored booking).
  assert.deepEqual(invalidated, [
    ['bookings'],
    ['booking', 'b1'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
  ]);
  // No optimistic update: the cached booking was never set to "cancelled" by the client.
  assert.equal(client.getQueryData(api.bookingKeys.detail('b1')).data.status, 'approved');
  client.clear();
});

test('a stale decision (409) refreshes the booking; other failures change nothing', async () => {
  const api = await load('/src/features/bookings/api.js');
  fakeApi({
    'POST /bookings/b1/approve': () => ({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'This booking was changed by someone else just now. Refresh and try again.',
    }),
    'POST /bookings/b2/approve': () => ({ status: 400, code: 'VALIDATION_ERROR', message: 'Bad note.', details: [{ path: 'note', message: 'Can be at most 500 characters.' }] }),
  });
  const stale = await withHook(api.useApproveBooking);
  const err = await rejection(stale.result.mutateAsync({ id: 'b1', resourceId: 'r1' }));
  assert.equal(err.code, 'INVALID_TRANSITION');
  assert.deepEqual(stale.invalidated, [
    ['bookings'],
    ['booking', 'b1'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
  ]);
  stale.client.clear();

  const invalid = await withHook(api.useApproveBooking);
  await rejection(invalid.result.mutateAsync({ id: 'b2', note: 'x'.repeat(501) }));
  assert.deepEqual(invalid.invalidated, []);
  invalid.client.clear();
});

test('confirm-return with an issue also refreshes the incident lists', async () => {
  const api = await load('/src/features/bookings/api.js');
  fakeApi({
    'POST /bookings/b1/confirm-return': () => ({
      status: 200,
      data: { booking: storedBooking({ status: 'flagged' }), incident: { _id: 'inc-1', booking: 'b1' } },
    }),
  });
  const { result, invalidated, client } = await withHook(api.useConfirmReturn);
  await result.mutateAsync({
    id: 'b1',
    outcome: 'issue',
    incident: { type: 'damage', severity: 'low', description: 'A deep scratch on the print bed.' },
  });
  assert.deepEqual(invalidated, [
    ['bookings'],
    ['booking', 'b1'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
    ['incidents'],
  ]);
  client.clear();
});

test('creating a booking refreshes my bookings and the resource availability and eligibility', async () => {
  const api = await load('/src/features/bookings/api.js');
  fakeApi({
    'POST /bookings': () => ({
      status: 201,
      data: { booking: storedBooking({ _id: 'b9', status: 'pending' }), evaluation: { eligible: true, outcome: 'pending', results: [] }, waitlistPosition: null },
    }),
  });
  const { result, invalidated, client } = await withHook(api.useCreateBooking);
  await result.mutateAsync({ resourceId: 'r1', start: '2026-11-03T04:30:00.000Z', end: '2026-11-03T06:30:00.000Z', purpose: 'Printing the chassis' });
  assert.deepEqual(invalidated, [
    ['bookings'],
    ['booking', 'b9'],
    ['resource', 'r1', 'availability'],
    ['resource', 'r1', 'eligibility'],
  ]);
  client.clear();
});

// ── features/uploads/api.js ───────────────────────────────────────────────────

const jpeg = (name = 'photo.jpg', size = 2048, type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type });

test('uploadImages posts every file under "images" and resolves with [{ url, publicId }]', async () => {
  const { uploadImages } = await load('/src/features/uploads/api.js');
  const calls = fakeApi({ 'POST /uploads/images': () => ({ status: 201, data: [PHOTO_A, PHOTO_B] }) });
  const res = await uploadImages([jpeg('a.jpg'), jpeg('b.png', 10, 'image/png')]);
  assert.deepEqual(res, { data: [PHOTO_A, PHOTO_B], meta: undefined });
  const sent = calls[0].config.data;
  assert.ok(sent instanceof FormData);
  assert.deepEqual(sent.getAll('images').map((f) => f.name), ['a.jpg', 'b.png']);
  assert.deepEqual([...sent.keys()], ['images', 'images']);
  assert.notEqual(String(calls[0].config.headers['Content-Type'] ?? ''), 'multipart/form-data');
});

test('upload failures reject with the server message: 403 unverified, 503 not configured', async () => {
  const { uploadImages } = await load('/src/features/uploads/api.js');
  for (const answer of [
    { status: 403, code: 'FORBIDDEN', message: 'Your ID card must be verified before you can upload photos.' },
    { status: 503, code: 'SERVICE_UNAVAILABLE', message: "Uploads aren't configured." },
    { status: 400, code: 'VALIDATION_ERROR', message: '1 field is invalid.', details: [{ path: 'images.1', message: 'Must be a JPG, PNG or WebP file.' }] },
  ]) {
    fakeApi({ 'POST /uploads/images': () => answer });
    const err = await rejection(uploadImages([jpeg()]));
    assert.equal(err.status, answer.status);
    assert.equal(err.message, answer.message);
    assert.equal(err.requestId, 'req-err');
  }
});

test('preparePhoto compresses, converts what the server refuses, and checks the 5 MB limit', async () => {
  const { preparePhoto, photoCompressionOptions, UPLOAD_MAX_BYTES } = await load('/src/features/uploads/api.js');
  const shrink = async (file) => new Blob([new Uint8Array(100)], { type: file.type });
  const big = jpeg('IMG_0042.jpg', 7 * 1024 * 1024);
  const small = await preparePhoto(big, shrink);
  assert.equal(small.file.size, 100);
  assert.equal(small.file.name, 'IMG_0042.jpg');
  assert.equal(small.file.type, 'image/jpeg');

  // Compression that doesn't help keeps the original.
  const tiny = jpeg('tiny.jpg', 50);
  assert.equal((await preparePhoto(tiny, shrink)).file, tiny);

  // An iPhone HEIC is re-encoded as JPEG and renamed.
  const heic = new File([new Uint8Array(4000)], 'IMG_0043.HEIC', { type: 'image/heic' });
  assert.equal(photoCompressionOptions(heic).fileType, 'image/jpeg');
  assert.equal(photoCompressionOptions(big).fileType, undefined);
  const toJpeg = async () => new Blob([new Uint8Array(900)], { type: 'image/jpeg' });
  const converted = await preparePhoto(heic, toJpeg);
  assert.equal(converted.file.name, 'IMG_0043.jpg');
  assert.equal(converted.file.type, 'image/jpeg');
  // A HEIC the browser can't decode can't be sent.
  const broken = async () => {
    throw new Error('Could not decode');
  };
  assert.match((await preparePhoto(heic, broken)).error, /JPG, PNG or WebP/);
  // A JPEG that can't be compressed goes as it is, within the limit.
  assert.equal((await preparePhoto(tiny, broken)).file, tiny);
  assert.match((await preparePhoto(jpeg('huge.jpg', UPLOAD_MAX_BYTES + 1), broken)).error, /5 MB/);
  assert.match((await preparePhoto(new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }), shrink)).error, /isn't a photo/);
});

test('photo compression runs our own copy of the library, never a script from a CDN', async () => {
  // browser-image-compression's worker importScripts() jsDelivr unless given libURL, and a blob:
  // worker runs with our origin (it could call /auth/refresh with the refresh cookie).
  const { photoCompressionOptions, compressionWorkerOptions } = await load('/src/features/uploads/api.js');
  const had = 'document' in globalThis;
  const previous = globalThis.document;
  globalThis.document = { baseURI: 'https://campuscommons.example/bookings/b1/check-in' };
  try {
    for (const options of [photoCompressionOptions(jpeg()), photoCompressionOptions({ type: 'image/heic' }), compressionWorkerOptions()]) {
      assert.equal(options.useWebWorker, true);
      const url = new URL(options.libURL);
      assert.equal(url.origin, 'https://campuscommons.example', 'same origin, absolute (a blob: worker has no base)');
      assert.match(url.pathname, /browser-image-compression.*\.js$/);
    }
  } finally {
    if (had) globalThis.document = previous;
    else delete globalThis.document;
  }
  // Without a page to resolve against, compress on the main thread rather than fall back to the CDN.
  const bare = photoCompressionOptions(jpeg());
  assert.equal(bare.useWebWorker, false);
  assert.equal(bare.libURL, undefined);
  assert.equal(bare.maxSizeMB, 1);
  assert.equal(bare.maxWidthOrHeight, 1600);
});

test('preparePhotos keeps at most the room left and says what was left out', async () => {
  const { preparePhotos, toPhotoRefs } = await load('/src/features/uploads/api.js');
  const same = async (file) => file;
  const picked = [jpeg('1.jpg'), new File(['x'], 'notes.txt', { type: 'text/plain' }), jpeg('2.jpg'), jpeg('3.jpg')];
  const { files, notes } = await preparePhotos(picked, { room: 2, compress: same });
  assert.deepEqual(files.map((f) => f.name), ['1.jpg', '2.jpg']);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /notes\.txt isn't a photo/);
  assert.match(notes[1], /Only 2 more photos fit, so 1 was left out/);
  const none = await preparePhotos([jpeg()], { room: 0, compress: same });
  assert.deepEqual(none.files, []);
  assert.match(none.notes[0], /no room/);
  assert.deepEqual(toPhotoRefs([{ ...PHOTO_A, extra: 1 }, { url: 'x' }, null]), [PHOTO_A]);
});

test('preparePhotos never hands one upload more than POST /uploads/images takes (3), even with room for 5', async () => {
  // The listing form allows 5 photos; the server refuses a request with more than 3 files.
  const { preparePhotos, MAX_PHOTOS } = await load('/src/features/uploads/api.js');
  const same = async (file) => file;
  const five = ['1', '2', '3', '4', '5'].map((n) => jpeg(`${n}.jpg`));
  const { files, notes } = await preparePhotos(five, { room: 5, compress: same });
  assert.equal(MAX_PHOTOS, 3);
  assert.deepEqual(files.map((f) => f.name), ['1.jpg', '2.jpg', '3.jpg']);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /At most 3 photos go up at a time, so 2 were left out\. Add them once these are in\./);
  const four = await preparePhotos(five.slice(0, 4), { room: 4, compress: same });
  assert.equal(four.files.length, 3);
  assert.match(four.notes[0], /so 1 was left out\. Add it once these are in\./);
  // Room is still the tighter limit when it is smaller.
  const two = await preparePhotos(five, { room: 2, compress: same });
  assert.equal(two.files.length, 2);
  assert.match(two.notes[0], /Only 2 more photos fit, so 3 were left out/);
});

// ── BookingTimeline ───────────────────────────────────────────────────────────

test('BookingTimeline shows each kind with its actor, IST time and reason', async () => {
  const { BookingTimeline } = await load('/src/components/BookingTimeline.jsx');
  const html = await render((React) =>
    React.createElement(BookingTimeline, { items: TIMELINE, subject: 'FDM 3D Printer #2' }),
  );
  const shown = text(html);
  assert.doesNotMatch(shown, /\[object Object\]|undefined|NaN/);
  assert.match(html, /<ol aria-label="Booking history"/);
  assert.equal((html.match(/<li class="relative pl-8/g) ?? []).length, TIMELINE.length);

  // Events: the server's sentence, the IST time, the actor; the reason once, on its own line.
  assert.match(shown, /Aarav Student requested this booking 29 Oct, 02:49 IST · by Aarav Student \(member\)/);
  assert.match(html, /<time dateTime="2026-10-28T21:19:35.000Z">29 Oct, 02:49 IST<\/time>/);
  assert.match(shown, /Manager \(DIC\) moved this request to the waitlist 29 Oct, 11:30 IST · by Priya Manager \(manager\)/);
  assert.equal(shown.split('Printer reserved for the M.Des jury').length - 1, 1, 'the reason is shown once');
  assert.match(shown, /Reason: “Printer reserved for the M\.Des jury”/);
  assert.match(shown, /by System \(automatic\)/);

  // The condition report: overall, checklist with the flagged item, notes and photos.
  assert.match(shown, /Check-in report: minor issue, 1 item flagged, 2 photos 3 Nov, 09:55 IST · by Aarav Student/);
  assert.match(shown, /Minor issue/);
  assert.match(html, /<details class="mt-2 group" open="">/);
  assert.match(shown, /Checklist: 2 items, 1 flagged/);
  assert.match(shown, /Not OK: Nozzle intact — Slight scratch on the bed/);
  assert.match(shown, /Notes: “Bed slightly scratched”/);
  assert.match(html, /alt="Check-in photo 1 of 2, FDM 3D Printer #2"/);
  assert.match(html, /alt="Check-in photo 2 of 2, FDM 3D Printer #2"/);
  assert.ok(html.includes(`href="${PHOTO_A.url}"`));

  // Incidents: opened with its severity, resolved with the outcome, both linked.
  assert.match(shown, /Incident opened: low-severity damage 3 Nov, 12:30 IST Low severity/);
  assert.match(shown, /Incident resolved\. Outcome: Warning/);
  assert.equal((html.match(/href="\/incidents\/inc-1"/g) ?? []).length, 2);
});

test('BookingTimeline copes with an empty list and with odd values', async () => {
  const { BookingTimeline } = await load('/src/components/BookingTimeline.jsx');
  assert.match(text(await render((React) => React.createElement(BookingTimeline, { items: [] }))), /No history yet/);
  assert.match(text(await render((React) => React.createElement(BookingTimeline, { items: undefined }))), /No history yet/);
  const odd = [
    { kind: 'event', at: 'bad date', action: 'booking.mystery', actor: null, reason: null, text: '' },
    { kind: 'condition_report', at: '2026-11-03T04:25:00.000Z', phase: 'return_confirmation', overall: 'good', items: [], photos: [], notes: null, by: null, text: '' },
    { kind: 'incident', id: 'inc-2', type: 'delay', severity: 'high', status: 'open', event: 'opened', at: '2026-11-03T07:00:00.000Z', text: '' },
  ];
  const html = await render((React) => React.createElement(BookingTimeline, { items: odd, incidentHref: null }));
  const shown = text(html);
  assert.doesNotMatch(shown, /\[object Object\]|undefined|NaN/);
  assert.match(shown, /booking\.mystery/);
  assert.match(shown, /Return check report/);
  assert.match(shown, /Incident opened/);
  assert.doesNotMatch(html, /href="\/incidents/);
});

test('BookingHistory renders from the timeline query: data, loading and error with retry', async () => {
  const { BookingHistory } = await load('/src/components/BookingTimeline.jsx');
  const { bookingKeys } = await load('/src/features/bookings/api.js');
  const loaded = await render((React) => React.createElement(BookingHistory, { bookingId: 'b1', subject: 'FDM 3D Printer #2' }), {
    cache: [[bookingKeys.timeline('b1'), { data: TIMELINE }]],
  });
  assert.match(text(loaded), /Check-in report/);

  const loading = await render((React) => React.createElement(BookingHistory, { bookingId: 'b1' }));
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading the booking history/);

  const failed = await render((React) => React.createElement(BookingHistory, { bookingId: 'b1' }), {
    errors: [[bookingKeys.timeline('b1'), { status: 500, code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-500' }]],
  });
  const shown = text(failed);
  assert.match(shown, /Couldn't load the booking history/);
  assert.match(shown, /ref: req-500/);
  assert.match(shown, /Try again/);
});

// ── PhotoUploader ─────────────────────────────────────────────────────────────

test('PhotoUploader shows the photos with alt text, labelled removal and the count', async () => {
  const { PhotoUploader } = await load('/src/components/PhotoUploader.jsx');
  signIn({ _id: 'user-aarav', roles: ['member'], verification: { status: 'approved' } });
  const html = await render((React) =>
    React.createElement(PhotoUploader, {
      value: [PHOTO_A, PHOTO_B],
      onChange: () => {},
      label: 'Check-in photos',
      photoLabel: 'Check-in photo',
      subject: 'FDM 3D Printer #2',
    }),
  );
  const shown = text(html);
  assert.match(html, /<fieldset/);
  assert.match(html, /<legend[^>]*>Check-in photos \(optional\)<\/legend>/);
  assert.match(html, /<img src="https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/v1730000000\/campuscommons\/photos\/a1\.jpg" alt="Check-in photo 1 of 2, FDM 3D Printer #2"/);
  assert.match(html, /aria-label="Remove Check-in photo 2 of 2, FDM 3D Printer #2"/);
  assert.match(shown, /2 of 3 photos added/);
  // The picker: the server's types, several at once while there is room, labelled and focusable.
  assert.match(html, /<input id="[^"]+" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(html, /multiple=""/, 'one slot left: one photo at a time');
  assert.match(shown, /Add more photos/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('PhotoUploader: full, empty and with a field error from the parent', async () => {
  const { PhotoUploader } = await load('/src/components/PhotoUploader.jsx');
  const third = { url: PHOTO_A.url.replace('a1', 'c3'), publicId: 'campuscommons/photos/c3' };
  const full = await render((React) =>
    React.createElement(PhotoUploader, { value: [PHOTO_A, PHOTO_B, third], onChange: () => {} }),
  );
  assert.match(full, /<input[^>]*type="file"[^>]*aria-disabled="true"/);
  assert.match(text(full), /3 of 3 photos added/);
  assert.doesNotMatch(full, /disabled=""/, 'aria-disabled keeps the focus of whoever just used it');

  const empty = await render((React) => React.createElement(PhotoUploader, { value: [], onChange: () => {}, required: true }));
  assert.match(empty, /multiple=""/);
  assert.match(text(empty), /0 of 3 photos added/);
  assert.doesNotMatch(text(empty), /\(optional\)/);
  assert.doesNotMatch(empty, /<ul class="grid/);

  const withError = await render((React) =>
    React.createElement(PhotoUploader, {
      value: [PHOTO_A],
      onChange: () => {},
      error: 'Must be a photo uploaded through /uploads/images.',
    }),
  );
  const errorId = withError.match(/<p id="([^"]+)" role="alert"/)[1];
  assert.match(withError, new RegExp(`aria-describedby="[^"]*${errorId.replace(/[^\w-]/g, '\\$&')}`));
  assert.match(text(withError), /Must be a photo uploaded through \/uploads\/images\./);
});

// ── Pages and routes ──────────────────────────────────────────────────────────

test('the booking and manage pages are built: each shows its loading state, never a placeholder', async () => {
  // Nothing in the cache: each page is waiting for its first answer. Heading null: the page shows
  // its heading only once the booking has loaded.
  const pages = [
    ['/src/features/bookings/MyBookingsPage.jsx', {}, /<h1[^>]*>My bookings<\/h1>/, /Loading your bookings/],
    ['/src/features/bookings/BookingDetailPage.jsx', {}, null, /Loading the booking/],
    ['/src/features/bookings/HandoverPage.jsx', { phase: 'check_in' }, /<h1[^>]*>.*Check in<\/h1>/s, /Loading the booking/],
    ['/src/features/bookings/HandoverPage.jsx', { phase: 'check_out' }, /<h1[^>]*>.*Check out<\/h1>/s, /Loading the booking/],
    ['/src/features/manage/RequestsPage.jsx', {}, /<h2[^>]*>Booking requests<\/h2>/, /Loading the review queue/],
    ['/src/features/manage/HandoversPage.jsx', {}, /<h2[^>]*>Handovers<\/h2>/, /Loading today's bookings/],
    ['/src/features/manage/ReturnConfirmPage.jsx', {}, null, /Loading the return/],
  ];
  for (const [path, props, heading, loading] of pages) {
    const { default: Page } = await load(path);
    const html = await render((React) => React.createElement(Page, props));
    if (heading) assert.match(html, heading, path);
    assert.match(html, /aria-busy="true"/, path);
    assert.match(text(html), loading, path);
    assert.doesNotMatch(text(html), /This page is being built/, path);
  }
  const placeholders = await load('/src/pages/Placeholders.jsx');
  assert.equal(placeholders.BookingsPlaceholder, undefined, 'the old bookings placeholder is gone');
  // Every manage and admin route has its page now; /badges keeps its own until the teammate's
  // badges page replaces it.
  assert.equal(placeholders.ManagePlaceholder, undefined, 'the manage placeholder is gone');
  assert.equal(placeholders.AdminPlaceholder, undefined, 'the admin placeholder is gone');
  assert.equal(typeof placeholders.BadgesPlaceholder, 'function', '/badges still has its placeholder');
});

test('the router maps the booking and manage paths to their pages', async () => {
  // createBrowserRouter reads window.location and document.defaultView; give it just enough.
  const win = {
    location: { pathname: '/explore', search: '', hash: '', href: 'http://localhost/explore', origin: 'http://localhost' },
    history: { state: null, length: 1, replaceState() {}, pushState() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = {
    defaultView: win,
    documentElement: { style: {} },
    head: { appendChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, styleSheet: null }),
    createTextNode: () => ({}),
    getElementsByTagName: () => [{ appendChild() {}, insertBefore() {}, firstChild: null }],
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
  };
  const had = { window: 'window' in globalThis, document: 'document' in globalThis };
  globalThis.window = win;
  globalThis.document = doc;
  try {
    const { router } = await load('/src/app/router.jsx');
    const pages = await load('/src/components/LazyPages.jsx');
    const { matchRoutes, Navigate } = await import('react-router-dom');
    const leaf = (path) => {
      const matches = matchRoutes(router.routes, path);
      assert.ok(matches, `${path} matches a route`);
      const last = matches[matches.length - 1];
      return { params: last.params, element: last.route.element.props.children, path: last.route.path };
    };
    assert.equal(leaf('/bookings').element.type, pages.MyBookingsPage);
    const detail = leaf('/bookings/b1');
    assert.equal(detail.element.type, pages.BookingDetailPage);
    assert.deepEqual(detail.params, { id: 'b1' });
    const checkIn = leaf('/bookings/b1/check-in');
    assert.equal(checkIn.element.type, pages.HandoverPage);
    assert.equal(checkIn.element.props.phase, 'check_in');
    const checkOut = leaf('/bookings/b1/check-out');
    assert.equal(checkOut.element.type, pages.HandoverPage);
    assert.equal(checkOut.element.props.phase, 'check_out');
    assert.notEqual(checkIn.element.key, checkOut.element.key, 'each phase mounts its own form');
    assert.equal(leaf('/manage/requests').element.type, pages.RequestsPage);
    assert.equal(leaf('/manage/handovers').element.type, pages.HandoversPage);
    const ret = leaf('/manage/returns/b1');
    assert.equal(ret.element.type, pages.ReturnConfirmPage);
    assert.deepEqual(ret.params, { bookingId: 'b1' });
    // The routes that were there stay.
    assert.equal(leaf('/explore').element.type, pages.ExplorePage);
    assert.equal(leaf('/verification').element.type, pages.VerificationPage);
    assert.equal(leaf('/admin/verifications').element.type, pages.VerificationQueuePage);
    // Phase 4b pages.
    assert.equal(leaf('/manage').element.type, pages.DashboardPage);
    assert.equal(leaf('/manage/resources').element.type, pages.ResourcesPage);
    const newResource = leaf('/manage/resources/new');
    assert.equal(newResource.element.type, pages.ResourceFormPage);
    assert.equal(newResource.element.props.mode, 'new');
    const editResource = leaf('/manage/resources/r1/edit');
    assert.equal(editResource.element.props.mode, 'edit');
    assert.deepEqual(editResource.params, { id: 'r1' });
    assert.notEqual(newResource.element.key, editResource.element.key, 'new and edit mount their own form');
    assert.equal(leaf('/manage/badges').element.type, pages.BadgeRequestsPage);
    assert.equal(leaf('/manage/incidents').element.props.scope, 'manage');
    assert.equal(leaf('/admin/incidents').element.props.scope, 'admin');
    for (const path of ['/incidents/inc-1', '/manage/incidents/inc-1', '/admin/incidents/inc-1'])
      assert.equal(leaf(path).element.type, pages.IncidentDetailPage, path);
    assert.equal(leaf('/incidents/new').element.type, pages.ReportIncidentPage);
    assert.equal(leaf('/admin/audit').element.type, pages.AuditPage);
    assert.equal(leaf('/notifications').element.type, pages.NotificationsPage);
    // Phase 5: /badges is code-split like the other pages.
    assert.equal(leaf('/badges').element.type, pages.BadgesPage);
    // /admin has no page of its own, and an unbuilt or unknown console page goes to the section's
    // first page: a redirect (replace, so Back doesn't bounce), never a placeholder.
    const redirect = (path) => {
      const matches = matchRoutes(router.routes, path);
      const element = matches?.[matches.length - 1].route.element;
      assert.equal(element?.type, Navigate, `${path} redirects`);
      return element.props;
    };
    assert.deepEqual(redirect('/admin'), { to: '/admin/verifications', replace: true });
    assert.deepEqual(redirect('/admin/users'), { to: '/admin/verifications', replace: true });
    assert.deepEqual(redirect('/manage/nothing-here'), { to: '/manage', replace: true });
    // One Suspense boundary per page route (a key each). React Router renders a navigation in a
    // transition, and a transition keeps an already-shown boundary's old page on screen while the
    // next page's chunk loads; a newly mounted boundary shows its fallback instead.
    const boundaries = [];
    const walk = (routes) => {
      for (const route of routes) {
        if (route.element?.type === pages.LazyPage) boundaries.push(route.element.key);
        if (route.children) walk(route.children);
      }
    };
    walk(router.routes);
    assert.ok(boundaries.length >= 20, `${boundaries.length} page routes`);
    assert.ok(boundaries.every((key) => key != null), 'every page boundary is keyed');
    assert.equal(new Set(boundaries).size, boundaries.length, 'no two routes share a boundary');
  } finally {
    if (!had.window) delete globalThis.window;
    if (!had.document) delete globalThis.document;
  }
});

// ── Phase 5: layouts, guards and the resource page's manager links ────────────

// The opening tags inside the first <nav aria-label="…"> of some markup.
function navOf(html, label) {
  const nav = html.match(new RegExp(`<nav aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`))?.[1];
  assert.ok(nav, `a nav landmark labelled "${label}"`);
  return nav;
}

const activeTab = (html) => html.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];

test('ManageLayout: Dashboard leads the sub-nav, active on /manage only; icons are hidden from screen readers', async () => {
  const { ManageLayout } = await load('/src/app/layouts/ManageLayout.jsx');
  const html = await render((React) => React.createElement(ManageLayout), { path: '/manage' });
  const nav = navOf(html, 'Management');
  assert.deepEqual(
    [...nav.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    ['/manage', '/manage/requests', '/manage/handovers', '/manage/scan', '/manage/resources', '/manage/badges', '/manage/incidents'],
  );
  assert.match(text(nav), /^Dashboard Review Queue/);
  const [active, ...more] = activeTab(html);
  assert.equal(more.length, 0, 'one active tab');
  assert.match(active, /href="\/manage"/);
  const tab = colours(active.match(/class="([^"]*)"/)[1]);
  assert.ok(contrast(tab.bg, tab.fg) >= 4.5, `active tab: ${contrast(tab.bg, tab.fg).toFixed(2)}:1`);
  const icons = nav.match(/<svg[^>]*>/g);
  assert.equal(icons.length, 7, "Dashboard, Review Queue, Handovers, Scan pass, Unit Resources, Badges, Incidents");
  for (const icon of icons) assert.match(icon, /aria-hidden="true"/);

  // `end`: on a page under /manage, only that page's tab is active, not the dashboard's too.
  const requests = await render((React) => React.createElement(ManageLayout), { path: '/manage/requests' });
  assert.deepEqual(activeTab(requests).map((a) => a.match(/href="([^"]+)"/)[1]), ['/manage/requests']);
});

test('AdminLayout: the active tab and the eyebrow are at least 4.5:1, and no tab leads to an unbuilt page', async () => {
  const { AdminLayout } = await load('/src/app/layouts/AdminLayout.jsx');
  const html = await render((React) => React.createElement(AdminLayout), { path: '/admin/audit' });
  const nav = navOf(html, 'Administration');
  assert.deepEqual(
    [...nav.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    ['/admin/verifications', '/admin/audit', '/admin/incidents'],
  );
  const [active] = activeTab(html);
  assert.match(active, /href="\/admin\/audit"/);
  const tab = colours(active.match(/class="([^"]*)"/)[1]);
  assert.ok(tab.bg && tab.fg, 'the active tab sets both colours');
  assert.ok(contrast(tab.bg, tab.fg) >= 4.5, `active tab: ${contrast(tab.bg, tab.fg).toFixed(2)}:1`);
  // The eyebrow sits on the header panel's #ede8df.
  const panel = html.match(/<div class="([^"]*)">\s*<div><span[^>]*>INSTITUTE ADMINISTRATION/)?.[1];
  assert.ok(panel, 'the eyebrow is in the header panel');
  const eyebrow = colours(html.match(/<span class="([^"]*)"[^>]*>INSTITUTE ADMINISTRATION<\/span>/)[1]).fg;
  const bg = colours(panel).bg;
  assert.ok(contrast(bg, eyebrow) >= 4.5, `eyebrow: ${contrast(bg, eyebrow).toFixed(2)}:1`);
  for (const icon of nav.match(/<svg[^>]*>/g)) assert.match(icon, /aria-hidden="true"/);
});

// A <button> inside an <a>: two nested controls for a screen reader.
const BUTTON_IN_LINK = /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<button\b/;

test('RequireVerified: the gate offers two links, never a button inside a link; a verified member gets the page', async () => {
  const { RequireVerified } = await load('/src/features/auth/RequireVerified.jsx');
  const guarded = (React) => React.createElement(RequireVerified, null, React.createElement('p', null, 'The booking form'));

  signIn({ _id: 'user-aarav', roles: ['member'], verification: { status: 'unsubmitted' } });
  const gate = await render(guarded);
  assert.doesNotMatch(gate, BUTTON_IN_LINK);
  assert.doesNotMatch(gate, /<button/, 'links only');
  assert.match(gate, /<a[^>]*href="\/verification"[^>]*>Verify ID Card Now<svg[^>]*aria-hidden="true"/);
  assert.match(gate, /<a[^>]*href="\/explore"[^>]*>Browse Resources<\/a>/);
  assert.match(text(gate), /ID Card Verification Required/);
  assert.doesNotMatch(text(gate), /The booking form/);

  signIn({ _id: 'user-aarav', roles: ['member'], verification: { status: 'pending' } });
  const pending = await render(guarded);
  assert.match(pending, /<a[^>]*href="\/verification"[^>]*>Check Verification Status/);
  assert.doesNotMatch(pending, BUTTON_IN_LINK);

  signIn({ _id: 'user-aarav', roles: ['member'], verification: { status: 'approved' } });
  assert.equal(await render(guarded), '<p>The booking form</p>');
  signIn({ _id: 'mgr-1', roles: ['member', 'manager'], verification: { status: 'unsubmitted' } });
  assert.equal(await render(guarded), '<p>The booking form</p>', 'managers are not gated');
});

test('RequireRole: the 403 card links back to Explore, never a button inside a link; the right role gets the page', async () => {
  const { RequireRole } = await load('/src/features/auth/RequireRole.jsx');
  const guarded = (React) =>
    React.createElement(RequireRole, { roles: ['manager', 'admin'] }, React.createElement('p', null, 'The console'));

  signIn({ _id: 'user-aarav', email: 'aarav@demo.campuscommons.test', roles: ['member'], verification: { status: 'approved' } });
  const denied = await render(guarded, { path: '/manage/requests' });
  assert.match(text(denied), /403 \/\/ ACCESS DENIED/);
  assert.match(text(denied), /requires manager or admin authorization/);
  assert.doesNotMatch(denied, BUTTON_IN_LINK);
  assert.doesNotMatch(denied, /<button/, 'a link only');
  assert.match(denied, /<a[^>]*href="\/explore"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Return to Explore<\/a>/);
  for (const icon of denied.match(/<svg[^>]*>/g)) assert.match(icon, /aria-hidden="true"/);

  signIn({ _id: 'mgr-1', roles: ['member', 'manager'], verification: { status: 'approved' } });
  assert.equal(await render(guarded), '<p>The console</p>');
});

test('a lazy page whose file is gone (an old tab after a redeploy) reloads the app once, then lets the error through', async () => {
  const { reloadForStaleChunk, withStaleChunkReload, RELOAD_KEY, RELOAD_WINDOW_MS } = await load('/src/lib/staleChunk.js');
  const memory = () => {
    const saved = new Map();
    return { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) };
  };
  const storage = memory();
  let reloads = 0;
  const deps = (now, extra = {}) => () => ({ storage, reload: () => (reloads += 1), now, online: true, ...extra });
  const gone = new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/MyBookingsPage-old.js');
  const failing = () => Promise.reject(gone);
  const state = (promise) =>
    Promise.race([
      promise.then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ]);

  // The first failure reloads, and the import never settles: the page's fallback stays up until
  // the reload replaces the page, instead of the error screen flashing first.
  const T = 1_800_000_000_000;
  assert.equal(await state(withStaleChunkReload(failing, deps(T))()), 'pending');
  assert.equal(reloads, 1);
  assert.equal(storage.getItem(RELOAD_KEY), String(T));
  // Failing again just after that reload (an outage, a broken deploy): no loop, the error goes on.
  await assert.rejects(withStaleChunkReload(failing, deps(T + 2_000))(), gone);
  assert.equal(reloads, 1);
  // A later redeploy, once the window has passed, reloads again.
  assert.equal(await state(withStaleChunkReload(failing, deps(T + RELOAD_WINDOW_MS))()), 'pending');
  assert.equal(reloads, 2);

  // Never a reload it can't remember (storage blocked or missing), nor while offline.
  const reload = () => assert.fail('no reload');
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} };
  assert.equal(reloadForStaleChunk({ storage: blocked, reload, now: T }), false);
  assert.equal(reloadForStaleChunk({ storage: null, reload, now: T }), false);
  assert.equal(reloadForStaleChunk({ storage: memory(), reload, now: T, online: false }), false);

  // A page that loads is passed through untouched.
  const module = { default: () => null };
  assert.equal(await withStaleChunkReload(() => Promise.resolve(module), deps(T))(), module);
});

// The Detail of GET /resources/:id (api.md "Resources"), trimmed to what the page reads.
const resourceDetail = (overrides = {}) => ({
  _id: '64c000000000000000000001',
  title: 'FDM 3D Printer #2',
  slug: 'fdm-3d-printer-2',
  images: [],
  category: 'equipment',
  bookingMode: 'slot',
  quantity: 1,
  riskLevel: 'medium',
  status: 'active',
  availability: { weekly: [{ day: 1, open: '09:00', close: '17:00' }], slotMinutes: 30, blackouts: [] },
  eligibility: { memberTypes: [], departments: [], badges: [], approvalMode: 'manual' },
  limits: { maxDurationMins: 240, maxHoursPerWeek: 6 },
  orgUnit: { _id: 'u-dic', name: 'Design and Innovation Centre', code: 'dic', type: 'centre' },
  openHours: 'Mon 09:00–17:00',
  usageRules: 'PLA and PETG only.',
  checklist: ['Nozzle clean'],
  canManage: false,
  createdAt: '2026-10-20T04:30:00.000Z',
  updatedAt: '2026-10-20T04:30:00.000Z',
  ...overrides,
});

// The whole <a …>…</a> whose text includes `label`, or null.
const linkWith = (html, label) =>
  html.match(new RegExp(`<a\\b[^>]*>(?:(?!</a>)[\\s\\S])*${label}(?:(?!</a>)[\\s\\S])*</a>`))?.[0] ?? null;

test('ResourceDetail: whoever manages the resource can edit it or report an issue on it; others see neither', async () => {
  signIn({ _id: 'mgr-1', roles: ['member', 'manager'], verification: { status: 'approved' } });
  const { ResourceDetail } = await load('/src/pages/ResourceDetailPage.jsx');
  const show = (resource) =>
    render((React) => React.createElement(ResourceDetail, { resource }), { path: `/resources/${resource._id}` });

  const managed = await show(resourceDetail({ canManage: true }));
  const edit = linkWith(managed, 'Edit this resource');
  assert.match(edit, /href="\/manage\/resources\/64c000000000000000000001\/edit"/);
  const report = linkWith(managed, 'Report an issue');
  assert.match(report, /href="\/incidents\/new\?resourceId=64c000000000000000000001"/);
  for (const link of [edit, report]) {
    assert.match(link, /<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(link, /<button/);
  }
  assert.match(text(managed), /You manage this/);

  // A manager of another unit (canManage false) may neither edit it nor report on it without a booking.
  const other = await show(resourceDetail({ canManage: false }));
  assert.equal(linkWith(other, 'Edit this resource'), null);
  assert.equal(linkWith(other, 'Report an issue'), null);
  assert.doesNotMatch(other, /href="\/manage\/resources\//);
});

test('vite.config.js: each vendor goes to its own chunk group; app code and lazy-only libraries to none', async () => {
  const { default: config } = await import('../vite.config.js');
  const groups = config.build.rolldownOptions.output.codeSplitting.groups;
  // The group that claims a module: the highest priority whose test matches, then the earliest.
  const groupOf = (id) =>
    groups
      .map((group, index) => ({ ...group, index }))
      .filter((group) => group.test.test(id))
      .sort((a, b) => b.priority - a.priority || a.index - b.index)[0] ?? null;
  const cases = [
    ['/app/node_modules/react/index.js', 'react'],
    ['/app/node_modules/react-dom/cjs/react-dom-client.production.js', 'react'],
    ['/app/node_modules/scheduler/index.js', 'react'],
    ['/app/node_modules/react-router/dist/production/index.mjs', 'react'],
    ['/app/node_modules/react-router-dom/dist/index.mjs', 'react'],
    ['C:\\app\\node_modules\\react-dom\\client.js', 'react'],
    ['/app/node_modules/@tanstack/query-core/build/modern/index.js', 'query'],
    ['/app/node_modules/@tanstack/react-query/build/modern/index.js', 'query'],
    ['/app/node_modules/@headlessui/react/dist/headlessui.esm.js', 'headlessui'],
    ['/app/node_modules/date-fns/format.js', 'date-fns'],
    ['/app/node_modules/date-fns-tz/dist/esm/index.js', 'date-fns'],
    ['/app/node_modules/lucide-react/dist/esm/icons/bell.js', 'icons'],
    ['/app/node_modules/zod/v4/classic/schemas.js', 'forms'],
    ['/app/node_modules/react-hook-form/dist/index.esm.mjs', 'forms'],
    ['/app/node_modules/@hookform/resolvers/zod/dist/zod.mjs', 'forms'],
    // Not React: packages whose names only start with "react".
    ['/app/node_modules/@react-aria/focus/dist/import.mjs', 'vendor'],
    ['/app/node_modules/react-hook-form-extra/index.js', 'vendor'],
    ['/app/node_modules/axios/lib/axios.js', 'vendor'],
    ['/app/node_modules/sonner/dist/index.mjs', 'vendor'],
    ['/app/src/pages/ExplorePage.jsx', null],
  ];
  for (const [id, name] of cases) assert.equal(groupOf(id)?.name ?? null, name, id);
  // The catch-all takes only what the entry loads statically, so a library that only a lazy page
  // imports (browser-image-compression) stays with that page.
  assert.deepEqual(groupOf('/app/node_modules/browser-image-compression/dist/index.mjs').tags, ['$initial']);
});
