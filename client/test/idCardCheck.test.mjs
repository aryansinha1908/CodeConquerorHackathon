// Tests for the on-device ID-card check (frontend.md FC-12): the scoring of what OCR read, what goes
// with the upload, and the member's and admin's views. Tesseract itself isn't run here (the browser
// check covers it). Rendered with react-dom/server through Vite's SSR loader. Run with `npm test`.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
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

const check = () => load('/src/features/verification/idCardCheck.js');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const render = async (make) => {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(make(React));
};

const KABIR = { email: '2024ugcs999@nitjsr.ac.in', name: 'Kabir Singh', emailHints: { year: 2024, level: 'ug', branch: 'cs', serial: '999' } };
// What Tesseract makes of a typical card: line breaks, stray marks, an O for a 0 and an l for an I.
const CARD = `NATIONAL INSTITUTE OF TECHNOLOGY
JAMSHEDPUR - 831014
STUDENT IDENTITY CARD
Name : KABIR SlNGH
Roll No. : 2O24UGCS999 |
Programme: B.Tech (CSE)  Session 2024-28`;
const passed = (result) => Object.fromEntries(result.checks.map((c) => [c.id, c.passed]));

test("the member's own card passes every check, with OCR's usual look-alike characters", async () => {
  const { scoreIdCard } = await check();
  const result = scoreIdCard({ text: CARD, ...KABIR, now: new Date('2026-10-30') });
  assert.equal(result.readable, true);
  assert.deepEqual(passed(result), { institute: true, rollNumber: true, name: true, year: true });
  assert.equal(result.score, 4);
  assert.equal(result.total, 4);
  assert.equal(result.checks.find((c) => c.id === 'rollNumber').label, 'The roll number (2024UGCS999)');
});

test("someone else's card fails the roll number and the name", async () => {
  const { scoreIdCard } = await check();
  const other = CARD.replace('KABIR SlNGH', 'ISHITA PAUL').replace('2O24UGCS999', '2024UGCS123');
  const result = scoreIdCard({ text: other, ...KABIR });
  assert.deepEqual(passed(result), { institute: true, rollNumber: false, name: false, year: true });
  assert.equal(result.score, 2);
  const wrongYear = scoreIdCard({ text: CARD.replace('Session 2024-28', 'Session 2019-23').replace('2O24UGCS999', '2019UGCS999'), ...KABIR });
  assert.equal(passed(wrongYear).year, false, 'the admission year from the email must be on the card');
  const elsewhere = scoreIdCard({ text: CARD.replace('NATIONAL INSTITUTE OF TECHNOLOGY\nJAMSHEDPUR', 'SOME OTHER COLLEGE\nRANCHI'), ...KABIR });
  assert.equal(passed(elsewhere).institute, false);
});

test("a staff address has no roll number to look for, so it isn't counted", async () => {
  const { scoreIdCard, rollNumberOf } = await check();
  assert.equal(rollNumberOf('registrar@nitjsr.ac.in'), null);
  assert.equal(rollNumberOf('2025UGCS070@nitjsr.ac.in'), '2025UGCS070');
  const staff = scoreIdCard({
    text: 'NIT JAMSHEDPUR\nEMPLOYEE ID CARD\nDR. MEERA IYER\nValid till 2030',
    email: 'meera.iyer@nitjsr.ac.in',
    name: 'Dr. Meera Iyer',
    now: new Date('2026-10-30'),
  });
  assert.deepEqual(passed(staff), { institute: true, name: true, year: true });
  assert.equal(staff.total, 3);
  assert.match(staff.checks.find((c) => c.id === 'year').label, /^A recent year/);
});

test('nothing readable: every check fails and the result says so', async () => {
  const { scoreIdCard } = await check();
  const blurry = scoreIdCard({ text: ' ~ | . 1 ', ...KABIR });
  assert.equal(blurry.readable, false);
  assert.equal(blurry.score, 0);
  assert.equal(scoreIdCard({ text: undefined, ...KABIR }).readable, false);
});

test('only the yes/no answers go with the upload, never the text', async () => {
  const { scoreIdCard, ocrCheckField } = await check();
  const field = ocrCheckField(scoreIdCard({ text: CARD, ...KABIR }));
  assert.deepEqual(JSON.parse(field), { v: 1, checks: { institute: true, rollNumber: true, name: true, year: true } });
  assert.equal(/KABIR|2024UGCS|JAMSHEDPUR/i.test(field), false);
  assert.equal(ocrCheckField(null), null);
});

