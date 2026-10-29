// Tests for /profile and the header's account menu (frontend.md §6.2): the account view the header,
// the menu and the page share (features/profile/account.js), the page body (Profile) and the menu
// (UserMenu). Run with `npm test` (node:test, no extra dependencies).
//
// The real modules load through Vite's SSR loader, like test/foundations.test.mjs; components render
// with react-dom/server from a React Query cache holding data shaped as docs/api.md "User view" and
// "Member row" describe.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let load;
let store;
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
  store = (await load('/src/stores/auth.js')).useAuthStore;
  http = (await load('/src/lib/http.js')).default;
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

const account = () => load('/src/features/profile/account.js');

// ── Data shaped as docs/api.md says ─────────────────────────────────────────

const DIC = '64a000000000000000000d1c';
const CW = '64a000000000000000000c0e';

// User view: { _id, name, email, roles, memberType, department, managedOrgUnits: [id],
// emailVerified, verification: { status, reason, submittedAt }, strikes, suspendedUntil, … }.
const user = (overrides = {}) => ({
  _id: 'user-ananya',
  name: 'Ananya Rao',
  email: 'student@demo.campuscommons.test',
  roles: ['member'],
  memberType: 'ug',
  department: { _id: 'dep-cse', code: 'cse', name: 'Computer Science and Engineering' },
  managedOrgUnits: [],
  emailVerified: true,
  verification: { status: 'approved', reason: null, submittedAt: '2026-10-20T05:00:00.000Z' },
  strikes: 0,
  suspendedUntil: null,
  suspensionReason: null,
  emailHints: null,
  ...overrides,
});

const MANAGER = user({
  name: 'Meera Iyer',
  email: 'manager@demo.campuscommons.test',
  roles: ['member', 'manager'],
  memberType: 'staff',
  department: null,
  managedOrgUnits: [DIC, CW],
  verification: { status: 'unsubmitted', reason: null, submittedAt: null },
});
const ADMIN = user({ name: 'Campus Admin', roles: ['member', 'admin'], memberType: 'staff', department: null });

// Member row: { _id, badge: { _id, name, code, orgUnit: { _id, name, code }, … }, status, state, … }.
const badgeRow = (overrides = {}) => ({
  _id: 'row-1',
  badge: {
    _id: 'badge-elec',
    name: 'Electronics Lab Safety',
    code: 'electronics-lab-safety',
    orgUnit: { _id: 'unit-ece', name: 'Electronics and Communication Engineering', code: 'ece' },
    validityDays: 365,
    evidenceRequired: false,
    selfServe: false,
  },
  status: 'active',
  state: 'active',
  note: null,
  reason: null,
  requestedAt: '2026-10-01T05:00:00.000Z',
  decidedAt: '2026-10-02T05:00:00.000Z',
  expiresAt: '2027-10-02T05:00:00.000Z',
  hasEvidence: false,
  ...overrides,
});

// ── Rendering ─────────────────────────────────────────────────────────────────

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

function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertNoJunk(html) {
  const shown = text(html);
  assert.doesNotMatch(shown, /\[object Object\]/);
  assert.doesNotMatch(shown, /\bundefined\b|\bNaN\b|\bnull\b/);
}

async function renderProfile(props, cache = []) {
  const { Profile } = await load('/src/features/profile/ProfilePage.jsx');
  return render((React) => React.createElement(Profile, { now: Date.parse('2026-10-29T06:00:00Z'), ...props }), {
    cache,
    path: '/profile',
  });
}

// ── The account view ──────────────────────────────────────────────────────────

