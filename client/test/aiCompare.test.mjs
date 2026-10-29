// Tests for the AI photo comparison on the return check (frontend.md FC-13): the request, the card
// in each state, the result's wording and the error texts. Rendered with react-dom/server through
// Vite's SSR loader; requests go to a fake axios adapter. Run with `npm test`.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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

async function render(makeElement, { cache = [] } = {}) {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of cache) client.setQueryData(key, data);
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, null, makeElement(React))),
  );
}

const text = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const BOOKING = '64a0000000000000000000b1';
const photo = (n) => ({ url: `https://res.cloudinary.com/campus-test/image/upload/v1/campuscommons/photos/${n}.jpg`, publicId: `campuscommons/photos/${n}` });
const checkIn = { kind: 'condition_report', phase: 'check_in', photos: [photo('b1'), photo('b2')], items: [] };
const checkOut = { kind: 'condition_report', phase: 'check_out', photos: [photo('a1')], items: [] };
const QUOTA = { used: 1, limit: 5, remaining: 4, resetsAt: '2026-10-30T18:30:00.000Z', configured: true };

test('compareHandoverPhotos posts to POST /bookings/:id/ai-compare', async () => {
  const { compareHandoverPhotos } = await load('/src/features/bookings/api.js');
  const calls = [];
  http.defaults.adapter = async (config) => {
    calls.push(`${config.method.toUpperCase()} ${config.url.replace(/^\/api\/v1/, '')}`);
    return { data: { success: true, data: { comparison: { summary: 'x' } }, requestId: 'r' }, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  const res = await compareHandoverPhotos(BOOKING);
  assert.deepEqual(calls, [`POST /bookings/${BOOKING}/ai-compare`]);
  assert.equal(res.data.comparison.summary, 'x');
});

test('the error texts say what to do, and a used-up day offers no retry', async () => {
  const { compareErrorText, canRetryCompare, photoCount } = await load('/src/features/manage/components/aiCompareView.js');
  const daily = { status: 429, code: 'AI_QUOTA_EXCEEDED', details: { reason: 'USER_DAILY' }, message: 'Regular search still works' };
  assert.match(compareErrorText(daily), /used up; they come back at midnight/);
  assert.doesNotMatch(compareErrorText(daily), /search/i, "not the search's wording");
  assert.equal(canRetryCompare(daily), false);
  assert.match(compareErrorText({ code: 'AI_QUOTA_EXCEEDED', details: { reason: 'BURST' } }), /Wait a few seconds/);
  assert.equal(canRetryCompare({ status: 429, code: 'AI_QUOTA_EXCEEDED', details: { reason: 'BURST' } }), true);
  assert.match(compareErrorText({ code: 'AI_UNAVAILABLE', message: 'AI is paused. Regular search still works.' }), /can’t compare the photos right now/);
  assert.equal(
    compareErrorText({ code: 'AI_UNAVAILABLE', message: "The handover photos couldn't be loaded for the comparison. Compare them yourself." }),
    "The handover photos couldn't be loaded for the comparison. Compare them yourself.",
  );
  assert.equal(compareErrorText({ status: 409, code: 'CONFLICT', message: 'A comparison needs photos at both handovers.' }), 'A comparison needs photos at both handovers.');
  assert.equal(canRetryCompare({ status: 409, code: 'CONFLICT' }), false, 'a 409 needs the page to change first');
  assert.equal(canRetryCompare({ status: 403, code: 'FORBIDDEN' }), false);
  assert.equal(canRetryCompare({ status: 503, code: 'AI_UNAVAILABLE' }), true);
  assert.equal(canRetryCompare({ status: 0, code: 'UNKNOWN' }), true, 'a network failure');
  assert.equal(photoCount({ photos: [{ publicId: '' }, { publicId: 'x' }] }), 1);
  assert.equal(photoCount(checkIn), 2);
  assert.equal(photoCount(null), 0);
});

test('the card: offered once the item is back with photos at both handovers, with the quota and what is sent', async () => {
  const { AiCompareCard } = await load('/src/features/manage/components/AiCompareCard.jsx');
  const { aiKeys } = await load('/src/features/ai/api.js');
  const cache = [[aiKeys.quota, { data: QUOTA }]];
  const card = (props) => render((React) => React.createElement(AiCompareCard, { bookingId: BOOKING, checkIn, checkOut, ...props }), { cache });

  assert.equal(await card({ status: 'checked_in' }), '', 'not before the return');
  const offered = text(await card({ status: 'checked_out' }));
  assert.match(offered, /Compare the photos with AI/);
  assert.match(offered, /Google Gemini looks at the 2 pickup and 1 return photo and lists what looks different\. Only the photos and the checklist labels are sent, not the borrower's name, notes or email\. On Gemini's free tier Google may keep and review the photos\./);
  assert.match(offered, /Compare with AI/);
  assert.match(offered, /4 of 5 AI requests left today/);
  const noPhotos = text(await card({ status: 'completed', checkOut: { ...checkOut, photos: [] } }));
  assert.match(noPhotos, /needs photos at both handovers; this booking has none at return/);
  const managerPhotos = text(
    await card({ status: 'completed', checkOut: { ...checkOut, photos: [] }, returnCheck: { phase: 'return_confirmation', photos: [photo('m1')] } }),
  );
  assert.match(managerPhotos, /looks at the 2 pickup and 1 return photo/, "the manager's photos stand in");
  assert.doesNotMatch(noPhotos, /Compare with AI/);
  const off = text(
    await render((React) => React.createElement(AiCompareCard, { bookingId: BOOKING, status: 'flagged', checkIn, checkOut }), {
      cache: [[aiKeys.quota, { data: { ...QUOTA, configured: false } }]],
    }),
  );
  assert.match(off, /AI isn't set up on this server yet/);
});

test('the result: labelled a suggestion, with the verdict, each difference and the Report issue hint', async () => {
  const { AiCompareResult } = await load('/src/features/manage/components/AiCompareCard.jsx');
  const result = {
    comparison: {
      summary: 'The build plate has a new scratch.',
      comparable: true,
      newDamageLikely: true,
      differences: [
        { description: 'Scratch across the plate', severity: 'major', checklistItem: 'Build plate undamaged' },
        { description: 'Slightly dustier', severity: 'none', checklistItem: null },
      ],
    },
    photos: { before: 2, after: 1 },
    cached: true,
    generatedAt: '2026-11-03T06:35:00.000Z',
  };
  const t = text(await render((React) => React.createElement(AiCompareResult, { result, showForm: true })));
  assert.match(t, /AI suggestion: photo comparison/);
  assert.match(t, /Possible new damage/);
  assert.match(t, /The build plate has a new scratch\./);
  assert.match(t, /Major Scratch across the plate \(checklist: Build plate undamaged\)/);
  assert.match(t, /No change Slightly dustier/);
  assert.match(t, /If you agree after looking at the photos, choose “Report issue” in your check below\./);
  assert.match(t, /Gemini compared 2 pickup and 1 return photo on .* IST \(compared before: no AI request used\)\. It can miss damage/);
  assert.match(t, /a person decides/);

  const unclear = text(
    await render((React) =>
      React.createElement(AiCompareResult, {
        result: { ...result, comparison: { summary: 'The return photo shows another item.', comparable: false, newDamageLikely: false, differences: [] } },
        showForm: true,
      }),
    ),
  );
  assert.match(unclear, /Couldn't compare/);
  assert.doesNotMatch(unclear, /No new damage spotted|Report issue/);

  const calm = text(
    await render((React) =>
      React.createElement(AiCompareResult, { result: { ...result, comparison: { summary: 'Same.', comparable: true, newDamageLikely: false, differences: [] } } }),
    ),
  );
  assert.match(calm, /No new damage spotted/);
  assert.match(calm, /Gemini listed no differences\./);
  assert.doesNotMatch(calm, /Report issue/);
});