test("the member's panel: reading, the result with hints, a PDF, and a check that couldn't run", async () => {
  const { MemberDeviceCheck } = await load('/src/features/verification/DeviceCheck.jsx');
  const { scoreIdCard } = await check();
  const result = scoreIdCard({ text: CARD.replace('KABIR SlNGH', 'ISHITA PAUL'), ...KABIR });
  const done = text(await render((React) => React.createElement(MemberDeviceCheck, { check: { status: 'done', result } })));
  assert.match(done, /Device check 3\/4/);
  assert.match(done, /Not found: The account’s name \(Kabir Singh\) The name on the card should match/);
  assert.match(done, /only the yes\/no answers go with your upload\. It's a hint for you and the administrator, not a decision/);
  const running = text(await render((React) => React.createElement(MemberDeviceCheck, { check: { status: 'running', progress: 0.42 } })));
  assert.match(running, /Reading the card… 42%/);
  const pdf = text(await render((React) => React.createElement(MemberDeviceCheck, { check: { status: 'idle' }, pdf: true })));
  assert.match(pdf, /PDFs aren't checked on your device/);
  const failed = text(await render((React) => React.createElement(MemberDeviceCheck, { check: { status: 'failed' } })));
  assert.match(failed, /couldn't run on this device\. It's optional: you can still submit/);
  assert.equal(text(await render((React) => React.createElement(MemberDeviceCheck, { check: { status: 'idle' } }))), '', 'nothing shown, only an empty live region kept ready');
});

test("the admin's queue shows the member's device check as a hint", async () => {
  const { StoredDeviceCheck } = await load('/src/features/verification/DeviceCheck.jsx');
  const t = text(
    await render((React) =>
      React.createElement(StoredDeviceCheck, { ocrCheck: { checks: { institute: true, rollNumber: false, year: true }, score: 2, total: 3 } }),
    ),
  );
  assert.match(t, /Device check 2\/3/);
  assert.match(t, /Found: Institute’s name Not found: Roll number from the email Found: Year/);
  assert.match(t, /Reported by the member's browser: a hint, not proof\./);
  assert.equal(await render((React) => React.createElement(StoredDeviceCheck, { ocrCheck: null })), '');
});

test('the upload form puts the answers before the file, and leaves them out when there are none', async () => {
  const { buildIdCardForm } = await load('/src/features/verification/api.js');
  const file = new File(['x'], 'card.png', { type: 'image/png' });
  const withCheck = buildIdCardForm({ file, memberType: 'ug', department: 'd1', ocrCheck: '{"v":1,"checks":{"institute":true}}' });
  assert.deepEqual([...withCheck.keys()], ['memberType', 'department', 'ocrCheck', 'idCard']);
  assert.deepEqual([...buildIdCardForm({ file, memberType: 'ug', department: 'd1' }).keys()], ['memberType', 'department', 'idCard']);
});

// ── Realistic OCR (the review's cases) ─────────────────────────────────────────

test('a tilted or blurred photo still finds the institute; another NIT does not', async () => {
  const { scoreIdCard } = await check();
  const pass = (text, who = KABIR) => Object.fromEntries(scoreIdCard({ text, ...who }).checks.map((c) => [c.id, c.passed]));
  assert.equal(pass('NATION, INSTITYTE OF TECHNOLogy\nJAMSHEDpPyR\nKABIR SINGH 2024UGCS999').institute, true, 'tilted');
  assert.equal(pass('NATIONAL INSTITUTE OF TEOMNOLOGY JAMSHEDPUR\nKABIR SINGH').institute, true, 'blurred');
  assert.equal(pass('NATIONAL lNSTITUTE OF TECHN0LOGY, JAMSHEDPUR').institute, true, 'one slip');
  assert.equal(pass('NATIONAL INSTITUTE OF TECHNOLOGY ROURKELA\nKABIR SINGH').institute, false, 'another NIT');
});

test("the roll number allows OCR's look-alikes and a split, but not a longer number", async () => {
  const { scoreIdCard } = await check();
  const roll = (text, email = KABIR.email) =>
    scoreIdCard({ text: `NIT JAMSHEDPUR\n${text}`, ...KABIR, email }).checks.find((c) => c.id === 'rollNumber').passed;
  assert.equal(roll('Roll No 2024UGCS123'), false, 'another number');
  assert.equal(roll('Roll No 2024UGCggg9'), true, 'S read as G, the 9s as g');
  assert.equal(roll('Roll No 2024UGCggg'), true, '9 read as g, one letter lost');
  assert.equal(roll('Roll: 2024 UGCS 999'), true, 'split across words');
  assert.equal(roll('RollNo2024UGCS999'), true, 'glued to its label');
  assert.equal(roll('Roll No 2024UGCS070', '2024ugcs07@nitjsr.ac.in'), false, "a longer number isn't a match");
});

test('names: initials for middle names, titles ignored, typos in short words, merged words', async () => {
  const { scoreIdCard } = await check();
  const named = (text, name) =>
    scoreIdCard({ text: `NIT JAMSHEDPUR\n${text}`, email: 'x.y@nitjsr.ac.in', name }).checks.find((c) => c.id === 'name').passed;
  assert.equal(named('ARYAN K. SINHA', 'Aryan Kumar Sinha'), true);
  assert.equal(named('Dr. R.K. SINGH', 'Prof. R. K. Singh'), true);
  assert.equal(named('RAVl JAlN', 'Ravi Jain'), true);
  assert.equal(named('ARYANSINHA', 'Aryan Sinha'), true);
  assert.equal(named('MOHAN GUPTA', 'Rohan Gupta'), false, 'another person');
  assert.equal(named('K. SINGH', 'Kabir Singh'), false, 'the first name must be there, not just its initial');
});

test("the year: the admission year, the session's short form, a validity date, or the roll number's own", async () => {
  const { scoreIdCard } = await check();
  const year = (text) => scoreIdCard({ text: `NATIONAL INSTITUTE OF TECHNOLOGY JAMSHEDPUR\nKABIR SINGH\n${text}`, ...KABIR, now: new Date('2026-10-30') }).checks.find((c) => c.id === 'year').passed;
  assert.equal(year('Session 24-28'), true);
  assert.equal(year('Valid upto 31/07/2028'), true);
  assert.equal(year('Roll No 2024UGCS999'), true, 'the roll number carries the year');
  assert.equal(year('Session 2019-23'), false);
  const staff = scoreIdCard({ text: 'NIT JAMSHEDPUR\nMEERA IYER\nDOB 12/03/2003', email: 'meera.iyer@nitjsr.ac.in', name: 'Meera Iyer', now: new Date('2026-10-30') });
  assert.equal(staff.checks.find((c) => c.id === 'year').passed, false, "a staff member's birth year isn't a card year");
  const noHints = scoreIdCard({ text: 'NIT JAMSHEDPUR 2025', ...KABIR, emailHints: { year: null } });
  assert.doesNotMatch(noHints.checks.find((c) => c.id === 'year').label, /\(0\)/);
});

test('the badge is never green or gold when the roll number or the name is missing', async () => {
  const { verdictOf } = await check();
  assert.equal(verdictOf([{ id: 'institute', passed: true }, { id: 'rollNumber', passed: true }, { id: 'name', passed: true }, { id: 'year', passed: true }]), 'all');
  assert.equal(verdictOf([{ id: 'institute', passed: true }, { id: 'rollNumber', passed: true }, { id: 'name', passed: true }, { id: 'year', passed: false }]), 'most');
  assert.equal(verdictOf([{ id: 'institute', passed: true }, { id: 'rollNumber', passed: false }, { id: 'name', passed: true }, { id: 'year', passed: true }]), 'doubt');
  assert.equal(verdictOf([{ id: 'institute', passed: true }, { id: 'name', passed: false }, { id: 'year', passed: true }]), 'doubt');
});

test('an error that comes back as a Blob (a file request) keeps its code and message', async () => {
  const { default: http } = await load('/src/lib/http.js');
  const { AxiosError } = await import('axios');
  http.defaults.adapter = async (config) => {
    const body = new Blob([JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: "You've opened 20 files in the last 15 minutes. Try again in 9 minutes.", details: { tier: 'fileLink', retryAfterSeconds: 540 } }, requestId: 'r1' })], { type: 'application/json' });
    const response = { data: body, status: 429, statusText: '', headers: { 'content-type': 'application/json' }, config, request: {} };
    throw new AxiosError('Request failed with status code 429', 'ERR_BAD_REQUEST', config, {}, response);
  };
  const err = await http.get('/admin/verifications/x/id-card/file', { responseType: 'blob' }).catch((e) => e);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.match(err.message, /opened 20 files/);
  assert.equal(err.retryAfter, 540);
  assert.equal(err.requestId, 'r1');
});