test('accountView: initials, roles, staff and verification wording', async () => {
  const { accountView, initialsOf } = await account();
  assert.equal(initialsOf('Ananya Rao'), 'AR');
  assert.equal(initialsOf('Dr. Kavya Nair'), 'DN');
  assert.equal(initialsOf('admin'), 'AD');
  assert.equal(initialsOf(''), '?');

  const member = accountView(user());
  assert.equal(member.isManager, false);
  assert.equal(member.verified, true);
  assert.deepEqual(member.verification.badge, { label: 'Verified', variant: 'forest' });
  assert.equal(member.subtitle, 'Computer Science and Engineering');

  const pending = accountView(user({ verification: { status: 'pending', reason: null } }));
  assert.equal(pending.verified, false);
  assert.equal(pending.verification.label, 'Pending review');

  const rejected = accountView(user({ verification: { status: 'rejected', reason: 'The photo is blurred.' } }));
  assert.equal(rejected.verification.reason, 'The photo is blurred.');

  // A manager without a card is staff, verified for the guards, and never "Not verified" in red.
  const manager = accountView(MANAGER);
  assert.equal(manager.isManager, true);
  assert.equal(manager.isAdmin, false);
  assert.equal(manager.verified, true);
  assert.deepEqual(manager.verification.badge, { label: 'Staff', variant: 'neutral' });
  assert.deepEqual(manager.managedUnitIds, [DIC, CW]);
  assert.equal(manager.subtitle, 'Staff');

  const admin = accountView(ADMIN);
  assert.equal(admin.isAdmin && admin.isManager, true, 'an admin can open /manage too');

  // A missing or unknown status reads as not submitted; no user at all still renders.
  assert.equal(accountView(user({ verification: undefined })).verification.status, 'unsubmitted');
  assert.equal(accountView(null).name, 'User');
});

// ── /profile ──────────────────────────────────────────────────────────────────

