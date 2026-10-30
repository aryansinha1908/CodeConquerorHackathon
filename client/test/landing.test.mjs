// Tests for the landing page at `/` (open to everyone) and the ShareX name: the public layout, the
// home page signed out (no API call, a sign-in panel instead of the inventory), and the layout
// chosen by whether there's a session. Rendered with react-dom/server through Vite's SSR loader;
// requests go to a fake axios adapter. Run with `npm test`.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let load;
let http;
let calls;

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

beforeEach(async () => {
  calls = [];
  http.defaults.adapter = async (config) => {
    calls.push(`${config.method.toUpperCase()} ${config.url.replace(/^\/api\/v1/, '')}`);
    return { data: { success: true, data: [], meta: { page: 1, limit: 6, total: 0 }, requestId: 'r' }, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  const { useAuthStore } = await load('/src/stores/auth.js');
  useAuthStore.getState().clear();
  // Server rendering reads the store's initial state (zustand's server snapshot).
  Object.assign(useAuthStore.getInitialState(), { accessToken: null, user: null });
});

async function render(makeElement, path = '/') {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter, Routes, Route } = await import('react-router-dom');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(Routes, null, React.createElement(Route, { path: '/', element: makeElement(React) }, React.createElement(Route, { index: true, element: React.createElement('p', null, 'PAGE') })))
      )
    )
  );
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('signed out, `/` is the public layout: the ShareX brand, How it works, Log in and Sign up, and the page', async () => {
  const { HomeLayout } = await load('/src/app/layouts/HomeLayout.jsx');
  const html = await render((React) => React.createElement(HomeLayout));
  const t = text(html);
  assert.match(t, /SX NIT Jamshedpur ShareX/);
  assert.match(html, /href="\/login"[^>]*>.*?Log in/s);
  assert.match(html, /href="\/register"[^>]*>.*?Sign up/s);
  assert.match(t, /How it works/);
  assert.match(t, /PAGE/, 'the page renders in it');
  assert.match(t, /SHAREX \/\/ NIT JAMSHEDPUR/, 'the footer');
  assert.doesNotMatch(html, /Notifications|aria-label="Account menu"/, 'no bell or account menu for a visitor');
});

test("signed in, `/` keeps the app's layout", async () => {
  const { useAuthStore } = await load('/src/stores/auth.js');
  const user = { _id: 'u1', name: 'Ananya Rao', email: 'student@demo.campuscommons.test', roles: ['member'], verification: { status: 'approved' } };
  useAuthStore.getState().setSession('token', user);
  Object.assign(useAuthStore.getInitialState(), { accessToken: 'token', user });
  const { HomeLayout } = await load('/src/app/layouts/HomeLayout.jsx');
  const t = text(await render((React) => React.createElement(HomeLayout)));
  assert.match(t, /Explore/);
  assert.match(t, /Ananya Rao|AR/);
  assert.doesNotMatch(t, /Sign up/);
});

test('the home page signed out: no API call, and a sign-in panel where the inventory would be', async () => {
  const { default: HomePage } = await load('/src/pages/HomePage.jsx');
  const t = text(await render((React) => React.createElement(HomePage)));
  assert.deepEqual(calls, [], 'the catalogue needs an account: nothing is fetched');
  assert.match(t, /Sign in to see what you can book/);
  assert.match(t, /Create an account/);
  assert.match(t, /How ShareX takes the friction out of booking/);
  assert.doesNotMatch(t, /All Types/, 'no category filter for a visitor');
});

test('the name is ShareX: page title, favicon, sign-in screens', async () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<title>ShareX — NIT JSR Resource Sharing<\/title>/);
  assert.match(readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8'), />SX<\/text>/);
  const { AuthLayout } = await load('/src/features/auth/AuthLayout.jsx');
  const t = text(await render((React) => React.createElement(AuthLayout, { title: 'Log in' }, React.createElement('p', null, 'form'))));
  assert.match(t, /SX NIT Jamshedpur ShareX/);
  assert.doesNotMatch(t, /CampusCommons/i);
});

