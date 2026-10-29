// Tests for notifications (frontend.md §6.2 /notifications, §7 NotificationBell, §8.2): the API
// module (features/notifications/api.js), its helpers, the optimistic "mark read", the header bell
// and the notifications page. Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/foundations.test.mjs. Requests go to a
// fake axios adapter; components render with react-dom/server from a React Query cache holding data
// shaped exactly as docs/api.md "Notifications" describes, so a crash such as rendering an object
// as text shows up here.
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

const api = () => load('/src/features/notifications/api.js');
const view = () => load('/src/features/notifications/components/notificationView.js');

// ── Fakes ─────────────────────────────────────────────────────────────────────

// routes: { 'PATCH /notifications/n1/read': (config) => answer }. An answer (or a promise of one) is
// { status, data, meta } or { status, code, message, details }; anything unrouted is 404 NOT_FOUND.
function fakeApi(routes = {}) {
  const calls = [];
  http.defaults.adapter = async (config) => {
    const path = config.url.replace(/^\/api\/v1/, '');
    const key = `${config.method.toUpperCase()} ${path}`;
    let body = config.data;
    if (typeof body === 'string') body = JSON.parse(body);
    calls.push({ key, config, body, params: config.params });
    const answer = (await routes[key]?.(config)) ?? { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
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

// A promise and the function that settles it, for a request answered later.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const until = async (check, label) => {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
};

// ── Data shaped as docs/api.md says ─────────────────────────────────────────

const MEMBER = {
  _id: 'user-aarav',
  name: 'Aarav Student',
  email: '2024ugcs001@nitjsr.ac.in',
  roles: ['member'],
  memberType: 'ug',
  verification: { status: 'approved', reason: null, submittedAt: null },
};

// Notification: { _id, type, title, body, link, readAt: ISO | null, createdAt, updatedAt }.
const notification = (overrides = {}) => ({
  _id: 'n1',
  type: 'badge.granted',
  title: 'Badge granted: 3D Printing Basics',
  body: 'Design and Innovation Centre granted you 3D Printing Basics. It expires on 29 Oct 2027.',
  link: '/badges',
  readAt: null,
  createdAt: '2026-10-29T05:00:00.000Z',
  updatedAt: '2026-10-29T05:00:00.000Z',
  ...overrides,
});

const UNREAD = notification();
const READ = notification({
  _id: 'n2',
  type: 'booking.approved',
  title: 'Booking approved: FDM 3D Printer #2',
  body: 'Your booking for 3 Nov, 10:00–12:00 was approved.',
  link: '/bookings/b1',
  readAt: '2026-10-29T06:00:00.000Z',
  createdAt: '2026-10-28T10:00:00.000Z',
  updatedAt: '2026-10-29T06:00:00.000Z',
});

const listAnswer = (items, meta = {}) => ({
  data: items,
  meta: { page: 1, limit: 20, total: items.length, unread: items.filter((n) => !n.readAt).length, ...meta },
});

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

// Renders inside a router and a QueryClient whose cache holds `cache` ([key, data] pairs) and
// `errors` ([key, error] pairs, as a query that failed).
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
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { onResult: (value) => results.push(value) }),
    ),
  );
  return { result: results[results.length - 1], invalidated, client };
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
  assert.doesNotMatch(shown, /\bundefined\b|\bNaN\b|\bnull\b/);
}

// ── API functions ─────────────────────────────────────────────────────────────

test('listNotifications: GET /notifications with page and limit, unread only when asked', async () => {
  const { listNotifications } = await api();
  const calls = fakeApi({
    'GET /notifications': () => ({ status: 200, ...listAnswer([UNREAD, READ], { total: 41, unread: 7 }) }),
  });
  const all = await listNotifications({ page: 2 });
  assert.equal(calls[0].key, 'GET /notifications');
  assert.deepEqual(calls[0].params, { page: 2, limit: 20 }, 'no unread key: the server takes only true or false');
  assert.deepEqual(all.data, [UNREAD, READ]);
  assert.deepEqual(all.meta, { page: 1, limit: 20, total: 41, unread: 7 });

  await listNotifications({ unread: true, limit: 5 });
  assert.deepEqual(calls[1].params, { unread: true, page: 1, limit: 5 });
  // A ?unread=true string from the URL counts too; anything else doesn't.
  await listNotifications({ unread: 'true' });
  assert.equal(calls[2].params.unread, true);
  await listNotifications({ unread: 'yes' });
  assert.equal('unread' in calls[3].params, false);
});

