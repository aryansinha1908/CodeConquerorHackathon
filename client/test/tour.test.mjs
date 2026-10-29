// Tests for the guided tour (features/tour) and the public "How it works" page (pages/HowItWorksPage):
// which tour a route gets, that every step's data-tour target exists in the source, that missing targets
// are skipped, and that the page renders its rules without calling the API. Run with `npm test`.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let load;

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
});

after(async () => {
  await server?.close();
});

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(jsx?|mjs)$/.test(name) ? [readFileSync(path, 'utf8')] : [];
  });
}

async function render(makeElement, path = '/') {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  return renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [path] }, makeElement(React)));
}

const text = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('tourFor: each page with a tour gets its own, and sub-pages without one get none', async () => {
  const { tourFor } = await load('/src/features/tour/tours.js');
  const cases = {
    '/explore': 'explore',
    '/resources/64a000000000000000000001': 'resource',
    '/bookings': 'bookings',
    '/bookings/64a000000000000000000002': 'booking',
    '/manage': 'dashboard',
    '/manage/requests': 'requests',
    '/manage/handovers': 'handovers',
    '/manage/returns/64a000000000000000000003': 'return',
    '/admin/verifications': 'verifications',
  };
  for (const [path, id] of Object.entries(cases)) assert.equal(tourFor(path)?.id, id, path);
  for (const path of ['/bookings/x/check-in', '/badges', '/', '/profile', '/how-it-works']) {
    assert.equal(tourFor(path), null, path);
  }
});

test('every tour step points at a data-tour attribute that exists in the code', async () => {
  const { tourTargets } = await load('/src/features/tour/tours.js');
  const code = sources(join(root, 'src')).join('\n');
  // HandoverSection builds its id from sectionId: data-tour={`handovers-${sectionId}`}.
  const handoverIds = [...code.matchAll(/sectionId="(\w+)"/g)].map((m) => `handovers-${m[1]}`);
  for (const target of tourTargets()) {
    const found = code.includes(`data-tour="${target}"`) || handoverIds.includes(target);
    assert.ok(found, `no element has data-tour="${target}"`);
  }
});

test('presentSteps drops steps whose target is missing, keeps centred notes, and escapes the text', async () => {
  const { presentSteps } = await load('/src/features/tour/runTour.js');
  const tour = {
    steps: [
      { title: 'Intro', text: 'Centred' },
      { target: 'here', title: 'Here', text: 'Shown <b>bold</b> & "quoted"' },
      { target: 'gone', title: 'Gone', text: 'Skipped' },
    ],
  };
  const steps = presentSteps(tour, (target) => target === 'here');
  assert.equal(steps.length, 2);
  assert.equal(steps[0].element, undefined);
  // A selector, not a node, so an element that re-renders between steps is found again.
  assert.equal(steps[1].element, '[data-tour="here"]');
  // driver.js renders these as HTML: they arrive escaped.
  assert.equal(steps[1].popover.description, 'Shown &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
  assert.deepEqual(presentSteps({ steps: [{ target: 'gone', title: 'x', text: 'y' }] }, () => false), []);
});

test('HowItWorksPage explains the rules, with the numbers the server uses, and links into the app', async () => {
  const { default: HowItWorksPage } = await load('/src/pages/HowItWorksPage.jsx');
  const html = await render((React) => React.createElement(HowItWorksPage), '/how-it-works');
  const shown = text(html);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(shown, /Fair, explained and checked by people/);
  // The 12 eligibility checks, in an ordered list.
  const rules = html.slice(html.indexOf('<ol'), html.indexOf('</ol>'));
  assert.equal((rules.match(/<li/g) ?? []).length, 12);
  assert.match(shown, /Check-in opens 15 minutes before the start/);
  assert.match(shown, /15 minutes after the start, the booking becomes a no-show/);
  assert.match(shown, /never receives ID cards, names, emails or roll numbers/);
  assert.match(html, /href="\/explore"/);
  assert.match(html, /href="\/login"/);
});

test('the header has the tour button, and the account menu links to How it works', async () => {
  const { tourFor } = await load('/src/features/tour/tours.js');
  assert.ok(tourFor('/explore'));
  const { TourButton } = await load('/src/features/tour/TourButton.jsx');
  const html = await render((React) => React.createElement(TourButton), '/explore');
  assert.match(html, /aria-label="Take the tour of Explore"/);
  assert.match(html, /data-tour="header-tour"/);
  const none = await render((React) => React.createElement(TourButton), '/profile');
  assert.match(none, /aria-label="Take a tour"/);

  const { AccountPanel } = await load('/src/components/UserMenu.jsx');
  const { accountView } = await load('/src/features/profile/account.js');
  const { Menu, MenuItems } = await import('@headlessui/react');
  const panel = await render((React) =>
    React.createElement(
      Menu,
      null,
      React.createElement(MenuItems, { static: true }, React.createElement(AccountPanel, { view: accountView({ name: 'A B', email: 'a@b.c', roles: ['member'] }) })),
    ),
  );
  assert.match(panel, /href="\/how-it-works"[^>]*>[\s\S]*?How it works/);
});