// ── The richer home page ───────────────────────────────────────────────────────

test('the home page has every section, readable without animation, and makes no claim it can’t back', async () => {
  const { default: HomePage } = await load('/src/pages/HomePage.jsx');
  const html = await render((React) => React.createElement(HomePage));
  const t = text(html);
  assert.deepEqual(calls, [], 'still nothing fetched for a visitor');
  for (const heading of [
    'Book campus',
    'Jump right in',
    'A few resources to start with',
    'Booking that explains itself',
    'How ShareX takes the friction out of booking',
    'One place for borrowers and the units that lend',
    'Participating NIT Jamshedpur units',
    'From a club project to a final-year lab',
    'Good to know',
    'Ready when your project is.',
  ]) {
    assert.ok(t.includes(heading), heading);
  }
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  // Screen readers get the rotating words and the counted numbers whole.
  assert.match(t, /3D printers, oscilloscopes, GPU workstations, meeting rooms, camera drones, lathes/);
  for (const n of ['18', '12', '15', '2']) assert.match(html, new RegExp(`class="sr-only">${n}</span>`));
  // The marquee's copies are hidden, so each unit is read once.
  assert.equal((html.match(/aria-hidden="true"[^>]*class="flex shrink-0 items-stretch/g) ?? []).length, 2);
  // Every lifecycle step, in order.
  for (const step of ['Join and verify', 'Find and check', 'Request', 'Pick up', 'Return', 'Settle']) assert.ok(t.includes(step), step);
  // The old copy's claims are gone.
  assert.doesNotMatch(t, /40\+|100%|5-axis|NVIDIA GPU clusters/);
});

test('everything that loops can be paused: one switch, off at first, that stops the marquee', async () => {
  const { default: React } = await import('react');
  const { default: HomePage } = await load('/src/pages/HomePage.jsx');
  const html = await render((R) => R.createElement(HomePage));
  assert.equal((html.match(/aria-pressed="false"[^>]*>.*?Pause<span class="sr-only sm:not-sr-only"> animations/gs) ?? []).length, 1);
  assert.doesNotMatch(html, /[ "]\[animation-play-state:paused\]/, 'nothing paused yet (hover and focus aside)');

  const { UnitMarquee } = await load('/src/features/home/FactsSection.jsx');
  const { MotionPauseContext } = await load('/src/features/home/motionPause.js');
  const paused = await render(() =>
    React.createElement(MotionPauseContext.Provider, { value: { paused: true, setPaused() {} } }, React.createElement(UnitMarquee))
  );
  assert.match(paused, /aria-pressed="true"/);
  assert.equal((paused.match(/[ "]\[animation-play-state:paused\]/g) ?? []).length, 3, 'each copy of the marquee stands still');
});

test('the FAQ is an accordion: one answer open, each question a button that says so', async () => {
  const { FaqSection } = await load('/src/features/home/FaqSection.jsx');
  const html = await render((React) => React.createElement(FaqSection));
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 5);
  const [, controls] = html.match(/aria-expanded="true" aria-controls="([^"]+)"/) ?? [];
  assert.ok(controls && html.includes(`id="${controls}"`), 'the open answer is the region the button controls');
  assert.match(text(html), /Anyone with an @nitjsr.ac.in email: students, research scholars, faculty and staff/);
  assert.doesNotMatch(text(html), /Only administrators can open it/, 'the closed answers are not in the page');
});

test('the calls to action follow the session: sign up for a visitor, explore for a member', async () => {
  const { CtaSection } = await load('/src/features/home/CtaSection.jsx');
  const out = await render((React) => React.createElement(CtaSection, { user: null }));
  assert.match(out, /href="\/register"[^>]*>.*?Create your account/s);
  assert.match(out, /href="\/login"/);
  const member = await render((React) => React.createElement(CtaSection, { user: { _id: 'u1' } }));
  assert.match(member, /href="\/explore"[^>]*>.*?Explore resources/s);
  assert.match(member, /href="\/bookings"/);
  assert.doesNotMatch(member, /\/register/);
});