test('Profile shows the member: details, verification, badges, and no consoles', async () => {
  const { profileKeys } = await load('/src/features/profile/api.js');
  const html = await renderProfile({ user: user(), onLogout() {} }, [
    [profileKeys.myBadges, { success: true, data: [badgeRow(), badgeRow({ _id: 'row-2', state: 'requested', status: 'requested', expiresAt: null, badge: { ...badgeRow().badge, _id: 'b2', name: '3D Printing Basics', orgUnit: { _id: 'u', name: 'Design and Innovation Centre', code: 'dic' } } })] }],
  ]);
  const shown = text(html);
  assertNoJunk(html);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(shown, /Your profile Ananya Rao student@demo\.campuscommons\.test/);
  assert.match(shown, /Member type Undergraduate \(UG\)/);
  assert.match(shown, /Department Computer Science and Engineering/);
  assert.match(shown, /ID verification Verified Your ID card is approved/);
  assert.match(html, /href="\/verification"/);
  assert.match(shown, /Electronics Lab Safety Electronics and Communication Engineering · valid until 2 Oct 2027 Active/);
  assert.match(shown, /3D Printing Basics Design and Innovation Centre Requested/);
  assert.match(html, /href="\/badges"/);
  assert.match(shown, /Log out/);
  assert.doesNotMatch(shown, /Consoles/);
  assert.doesNotMatch(html, /href="\/manage"|href="\/admin/);
  assert.doesNotMatch(shown, /strike|suspended/i);
});

test('Profile: a rejected card shows its reason and the upload link; strikes and a suspension are shown', async () => {
  const html = await renderProfile({
    user: user({
      verification: { status: 'rejected', reason: 'The photo is blurred.', submittedAt: null },
      strikes: 1,
      suspendedUntil: '2026-11-05T00:00:00.000Z',
      suspensionReason: 'Repeated no-shows',
    }),
  });
  const shown = text(html);
  assertNoJunk(html);
  assert.match(shown, /Rejected Your ID card was rejected/);
  assert.match(shown, /Reason: The photo is blurred\./);
  assert.match(shown, /Upload your ID card/);
  assert.match(shown, /suspended until 5 Nov 2026: Repeated no-shows/);
  assert.match(shown, /You have 1 strike from resolved incidents\./);

  // A suspension that has ended isn't shown.
  const ended = text(await renderProfile({ user: user({ suspendedUntil: '2026-10-01T00:00:00.000Z' }) }));
  assert.doesNotMatch(ended, /suspended/);
});

test('Profile: a manager sees the units they manage and the Manage console; an admin also the admin links', async () => {
  const unitNames = new Map([
    [DIC, 'Design and Innovation Centre'],
    [CW, 'Central Workshop'],
  ]);
  const manager = await renderProfile({ user: MANAGER, unitNames });
  const shown = text(manager);
  assertNoJunk(manager);
  assert.match(shown, /Manages Design and Innovation Centre, Central Workshop/);
  // Staff book without a card: no red "Not verified", no request to upload one.
  assert.match(shown, /ID verification Staff Managers and admins can book without an ID card\./);
  assert.doesNotMatch(shown, /Not verified|Upload your ID card|before you can book/);
  assert.match(manager, /href="\/manage"/);
  assert.doesNotMatch(manager, /href="\/admin/);

  const admin = await renderProfile({ user: ADMIN });
  for (const href of ['/manage', '/admin/verifications', '/admin/audit', '/admin/incidents']) {
    assert.match(admin, new RegExp(`href="${href}"`));
  }
});

// ── Re-reading the user ───────────────────────────────────────────────────────

test('readFreshUser stores the answer, but not after a logout that happened while it was in flight', async () => {
  const { readFreshUser } = await load('/src/features/profile/api.js');
  let answer;
  const pending = new Promise((resolve) => {
    answer = resolve;
  });
  http.defaults.adapter = async (config) => {
    assert.equal(config.url.replace(/^\/api\/v1/, ''), '/auth/me');
    await pending;
    return { data: { success: true, data: user({ name: 'Ananya R.' }), requestId: 'r' }, status: 200, statusText: '', headers: {}, config, request: {} };
  };

  signIn(user());
  const fresh = readFreshUser();
  answer();
  assert.equal((await fresh).name, 'Ananya R.');
  assert.equal(store.getState().user.name, 'Ananya R.', 'stored for the header and the guards');

  // Log out while GET /auth/me is still running: its late answer must not sign the user back in.
  let late;
  const slow = new Promise((resolve) => {
    late = resolve;
  });
  http.defaults.adapter = async (config) => {
    await slow;
    return { data: { success: true, data: user(), requestId: 'r' }, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  signIn(user());
  const racing = readFreshUser();
  store.getState().clear();
  late();
  await racing;
  assert.equal(store.getState().user, null, 'still signed out');
  assert.equal(store.getState().accessToken, null);
});

// ── The account menu ──────────────────────────────────────────────────────────

async function renderAccountPanel(who) {
  const { AccountPanel } = await load('/src/components/UserMenu.jsx');
  const { accountView } = await account();
  const { Menu, MenuItems } = await import('@headlessui/react');
  return render((React) =>
    React.createElement(
      Menu,
      null,
      React.createElement(MenuItems, { static: true }, React.createElement(AccountPanel, { view: accountView(who), onLogout() {} })),
    ),
  );
}

test('AccountPanel: Profile, ID verification with its status, Log out; the Admin console for admins only', async () => {
  const member = await renderAccountPanel(user({ verification: { status: 'pending', reason: null } }));
  assertNoJunk(member);
  assert.equal(member.match(/role="menuitem"/g)?.length, 3);
  assert.match(member, /<a[^>]*href="\/profile"[^>]*>[\s\S]*?Profile<\/a>/);
  assert.match(member, /<a[^>]*href="\/verification"[^>]*>[\s\S]*?ID verification[\s\S]*?Pending review[\s\S]*?<\/a>/);
  assert.match(member, /<button[^>]*>[\s\S]*?Log out<\/button>/);
  assert.doesNotMatch(member, /href="\/admin"/);
  // The name and email block isn't a menu item, so it is hidden from the menu's screen-reader view.
  assert.match(member, /<div aria-hidden="true"[^>]*>[\s\S]*?Ananya Rao/);

  const admin = await renderAccountPanel(ADMIN);
  assert.equal(admin.match(/role="menuitem"/g)?.length, 4);
  assert.match(admin, /<a[^>]*href="\/admin"[^>]*>[\s\S]*?Admin console<\/a>/);

  const manager = await renderAccountPanel(MANAGER);
  assert.doesNotMatch(manager, /href="\/admin"/, 'a manager has /manage in the nav, not the Admin console');
  assert.match(text(manager), /ID verification Staff/);
});

test('UserMenu: a menu button named for the user, closed until pressed', async () => {
  signIn(user());
  const { UserMenu } = await load('/src/components/UserMenu.jsx');
  const html = await render((React) => React.createElement(UserMenu));
  assert.match(html, /aria-label="Account menu for Ananya Rao"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(text(html), /AR Ananya Rao Computer Science and Engineering/);
  assert.doesNotMatch(html, /role="menu"/, 'closed until pressed');
});

test("UserMenu's stand-in while its code loads: the same face, but nothing to tab to or press", async () => {
  signIn(user());
  const { UserMenuFallback } = await load('/src/app/layouts/AppLayout.jsx');
  const html = await render((React) => React.createElement(UserMenuFallback));
  assert.match(html, /aria-label="Account: Ananya Rao"/);
  assert.match(text(html), /AR Ananya Rao/);
  assert.doesNotMatch(html, /<(?:button|a|input|select|textarea)\b/);
});