test('getUnreadCount, markNotificationRead and markAllNotificationsRead hit their routes', async () => {
  const { getUnreadCount, markNotificationRead, markAllNotificationsRead } = await api();
  const calls = fakeApi({
    'GET /notifications/unread-count': () => ({ status: 200, data: { count: 3 } }),
    'PATCH /notifications/n%201/read': () => ({ status: 200, data: { ...UNREAD, readAt: '2026-10-29T07:00:00.000Z' } }),
    'PATCH /notifications/read-all': () => ({ status: 200, data: { updated: 2 } }),
  });
  assert.deepEqual(await getUnreadCount(), { data: { count: 3 }, meta: undefined });
  const read = await markNotificationRead('n 1');
  assert.equal(calls[1].key, 'PATCH /notifications/n%201/read', 'the id is encoded');
  assert.equal(read.data.readAt, '2026-10-29T07:00:00.000Z');
  assert.deepEqual((await markAllNotificationsRead()).data, { updated: 2 });
  assert.equal(calls[2].key, 'PATCH /notifications/read-all');
});

test('a refused mark-read rejects with the normalised error and its request id', async () => {
  const { markNotificationRead } = await api();
  fakeApi({
    'PATCH /notifications/n1/read': () => ({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Your account is suspended until 5 Nov 2026, 14:30 IST: Late returns',
      details: { suspendedUntil: '2026-11-05T09:00:00.000Z', reason: 'Late returns' },
    }),
  });
  const err = await rejection(markNotificationRead('n1'));
  assert.equal(err.status, 403);
  assert.equal(err.code, 'FORBIDDEN');
  assert.match(err.message, /suspended until 5 Nov 2026/);
  assert.equal(err.requestId, 'req-err');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

test('the bell count reads { data: { count } } and words the badge and the button', async () => {
  const { unreadCountOf, unreadBadgeText, bellLabel } = await api();
  assert.equal(unreadCountOf({ data: { count: 4 } }), 4);
  assert.equal(unreadCountOf({ data: { count: 0 } }), 0);
  assert.equal(unreadCountOf(undefined), null, 'not loaded yet');
  assert.equal(unreadCountOf({ data: {} }), null);
  assert.equal(unreadCountOf({ data: { count: -1 } }), null);
  assert.equal(unreadBadgeText(0), '');
  assert.equal(unreadBadgeText(3), '3');
  assert.equal(unreadBadgeText(9), '9');
  assert.equal(unreadBadgeText(10), '9+');
  assert.equal(bellLabel(0), 'Notifications');
  assert.equal(bellLabel(12), 'Notifications, 12 unread', 'the full count, not "9+"');
});

test('only in-app paths are ever followed', async () => {
  const { isInAppPath } = await api();
  for (const link of ['/bookings/b1', '/bookings/b1/check-in', '/badges', '/manage/returns/b1', '/admin/incidents']) {
    assert.equal(isInAppPath(link), true, link);
  }
  for (const link of ['//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'bookings/b1', '', null, 42]) {
    assert.equal(isInAppPath(link), false, String(link));
  }
});

test('markReadInList marks one notification read and lowers meta.unread, nothing else', async () => {
  const { markReadInList, holdsUnread, notificationParams, notificationKeys } = await api();
  const list = listAnswer([UNREAD, READ], { unread: 5 });
  const next = markReadInList(list, 'n1', '2026-10-29T07:00:00.000Z');
  assert.equal(next.data[0].readAt, '2026-10-29T07:00:00.000Z');
  assert.equal(next.data[1], READ, 'the other row is untouched');
  assert.equal(next.meta.unread, 4);
  assert.equal(next.meta.total, 2);
  assert.equal(list.data[0].readAt, null, 'the cached answer is not mutated');
  // Already read, unknown or not a list: the same object back.
  assert.equal(markReadInList(list, 'n2', 'x'), list);
  assert.equal(markReadInList(list, 'nope', 'x'), list);
  assert.equal(markReadInList(undefined, 'n1', 'x'), undefined);
  assert.equal(markReadInList(listAnswer([UNREAD], { unread: 0 }), 'n1', 'x').meta.unread, 0, 'never below 0');
  assert.equal(holdsUnread(list, 'n1'), true);
  assert.equal(holdsUnread(list, 'n2'), false);

  assert.deepEqual(notificationParams({ unread: 'true', page: '3' }), { unread: true, page: 3, limit: 20 });
  assert.deepEqual(notificationKeys.list({ page: 1, limit: 5 }), ['notifications', 'list', { unread: false, page: 1, limit: 5 }]);
  assert.deepEqual(notificationKeys.unreadCount, ['notifications', 'unread-count']);
});

test('notificationView: area, icon, safe link and IST times for every type', async () => {
  const { notificationKind, notificationView } = await view();
  const now = Date.parse('2026-10-29T05:05:00.000Z');
  const v = notificationView(UNREAD, now);
  assert.equal(v.id, 'n1');
  assert.equal(v.area, 'Badge');
  assert.equal(v.unread, true);
  assert.equal(v.link, '/badges');
  assert.equal(v.when, '5 min ago');
  assert.equal(v.whenFull, '29 Oct 2026, 10:30 am IST');
  assert.equal(typeof v.icon, 'object', 'a lucide component');

  const types = [
    'booking.requested', 'booking.approved', 'booking.rejected', 'booking.waitlisted', 'booking.promoted',
    'booking.cancelled', 'booking.checked_in', 'booking.checked_out', 'booking.completed', 'booking.no_show',
    'booking.expired', 'booking.reminder_start', 'booking.reminder_end', 'booking.overdue', 'badge.requested',
    'badge.granted', 'badge.rejected', 'verification.approved', 'verification.rejected', 'incident.created',
    'incident.commented', 'incident.resolved',
  ];
  const areas = { booking: 'Booking', badge: 'Badge', verification: 'ID verification', incident: 'Incident' };
  for (const type of types) {
    const kind = notificationKind(type);
    assert.equal(kind.area, areas[type.split('.')[0]], type);
    assert.ok(kind.icon, type);
  }
  assert.equal(notificationKind('something.new').area, 'Update');
  assert.ok(notificationKind(undefined).icon);

  const unsafe = notificationView(notification({ link: 'https://evil.example', title: '' }), now);
  assert.equal(unsafe.link, null);
  assert.equal(unsafe.title, 'Badge', 'a blank title falls back to the area');
  assert.equal(notificationView(READ, now).unread, false);
});

// ── Hooks ─────────────────────────────────────────────────────────────────────

test('useNotifications: every list answer also sets the bell count from meta.unread', async () => {
  const { useNotifications, notificationKeys } = await api();
  fakeApi({
    'GET /notifications': () => ({ status: 200, ...listAnswer([UNREAD], { unread: 6 }) }),
  });
  const { client } = await withHook(() => useNotifications({ unread: true, page: 1 }), {
    cache: [[notificationKeys.unreadCount, { data: { count: 2 } }]],
  });
  const key = notificationKeys.list({ unread: true, page: 1 });
  await client.getQueryCache().find({ queryKey: key }).fetch();
  assert.equal(client.getQueryData(key).meta.unread, 6);
  assert.deepEqual(client.getQueryData(notificationKeys.unreadCount), { data: { count: 6 } });
  client.clear();
});

test('useUnreadCount polls every 30 s, never in a hidden tab, and only while enabled', async () => {
  const { useUnreadCount, notificationKeys, UNREAD_POLL_MS } = await api();
  assert.equal(UNREAD_POLL_MS, 30000);
  // The query keeps the options the hook gave it (React Query builds it from the observer's).
  for (const enabled of [true, false]) {
    const { client } = await withHook(() => useUnreadCount({ enabled }));
    const { options } = client.getQueryCache().find({ queryKey: notificationKeys.unreadCount });
    assert.equal(options.refetchInterval, 30000);
    assert.equal(options.refetchIntervalInBackground, false, 'React Query skips a tick while the tab is hidden');
    assert.equal(options.enabled, enabled);
    client.clear();
  }
});

test('useMarkRead: the row and the count change at once, and the server confirms', async () => {
  const { useMarkRead, notificationKeys } = await api();
  const pending = deferred();
  const calls = fakeApi({ 'PATCH /notifications/n1/read': () => pending.promise });
  const listKey = notificationKeys.list({ page: 1 });
  const bellKey = notificationKeys.list({ page: 1, limit: 5 });
  const { result, client, invalidated } = await withHook(() => useMarkRead(), {
    cache: [
      [listKey, listAnswer([UNREAD, READ], { unread: 3 })],
      [bellKey, listAnswer([UNREAD], { unread: 3, limit: 5 })],
      [notificationKeys.unreadCount, { data: { count: 3 } }],
    ],
  });
  const done = result.mutateAsync('n1');
  await until(() => calls.length === 1, 'the PATCH');
  // Before the server answers: read everywhere, one fewer unread.
  assert.ok(client.getQueryData(listKey).data[0].readAt);
  assert.equal(client.getQueryData(listKey).meta.unread, 2);
  assert.ok(client.getQueryData(bellKey).data[0].readAt);
  assert.deepEqual(client.getQueryData(notificationKeys.unreadCount), { data: { count: 2 } });
  pending.resolve({ status: 200, data: { ...UNREAD, readAt: '2026-10-29T07:00:00.000Z' } });
  await done;
  assert.deepEqual(invalidated, [['notifications']], 'then every notification query refetches');
  client.clear();
});

test('useMarkRead: a refusal puts the row and the count back', async () => {
  const { useMarkRead, notificationKeys } = await api();
  fakeApi({
    'PATCH /notifications/n1/read': () => ({ status: 404, code: 'NOT_FOUND', message: 'Notification not found.' }),
  });
  const listKey = notificationKeys.list({ page: 1 });
  const { result, client, invalidated } = await withHook(() => useMarkRead(), {
    cache: [
      [listKey, listAnswer([UNREAD, READ], { unread: 3 })],
      [notificationKeys.unreadCount, { data: { count: 3 } }],
    ],
  });
  const err = await rejection(result.mutateAsync('n1'));
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(client.getQueryData(listKey).data[0].readAt, null);
  assert.equal(client.getQueryData(listKey).meta.unread, 3);
  assert.deepEqual(client.getQueryData(notificationKeys.unreadCount), { data: { count: 3 } });
  assert.deepEqual(invalidated, [['notifications']]);
  client.clear();
});

test('useMarkRead on an already read notification leaves the count alone', async () => {
  const { useMarkRead, notificationKeys } = await api();
  fakeApi({ 'PATCH /notifications/n2/read': () => ({ status: 200, data: READ }) });
  const listKey = notificationKeys.list({ page: 1 });
  const { result, client } = await withHook(() => useMarkRead(), {
    cache: [
      [listKey, listAnswer([UNREAD, READ], { unread: 3 })],
      [notificationKeys.unreadCount, { data: { count: 3 } }],
    ],
  });
  await result.mutateAsync('n2');
  assert.deepEqual(client.getQueryData(notificationKeys.unreadCount), { data: { count: 3 } });
  client.clear();
});

test('useMarkAllRead waits for the server, then refreshes every notification query', async () => {
  const { useMarkAllRead } = await api();
  const calls = fakeApi({ 'PATCH /notifications/read-all': () => ({ status: 200, data: { updated: 4 } }) });
  const { result, invalidated, client } = await withHook(() => useMarkAllRead());
  const answer = await result.mutateAsync();
  assert.equal(calls[0].key, 'PATCH /notifications/read-all');
  assert.deepEqual(answer.data, { updated: 4 });
  assert.deepEqual(invalidated, [['notifications']]);
  client.clear();
});

// ── The header bell ───────────────────────────────────────────────────────────

test('NotificationBell: a menu button named with the unread count, the badge capped at 9+', async () => {
  signIn(MEMBER);
  const { NotificationBell } = await load('/src/components/NotificationBell.jsx');
  const { notificationKeys } = await api();
  const html = await render((React) => React.createElement(NotificationBell), {
    cache: [[notificationKeys.unreadCount, { data: { count: 12 } }]],
  });
  assert.match(html, /aria-label="Notifications, 12 unread"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(text(html), /^9\+$/, 'the badge shows 9+ (hidden from screen readers, which hear the label)');
  assert.match(html, /<span aria-hidden="true"[^>]*>9\+<\/span>/);
  assert.doesNotMatch(html, /role="menu"/, 'closed until pressed');

  const none = await render((React) => React.createElement(NotificationBell), {
    cache: [[notificationKeys.unreadCount, { data: { count: 0 } }]],
  });
  assert.match(none, /aria-label="Notifications"/);
  assert.equal(text(none), '', 'no badge at 0');

  const loading = await render((React) => React.createElement(NotificationBell));
  assert.match(loading, /aria-label="Notifications"/);
});

async function renderPanel(props, options) {
  const { BellPanel } = await load('/src/components/NotificationBell.jsx');
  const { Menu, MenuItems } = await import('@headlessui/react');
  return render(
    (React) =>
      React.createElement(Menu, null, React.createElement(MenuItems, { static: true }, React.createElement(BellPanel, props))),
    options,
  );
}

test('BellPanel: the latest 5 as menu items, then "Mark all read" and "See all"', async () => {
  signIn(MEMBER);
  const { notificationKeys } = await api();
  const html = await renderPanel(
    { unread: 1 },
    { cache: [[notificationKeys.list({ page: 1, limit: 5 }), listAnswer([UNREAD, READ], { limit: 5 })]] },
  );
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /role="menu"/);
  // Two notifications, "Mark all read" and "See all".
  assert.equal(html.match(/role="menuitem"/g)?.length, 4);
  assert.match(shown, /Latest notifications 1 unread/);
  assert.match(shown, /Badge granted: 3D Printing Basics Unread\. Design and Innovation Centre granted you/);
  assert.match(shown, /Booking approved: FDM 3D Printer #2 Your booking for 3 Nov, 10:00–12:00 was approved\./);
  assert.doesNotMatch(shown, /Booking approved: FDM 3D Printer #2 Unread/);
  assert.match(shown, /Mark all read/);
  assert.match(html, /<a[^>]*href="\/notifications"[^>]*>See all/);
});

test('BellPanel: "Mark all read" is disabled with nothing unread; loading, empty and failed states', async () => {
  signIn(MEMBER);
  const { notificationKeys } = await api();
  const key = notificationKeys.list({ page: 1, limit: 5 });

  const allRead = await renderPanel({ unread: 0 }, { cache: [[key, listAnswer([READ], { limit: 5 })]] });
  assert.match(text(allRead), /All read/);
  assert.match(allRead, /aria-disabled="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Mark all read/);

  const loading = await renderPanel({ unread: 2 });
  assert.match(text(loading), /Loading your notifications…/);

  const empty = await renderPanel({ unread: 0 }, { cache: [[key, listAnswer([], { limit: 5 })]] });
  assert.match(text(empty), /No notifications yet/);

  const failed = await renderPanel(
    { unread: 0 },
    { errors: [[key, failure({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again later.' })]] },
  );
  assert.match(text(failed), /Couldn't load your notifications\. Try again later\./);
  assert.match(text(failed), /ref: req-abc123/);
});

test('AppLayout puts the bell in the header', async () => {
  signIn(MEMBER);
  const { AppLayout } = await load('/src/app/layouts/AppLayout.jsx');
  const { notificationKeys } = await api();
  const html = await render((React) => React.createElement(AppLayout), {
    path: '/explore',
    cache: [[notificationKeys.unreadCount, { data: { count: 2 } }]],
  });
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /aria-label="Notifications, 2 unread"/);
  assert.ok(header.indexOf('Notifications, 2 unread') < header.indexOf('aria-label="Logout"'), 'before Logout');
});

test("the bell's stand-in while its code loads: the same label and count, but nothing to tab to or press", async () => {
  signIn(MEMBER);
  const { BellFallback } = await load('/src/app/layouts/AppLayout.jsx');
  const { notificationKeys } = await api();
  const html = await render((React) => React.createElement(BellFallback), {
    cache: [[notificationKeys.unreadCount, { data: { count: 2 } }]],
  });
  assert.match(html, /aria-label="Notifications, 2 unread"/);
  assert.match(html, />2<\/span>/);
  // Not a control: Enter on it would do nothing, and focus on it would drop to <body> when the
  // real bell replaces it.
  assert.doesNotMatch(html, /<(?:button|a|input|select|textarea)\b/);
  assert.doesNotMatch(html, /tabindex=/i);
});

// ── The notifications page ────────────────────────────────────────────────────

async function pageKey(params = {}) {
  const { notificationKeys } = await api();
  return notificationKeys.list({ page: 1, limit: 20, ...params });
}

test('NotificationsPage: each notification with its area, title, body, IST time and actions', async () => {
  signIn(MEMBER);
  const { default: NotificationsPage } = await load('/src/features/notifications/NotificationsPage.jsx');
  const html = await render((React) => React.createElement(NotificationsPage), {
    path: '/notifications',
    cache: [[await pageKey(), listAnswer([UNREAD, READ])]],
  });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(html, /<h1[^>]*>Notifications<\/h1>/);
  assert.match(html, /<h2[^>]*>Badge granted: 3D Printing Basics<\/h2>/);
  assert.match(html, /<h2[^>]*>Booking approved: FDM 3D Printer #2<\/h2>/);
  assert.match(shown, /2 notifications · 1 unread/);
  assert.match(shown, /Badge Unread Badge granted/);
  assert.match(shown, /29 Oct 2026, 10:30 am IST/);
  assert.match(html, /<time dateTime="2026-10-29T05:00:00.000Z"/);
  // Open goes to the in-app link; only the unread one has "Mark read".
  assert.match(html, /<a[^>]*href="\/badges"[^>]*>Open<span class="sr-only">: Badge granted: 3D Printing Basics<\/span>/);
  assert.match(html, /<a[^>]*href="\/bookings\/b1"/);
  assert.equal(html.match(/Mark read<span class="sr-only">/g)?.length, 1);
  // The filter, as toggle buttons.
  assert.match(html, /aria-pressed="true"[^>]*>All<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Unread<span> \(1\)<\/span><\/button>/);
  assert.match(shown, /Mark all read/);
  assert.match(html, /role="status"/, 'a live region for "Marked … read"');
});

test('NotificationsPage: a link that is not an in-app path gets no Open button', async () => {
  signIn(MEMBER);
  const { default: NotificationsPage } = await load('/src/features/notifications/NotificationsPage.jsx');
  const odd = notification({ _id: 'n3', link: '//evil.example/phish', readAt: '2026-10-29T06:00:00.000Z' });
  const html = await render((React) => React.createElement(NotificationsPage), {
    path: '/notifications',
    cache: [[await pageKey(), listAnswer([odd])]],
  });
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(text(html), /\bOpen\b/);
  // Nothing unread: "Mark all read" stays focusable but does nothing.
  assert.match(html, /aria-disabled="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Mark all read/);
});

test('NotificationsPage: ?unread=true asks for unread ones and says when none are left', async () => {
  signIn(MEMBER);
  const { default: NotificationsPage } = await load('/src/features/notifications/NotificationsPage.jsx');
  const html = await render((React) => React.createElement(NotificationsPage), {
    path: '/notifications?unread=true',
    cache: [[await pageKey({ unread: true }), listAnswer([], { unread: 0 })]],
  });
  assert.match(html, /aria-pressed="true"[^>]*>Unread/);
  assert.match(text(html), /You're all caught up/);
  assert.match(text(html), /0 unread/);
});

test('NotificationsPage: loading, error (message, request id, retry) and paging', async () => {
  signIn(MEMBER);
  const { default: NotificationsPage } = await load('/src/features/notifications/NotificationsPage.jsx');
  const key = await pageKey();

  const loading = await render((React) => React.createElement(NotificationsPage), { path: '/notifications' });
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading your notifications…/);

  const failed = await render((React) => React.createElement(NotificationsPage), {
    path: '/notifications',
    errors: [[key, failure({ status: 404, code: 'NOT_FOUND', message: 'User not found.' })]],
  });
  assert.match(failed, /role="alert"/);
  assert.match(text(failed), /Couldn't load your notifications/);
  assert.match(text(failed), /User not found\./);
  assert.match(text(failed), /ref: req-abc123/);
  assert.match(text(failed), /Try again/);

  const many = await render((React) => React.createElement(NotificationsPage), {
    path: '/notifications',
    cache: [[key, listAnswer([UNREAD, READ], { total: 45, unread: 9 })]],
  });
  assert.match(text(many), /45 notifications · 9 unread/);
  assert.match(text(many), /Page 1 of 3/);
  assert.match(many, /<nav aria-label="Notification pages"/);
});
