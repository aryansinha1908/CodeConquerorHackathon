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
  assert.match(t, /How ShareX Eliminates Booking Friction/);
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
