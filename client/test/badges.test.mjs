import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
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

beforeEach(() => {
  store.getState().clear();
  Object.assign(store.getInitialState(), { accessToken: null, user: null });
});

function fakeApi(routes = {}) {
  const calls = [];
  http.defaults.adapter = async (config) => {
    const path = config.url.replace(/^\/api\/v1/, '');
    const key = `${config.method.toUpperCase()} ${path}`;
    let body = config.data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // multipart or raw text
      }
    }
    calls.push({ key, config, body, params: config.params });
    const answer = routes[key]?.(config) ?? {
      status: 404,
      code: 'NOT_FOUND',
      message: 'Not found.',
    };
    const envelope =
      answer.status < 400
        ? { success: true, data: answer.data, ...(answer.meta && { meta: answer.meta }), requestId: 'req-ok' }
        : {
            success: false,
            error: { code: answer.code, message: answer.message ?? answer.code, details: answer.details },
            requestId: 'req-err',
          };
    const response = {
      data: envelope,
      status: answer.status,
      statusText: '',
      headers: {},
      config,
      request: {},
    };
    if (answer.status < 400) return response;
    throw new AxiosError(`Request failed with status code ${answer.status}`, 'ERR_BAD_REQUEST', config, {}, response);
  };
  return calls;
}

// ── Test Data ─────────────────────────────────────────────────────────────────

const DIC = { _id: 'u-dic', name: 'Design and Innovation Centre', code: 'dic' };
const CW = { _id: 'u-cw', name: 'Central Workshop', code: 'workshop' };

const BADGE_3D = {
  _id: 'badge-3d',
  name: '3D Printing Basics',
  code: '3d-printing-basics',
  orgUnit: DIC,
  description: 'Covers slicer setups, bed levelling, and material safety for FDM printers.',
  validityDays: 365,
  evidenceRequired: false,
  selfServe: false,
};

const BADGE_LASER = {
  _id: 'badge-laser',
  name: 'Laser Cutter Safety',
  code: 'laser-cutter-safety',
  orgUnit: CW,
  description: 'Optical safety, material toxicity, and emergency power-down protocols.',
  validityDays: null,
  evidenceRequired: true,
  selfServe: false,
};

const USER_BADGE_ACTIVE = {
  _id: 'ub-1',
  badge: BADGE_3D,
  status: 'active',
  state: 'active',
  requestedAt: '2026-10-15T09:00:00.000Z',
  decidedAt: '2026-10-16T10:00:00.000Z',
  expiresAt: '2027-10-16T10:00:00.000Z',
  hasEvidence: false,
  note: 'Completed hands-on workshop with Prof. Sharma',
  reason: null,
};

const USER_BADGE_REJECTED = {
  _id: 'ub-2',
  badge: BADGE_LASER,
  status: 'rejected',
  state: 'rejected',
  requestedAt: '2026-10-18T14:00:00.000Z',
  decidedAt: '2026-10-19T11:00:00.000Z',
  expiresAt: null,
  hasEvidence: true,
  note: 'Certificate attached',
  reason: 'Certificate from outside vendor is not accredited. Please attend DIC safety session.',
};

// ── Unit Tests ────────────────────────────────────────────────────────────────

test('validityText: formats validity days correctly', async () => {
  const { validityText } = await load('/src/features/badges/badgeView.js');
  assert.equal(validityText(null), 'Never expires');
  assert.equal(validityText(undefined), 'Never expires');
  assert.equal(validityText(0), 'Never expires');
  assert.equal(validityText(365), 'Valid for 1 year');
  assert.equal(validityText(180), 'Valid for 6 months');
  assert.equal(validityText(90), 'Valid for 3 months');
  assert.equal(validityText(30), 'Valid for 1 month');
  assert.equal(validityText(14), 'Valid for 14 days');
});

test('badgeStateView: maps member states to labels and styles', async () => {
  const { badgeStateView } = await load('/src/features/badges/badgeView.js');
  assert.equal(badgeStateView('active').label, 'Active');
  assert.equal(badgeStateView('active').variant, 'forest');
  assert.equal(badgeStateView('requested').label, 'Requested');
  assert.equal(badgeStateView('requested').variant, 'gold');
  assert.equal(badgeStateView('expired').label, 'Expired');
  assert.equal(badgeStateView('expired').variant, 'slate');
  assert.equal(badgeStateView('rejected').label, 'Rejected');
  assert.equal(badgeStateView('rejected').variant, 'red');
});

test('myBadgeRows: safely unwraps cached envelopes and bare arrays', async () => {
  const { myBadgeRows } = await load('/src/features/badges/badgeView.js');
  assert.equal(myBadgeRows(null).length, 0);
  assert.equal(myBadgeRows([]).length, 0);
  assert.equal(myBadgeRows({ data: [USER_BADGE_ACTIVE] }).length, 1);
  assert.equal(myBadgeRows([USER_BADGE_ACTIVE, USER_BADGE_REJECTED]).length, 2);
});

test('mapUserBadgesByBadgeId: indexes rows by badge _id', async () => {
  const { mapUserBadgesByBadgeId } = await load('/src/features/badges/badgeView.js');
  const map = mapUserBadgesByBadgeId([USER_BADGE_ACTIVE, USER_BADGE_REJECTED]);
  assert.equal(map.get('badge-3d'), USER_BADGE_ACTIVE);
  assert.equal(map.get('badge-laser'), USER_BADGE_REJECTED);
  assert.equal(map.get('non-existent'), undefined);
});

