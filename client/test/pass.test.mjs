// Tests for the QR booking pass (frontend.md FC-05): the borrower's pass card, the manager's scan page
// and their helpers. Rendered with react-dom/server through Vite's SSR loader; requests go to a fake
// axios adapter. Run with `npm test`.
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

function fakeApi(routes) {
  const calls = [];
  http.defaults.adapter = async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url.replace(/^\/api\/v1/, '')}`;
    calls.push({ key, body: config.data ? JSON.parse(config.data) : undefined });
    const data = routes[key]?.();
    return { data: { success: true, data, requestId: 'r' }, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return calls;
}

async function render(makeElement, path = '/') {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, { initialEntries: [path] }, makeElement(React))),
  );
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const BOOKING = '64a0000000000000000000b1';

test('getBookingPass and scanBookingPass call the documented routes', async () => {
  const api = await load('/src/features/bookings/api.js');
  const calls = fakeApi({
    [`POST /bookings/${BOOKING}/pass`]: () => ({ token: 'cc1.x', code: 'ABC23D', expiresAt: '2026-11-02T05:00:00Z', phase: 'pickup' }),
    [`GET /bookings/${BOOKING}/pass`]: () => ({ phase: 'pickup', verifiedAt: null }),
    'POST /bookings/scan': () => ({ phase: 'pickup', next: 'check_in' }),
  });
  assert.equal((await api.getBookingPass(BOOKING)).data.code, 'ABC23D');
  assert.equal((await api.getPassStatus(BOOKING)).data.verifiedAt, null);
  await api.scanBookingPass({ code: 'ABC23D' });
  assert.deepEqual(calls.map((c) => c.key), [`POST /bookings/${BOOKING}/pass`, `GET /bookings/${BOOKING}/pass`, 'POST /bookings/scan']);
  assert.deepEqual(calls[2].body, { code: 'ABC23D' });
  assert.equal(api.PASS_REFRESH_MS, 60_000, 'well inside the server pass lifetime of 2 minutes');
  assert.equal(api.PASS_STATUS_POLL_MS, 15_000);
});

test('passSecondsLeft counts down by the server clock, whatever the phone clock says', async () => {
  const { passSecondsLeft } = await load('/src/features/bookings/components/passView.js');
  const pass = { issuedAt: '2026-11-02T04:30:00.000Z', expiresAt: '2026-11-02T04:32:00.000Z' };
  // The phone's clock is 2 minutes fast: received "at 04:32" by its clock, it still has 120 s.
  const received = Date.parse('2026-11-02T04:32:00.000Z');
  assert.equal(passSecondsLeft(pass, received, received), 120);
  assert.equal(passSecondsLeft(pass, received, received + 45_000), 75);
  assert.equal(passSecondsLeft(pass, received, received + 200_000), 0);
  assert.equal(passSecondsLeft({}, received, received), null);
  assert.equal(passSecondsLeft(pass, 0, received), null);
});

test('PassCard: the borrower sees a button for their pickup or return pass; the QR loads only once opened', async () => {
  const { PassCard } = await load('/src/features/bookings/components/PassCard.jsx');
  const { PASS_STATUSES } = await load('/src/features/bookings/components/passView.js');
  assert.deepEqual(PASS_STATUSES, ['approved', 'checked_in', 'checked_out']);
  const pickup = text(await render((React) => React.createElement(PassCard, { booking: { _id: BOOKING, status: 'approved' }, title: 'FDM 3D Printer' })));
  assert.match(pickup, /Your pickup pass Show my pass/);
  const ret = text(await render((React) => React.createElement(PassCard, { booking: { _id: BOOKING, status: 'checked_in' }, title: 'FDM 3D Printer' })));
  assert.match(ret, /Your return pass/);
});

test('cameraAdvice turns camera errors into what to do', async () => {
  const { cameraAdvice } = await load('/src/features/manage/components/scanView.js');
  assert.match(cameraAdvice({ name: 'NotAllowedError' }), /refused the camera/);
  assert.match(cameraAdvice({ name: 'NotReadableError' }), /Another app is using the camera/);
  assert.match(cameraAdvice({ name: 'NotFoundError' }), /No camera was found/);
  assert.match(cameraAdvice('Camera not found.'), /No camera was found/);
  assert.match(cameraAdvice(new Error('Camera access is only permitted in secure context')), /secure \(https\)/);
  assert.match(cameraAdvice(new Error('???')), /couldn't start/);
});

test('cameraPreflight surfaces the real reason before qr-scanner hides it', async () => {
  const { cameraPreflight } = await load('/src/features/manage/components/scanView.js');
  assert.match(await cameraPreflight({ isSecureContext: false }), /secure \(https\)/);
  assert.match(await cameraPreflight({ isSecureContext: true, mediaDevices: undefined }), /can't use a camera/);
  const refuse = (name) => ({ isSecureContext: true, mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error(name), { name }); } } });
  assert.match(await cameraPreflight(refuse('NotAllowedError')), /refused the camera/);
  assert.match(await cameraPreflight(refuse('NotReadableError')), /Another app/);
  let stopped = 0;
  const ok = { isSecureContext: true, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } };
  assert.equal(await cameraPreflight(ok), null);
  assert.equal(stopped, 1, 'the test stream is released before qr-scanner opens its own');
});

test('isPassText keeps scanning past other QR codes, and cleanCode accepts what people type', async () => {
  const { cleanCode, isPassText } = await load('/src/features/manage/components/scanView.js');
  assert.equal(isPassText('cc1.64a0000000000000000000b1.1793274295.AAAAAAAAAAAAAAAAAAAAAA'), true);
  assert.equal(isPassText('https://example.com'), false);
  assert.equal(isPassText(''), false);
  assert.equal(cleanCode('k7q - 2mx'), 'K7Q2MX');
  assert.equal(cleanCode('K7Q2MXZZ'), 'K7Q2MX');
});

test('ScanResult: the verified borrower and slot, and the next step for each phase', async () => {
  const { ScanResult } = await load('/src/features/manage/ScanPage.jsx');
  const booking = {
    _id: BOOKING,
    status: 'approved',
    start: '2026-11-02T04:30:00Z',
    end: '2026-11-02T06:30:00Z',
    resource: { title: 'FDM 3D Printer' },
    borrower: { name: 'Ananya Rao', memberType: 'ug', department: { name: 'Computer Science and Engineering' } },
  };
  const pickup = await render((React) => React.createElement(ScanResult, { result: { booking, phase: 'pickup', next: 'check_in' }, onReset() {} }));
  assert.match(text(pickup), /Pickup pass verified/);
  assert.match(text(pickup), /Ananya Rao Undergraduate \(UG\) · Computer Science and Engineering/);
  assert.match(text(pickup), /FDM 3D Printer/);
  assert.match(pickup, new RegExp(`href="/bookings/${BOOKING}/check-in"`));

  const out = await render((React) => React.createElement(ScanResult, { result: { booking: { ...booking, status: 'checked_in' }, phase: 'return', next: 'check_out' }, onReset() {} }));
  assert.match(text(out), /Return pass verified/);
  assert.match(out, new RegExp(`href="/bookings/${BOOKING}/check-out"`));

  const back = await render((React) => React.createElement(ScanResult, { result: { booking: { ...booking, status: 'checked_out' }, phase: 'return', next: 'confirm_return' }, onReset() {} }));
  assert.match(back, new RegExp(`href="/manage/returns/${BOOKING}"`));

  // A repeat scan, a late return, and an admin with no next step of their own.
  const late = text(await render((React) => React.createElement(ScanResult, { result: { booking: { ...booking, status: 'checked_in' }, phase: 'return', next: null, isOverdue: true, recorded: false }, onReset() {} })));
  assert.match(late, /Already recorded on the booking’s history\. Check their college ID against this name\./);
  assert.match(late, /This return is late/);
  assert.match(late, /The next step is for the borrower or one of the unit's managers/);
});

test('ScanPage: the camera and the typed code, with labels', async () => {
  const { default: ScanPage } = await load('/src/features/manage/ScanPage.jsx');
  const html = await render((React) => React.createElement(ScanPage), '/manage/scan');
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(text(html), /Scan a booking pass/);
  assert.match(text(html), /Start the camera/);
  assert.match(html, /<label[^>]*for="([^"]+)"[^>]*>The 6 characters under the QR<\/label>[\s\S]*<input[^>]*id="\1"/);
  assert.match(html, /<video[^>]*playsinline/i);
});