test('filterBadges: filters by search keyword and orgUnit', async () => {
  const { filterBadges } = await load('/src/features/badges/badgeView.js');
  const list = [BADGE_3D, BADGE_LASER];

  // Search by name
  assert.equal(filterBadges(list, { search: '3d' }).length, 1);
  assert.equal(filterBadges(list, { search: '3d' })[0]._id, 'badge-3d');

  // Search by code
  assert.equal(filterBadges(list, { search: 'laser-cutter' }).length, 1);

  // Search by description keyword
  assert.equal(filterBadges(list, { search: 'optical' }).length, 1);

  // Filter by unit
  assert.equal(filterBadges(list, { orgUnit: 'u-dic' }).length, 1);
  assert.equal(filterBadges(list, { orgUnit: 'u-cw' }).length, 1);
  assert.equal(filterBadges(list, { orgUnit: 'u-other' }).length, 0);
});

test('checkEvidenceFile: validates allowed types and sizes', async () => {
  const { checkEvidenceFile } = await load('/src/features/badges/api.js');
  assert.equal(checkEvidenceFile(null), null);
  assert.equal(checkEvidenceFile({ type: 'application/pdf', size: 1024 }), null);
  assert.equal(checkEvidenceFile({ type: 'image/jpeg', size: 1024 }), null);
  assert.equal(checkEvidenceFile({ type: 'image/png', size: 1024 }), null);
  assert.equal(checkEvidenceFile({ type: 'text/plain', size: 1024 }), 'Use a JPG, PNG, WEBP or PDF file.');
  assert.equal(
    checkEvidenceFile({ type: 'application/pdf', size: 6 * 1024 * 1024 }),
    'The file must be smaller than 5 MB.'
  );
});

test('listBadges: calls GET /badges with correct params', async () => {
  const { listBadges } = await load('/src/features/badges/api.js');
  const calls = fakeApi({
    'GET /badges': (config) => ({
      status: 200,
      data: [BADGE_3D, BADGE_LASER],
    }),
  });

  const res = await listBadges({ orgUnit: 'u-dic' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'GET /badges');
  assert.equal(calls[0].params.orgUnit, 'u-dic');
  assert.equal(res.data.length, 2);
});

test('requestBadge: calls POST /badges/:id/requests', async () => {
  const { requestBadge } = await load('/src/features/badges/api.js');
  const calls = fakeApi({
    'POST /badges/badge-3d/requests': (config) => ({
      status: 201,
      data: USER_BADGE_ACTIVE,
    }),
  });

  const res = await requestBadge('badge-3d', { note: 'Trained on Ultimaker' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'POST /badges/badge-3d/requests');
  assert.equal(calls[0].body.note, 'Trained on Ultimaker');
  assert.equal(res.data._id, 'ub-1');
});

// ── Component Render Tests ────────────────────────────────────────────────────

test('BadgeCatalogueCard: renders available badge with request button', async () => {
  const { BadgeCatalogueCard } = await load('/src/features/badges/components/BadgeCatalogueCard.jsx');
  const html = renderToString(
    React.createElement(BadgeCatalogueCard, {
      badge: BADGE_3D,
      userBadge: null,
      onRequest: () => {},
    })
  );
  assert.ok(html.includes('3D Printing Basics'));
  assert.ok(html.includes('3d-printing-basics'));
  assert.ok(html.includes('Design and Innovation Centre'));
  assert.ok(html.includes('Request Badge'));
});

test('BadgeCatalogueCard: renders active credential status when user holds badge', async () => {
  const { BadgeCatalogueCard } = await load('/src/features/badges/components/BadgeCatalogueCard.jsx');
  const html = renderToString(
    React.createElement(BadgeCatalogueCard, {
      badge: BADGE_3D,
      userBadge: USER_BADGE_ACTIVE,
      onRequest: () => {},
    })
  );
  assert.ok(html.includes('Active'));
  assert.ok(html.includes('Valid until'));
});

test('MyBadgeCard: renders rejection reason and re-apply button', async () => {
  const { MyBadgeCard } = await load('/src/features/badges/components/MyBadgeCard.jsx');
  const html = renderToString(
    React.createElement(MyBadgeCard, {
      row: USER_BADGE_REJECTED,
      onRequest: () => {},
      onViewEvidence: () => {},
    })
  );
  assert.ok(html.includes('Laser Cutter Safety'));
  assert.ok(html.includes('Rejected'));
  assert.ok(html.includes('Certificate from outside vendor is not accredited'));
  assert.ok(html.includes('Re-apply for Badge'));
  assert.ok(html.includes('View Submitted Evidence'));
});

test('BadgesPage: renders without crashing or missing symbols', async () => {
  const { default: BadgesPage } = await load('/src/features/badges/BadgesPage.jsx');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['badges', 'catalogue', { orgUnit: null }], { data: [BADGE_3D, BADGE_LASER] });
  client.setQueryData(['badges', 'mine'], { data: [USER_BADGE_ACTIVE] });
  client.setQueryData(['org-units', 'active'], { data: [DIC, CW] });

  const html = renderToString(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/badges'] },
        React.createElement(BadgesPage)
      )
    )
  );

  assert.ok(html.includes('Badges &amp; Certifications'));
  assert.ok(html.includes('Badge Catalogue'));
  assert.ok(html.includes('My Badges'));
  assert.ok(html.includes('3D Printing Basics'));
  client.clear();
});

