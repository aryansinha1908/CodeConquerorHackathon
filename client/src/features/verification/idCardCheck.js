// The on-device ID-card check (frontend.md FC-12): Tesseract reads the card's text in the browser and
// a few checks say whether it looks like this member's NIT Jamshedpur card. The image never leaves
// the device for this (architecture.md §15.3: no ID card goes to an AI company); only the yes/no
// answers go with the upload, as ocrCheck. It is a hint for the member and the admin, never a
// decision: anyone can photograph a convincing card, and OCR misreads.
//
// Tesseract (worker, WebAssembly core) is served from this site's /tesseract/ (copied there by
// scripts/copy-tesseract.mjs) and loaded only when a check runs; the CSP allows WebAssembly
// ('wasm-unsafe-eval') and nothing else new.
//
// Two Tesseract.js 7 bugs are worked around. A language download that fails inside the worker never
// settles, so the model is downloaded here first (with a deadline): that fails fast, and the
// worker's own request is then served from the browser's cache. (Handing the worker the bytes would
// avoid its download, but its initialize step reads a byte-array language's data as its name.) And a
// worker whose start is stopped or hangs is out of reach, so the Worker it spawns is kept to end it.
import { useCallback, useEffect, useRef, useState } from 'react';

const TESSERACT = '/tesseract';
// The whole check (model, worker, reading) gives up after this; the first run downloads about 7 MB.
const READ_DEADLINE_MS = 90_000;

/** The check ids, in the order they're shown. */
export const ID_CHECKS = ['institute', 'rollNumber', 'name', 'year'];

let modelPromise = null;
// The English model, downloaded once per page load into the browser's cache (the bytes aren't
// kept); a failure is retried next time.
function loadModel() {
  if (!modelPromise) {
    modelPromise = fetch(`${TESSERACT}/eng.traineddata.gz`, { signal: AbortSignal.timeout(READ_DEADLINE_MS) }).then(
      async (res) => {
        if (!res.ok) throw new Error(`The OCR model answered ${res.status}`);
        await res.arrayBuffer();
        return true;
      }
    );
    modelPromise.catch(() => {
      modelPromise = null;
    });
  }
  return modelPromise;
}

// createWorker() with the Web Workers it spawns (it spawns them before its first await), so one
// that never finishes starting can still be ended.
function spawnTracked(create) {
  const Native = window.Worker;
  const spawned = [];
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      spawned.push(this);
    }
  };
  try {
    return { creating: create(), spawned };
  } finally {
    window.Worker = Native;
  }
}

const aborted = () => new DOMException('The check was stopped.', 'AbortError');

/**
 * The card's text, read on this device. `onProgress(0..1)` while it reads; `signal` stops it (a
 * later pick, Remove, leaving the page). Rejects when stopped, when anything fails to load, or after
 * 90 seconds; the worker is always terminated. → the text ('' when nothing could be read).
 */
export async function readIdCard(image, { onProgress, signal } = {}) {
  if (signal?.aborted) throw aborted();
  let stop;
  const stopped = new Promise((_, reject) => {
    stop = reject;
  });
  stopped.catch(() => {});
  const timer = setTimeout(() => stop(new Error('The check took too long.')), READ_DEADLINE_MS);
  const onAbort = () => stop(aborted());
  signal?.addEventListener('abort', onAbort, { once: true });
  const until = (promise) => Promise.race([promise, stopped]);

  let started = null;
  let worker = null;
  try {
    const [{ createWorker }] = await until(Promise.all([import('tesseract.js'), loadModel()]));
    const base = `${window.location.origin}${TESSERACT}`;
    started = spawnTracked(() =>
      createWorker('eng', 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/`,
        langPath: base,
        cacheMethod: 'none',
        // Without one, a failed job is thrown where nothing can catch it; its promise rejects anyway.
        errorHandler: () => {},
        logger: (m) => {
          if (m?.status === 'recognizing text' && typeof m.progress === 'number') onProgress?.(m.progress);
        },
      })
    );
    worker = await until(started.creating);
    const { data: result } = await until(worker.recognize(image));
    return typeof result?.text === 'string' ? result.text : '';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (worker) worker.terminate().catch(() => {});
    // Stopped, failed or hung while starting: end what it spawned.
    else started?.spawned.forEach((w) => w.terminate());
  }
}

// ── Reading the text ──────────────────────────────────────────────────────────

// A few Latin letters NFKD doesn't take apart, so "Søren" stays one word.
const latin = (text) =>
  String(text ?? '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l');
// Upper case, letters and digits only, single-spaced: OCR adds stray punctuation and line breaks.
const words = (text) =>
  latin(text)
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
const wordList = (text) => words(text).split(' ').filter(Boolean);
const squash = (text) => words(text).replace(/ /g, '');

// Characters OCR mixes up on ID cards; swapping one for another in its group costs nothing.
const LOOK_ALIKE_GROUPS = ['0ODQ', '1IL', '5S', '8B', '2Z', '6G', '9GQ', '4A', '7T'];
const same = (a, b) => a === b || LOOK_ALIKE_GROUPS.some((g) => g.includes(a) && g.includes(b));

// Edits from `a` to all of `b` (look-alike swaps free). Short strings only: cheap.
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (same(a[i - 1], b[j - 1]) ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

// Whether `pattern` is somewhere in `text` with at most `max` edits (look-alike swaps free).
function fuzzyContains(text, pattern, max) {
  let row = Array.from({ length: text.length + 1 }, () => 0);
  for (let i = 1; i <= pattern.length; i++) {
    const next = [i];
    for (let j = 1; j <= text.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (same(pattern[i - 1], text[j - 1]) ? 0 : 1));
    }
    row = next;
  }
  return Math.min(...row) <= max;
}

/** NIT Jamshedpur's roll numbers: 2025ugcs070 → "2025UGCS070", or null for another address. */
export function rollNumberOf(email) {
  const local = String(email ?? '').split('@')[0];
  return /^(?:19|20)\d{2}[a-z]{2,6}\d{2,4}$/i.test(local) ? local.toUpperCase() : null;
}

// The institute: "NIT Jamshedpur" or "NITJSR", or the full name and the city (fuzzy, for tilted or
// blurred photos). Another NIT's card doesn't pass: its city differs.
function instituteFound(flat) {
  return (
    fuzzyContains(flat, 'NITJAMSHEDPUR', 2) ||
    flat.includes('NITJSR') ||
    (fuzzyContains(flat, 'NATIONALINSTITUTEOFTECHNOLOGY', 4) && fuzzyContains(flat, 'JAMSHEDPUR', 2))
  );
}

// The roll number as one word, or split over up to three ("2024 UGCS 999"), or glued to its label
// ("RollNo2024UGCS999"); one changed or lost character allowed beyond look-alikes. A longer number
// isn't a match.
function rollFound(text, roll) {
  const list = wordList(text);
  for (let i = 0; i < list.length; i++) {
    let joined = '';
    for (let k = i; k < Math.min(list.length, i + 3); k++) {
      joined += list[k];
      const bare = joined.replace(/^(?:ROLL)?NO(?=\d)/, '');
      // Never longer than the roll number: 2024UGCS070 isn't 2024UGCS07.
      if (bare.length <= roll.length && distance(bare, roll) <= 1) return true;
      if (bare.length > roll.length + 1) break;
    }
  }
  return false;
}

const HONORIFICS = new Set(['DR', 'PROF', 'MR', 'MRS', 'MS', 'MISS', 'SHRI', 'SMT', 'SRI']);

// The account's name: every word on the card in full or, for a middle name, as its initial, with
// at least one word of 3+ letters in full; no typos beyond look-alikes in words under 6 letters, one
// in longer ones. Titles (Dr, Prof, …) are ignored. Merged words ("ARYANSINHA") count too.
function nameFound(text, name) {
  const mine = wordList(name).filter((w) => !HONORIFICS.has(w));
  const card = wordList(text);
  const longer = mine.filter((w) => w.length > 1);
  if (longer.length >= 2 && fuzzyContains(card.join(''), longer.join(''), 0)) return true;
  const inFull = (w) => card.some((c) => distance(w, c) <= (w.length >= 10 ? 2 : w.length >= 6 ? 1 : 0));
  const asInitial = (w) => card.some((c) => c.length === 1 && c === w[0]);
  const long = mine.filter((w) => w.length >= 3);
  // The first name and the last are wanted in full; anything between may be an initial.
  const ends = long.length > 1 ? [long[0], long.at(-1)] : long;
  return ends.length > 0 && ends.every(inFull) && mine.every((w) => inFull(w) || asInitial(w));
}

// The year: for a student, the admission year (or a year up to six after it: a validity date), the
// session's short form ("24-28"), or the roll number itself, which carries the year. For staff, a
// year from 15 years ago to 10 ahead (issue or validity), so a birth year doesn't count.
function yearFound(text, admission, rollPassed, now) {
  const all = words(text);
  const years = (all.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  if (admission) {
    if (rollPassed || years.some((y) => y >= admission && y <= admission + 6)) return true;
    const yy = String(admission % 100).padStart(2, '0');
    return new RegExp(`\\b${yy} \\d{2}\\b`).test(all);
  }
  const current = new Date(now).getFullYear();
  return years.some((y) => y >= current - 15 && y <= current + 10);
}

/**
 * The checks on what was read → { readable, score, total, checks: [{ id, label, passed }] }. Only
 * the checks that apply count (as the server decides them): a staff address has no roll number, so
 * it isn't looked for. Labels name the expected values, so they read the same to the member and to
 * the admin.
 */
export function scoreIdCard({ text, email, name, emailHints, now = new Date() } = {}) {
  const flat = squash(text);
  const readable = flat.replace(/[^A-Z]/g, '').length >= 12;
  const checks = [];

  checks.push({ id: 'institute', label: 'The institute’s name (NIT Jamshedpur)', passed: readable && instituteFound(flat) });

  const roll = rollNumberOf(email);
  const rollPassed = Boolean(roll) && readable && rollFound(text, roll);
  if (roll) checks.push({ id: 'rollNumber', label: `The roll number (${roll})`, passed: rollPassed });

  if (wordList(name).some((w) => w.length >= 3)) {
    checks.push({
      id: 'name',
      label: `The account’s name (${String(name ?? '').trim()})`,
      passed: readable && nameFound(text, name),
    });
  }

  const hinted = Number(emailHints?.year);
  const admission = Number.isInteger(hinted) && hinted >= 1990 && hinted <= new Date(now).getFullYear() + 1 ? hinted : null;
  checks.push({
    id: 'year',
    label: admission ? `The admission year (${admission})` : 'A recent year (when it was issued or until when it is valid)',
    passed: readable && yearFound(text, admission, rollPassed, now),
  });

  const score = checks.filter((c) => c.passed).length;
  return { readable, score, total: checks.length, checks };
}

/**
 * How much the checks say, for the badge: 'all' passed; 'most' (only the institute or the year
 * missing); 'doubt' when the roll number or the name is missing, which no other check makes up for.
 */
export function verdictOf(checks = []) {
  if (checks.every((c) => c.passed)) return 'all';
  return checks.some((c) => !c.passed && (c.id === 'rollNumber' || c.id === 'name')) ? 'doubt' : 'most';
}

/** What a live region says about a check: when it starts and when it ends, never each step. */
export function deviceCheckAnnouncement(check) {
  if (check.status === 'running') return 'Checking the card on this device.';
  if (check.status === 'failed') return "The device check couldn't run.";
  if (check.status !== 'done') return '';
  if (!check.result?.readable) return 'The device check could not read any text on the card.';
  return `Device check finished: ${check.result.score} of ${check.result.total} found on the card.`;
}

/** The result as it goes with the upload (ocrCheck): the yes/no answers only, never the text. */
export function ocrCheckField(result) {
  if (!result?.checks?.length) return null;
  return JSON.stringify({ v: 1, checks: Object.fromEntries(result.checks.map((c) => [c.id, c.passed])) });
}

/** What to try when a check fails, for the member. */
export const FIX_HINTS = {
  institute: 'Make sure the whole card is in the photo, including the institute’s name.',
  rollNumber: 'Is it your own card? Make sure the roll number is sharp and not covered by glare.',
  name: 'The name on the card should match your account’s name. Retake the photo if it’s blurry.',
  year: 'Make sure the dates on the card are in the photo and readable.',
};

/** The labels of a stored check (the admin's queue: no name or roll number to show). */
export const STORED_LABELS = {
  institute: 'Institute’s name',
  rollNumber: 'Roll number from the email',
  name: 'Name on the account',
  year: 'Year',
};

/**
 * A check of one card at a time: run(image, { email, name, emailHints }) reads and scores it; a
 * later run, reset or unmount stops the one going (its worker is ended). → { status: 'idle' |
 * 'running' | 'done' | 'failed', progress (0..1 while running), result (when done), run, reset }.
 */
export function useIdCardCheck() {
  const [state, setState] = useState({ status: 'idle', progress: 0, result: null });
  const controllerRef = useRef(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const run = useCallback(async (image, who = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = () => controllerRef.current === controller;
    setState({ status: 'running', progress: 0, result: null });
    try {
      const text = await readIdCard(image, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (current()) setState((s) => ({ ...s, progress }));
        },
      });
      if (current()) setState({ status: 'done', progress: 1, result: scoreIdCard({ text, ...who }) });
    } catch {
      if (current()) setState({ status: 'failed', progress: 0, result: null });
    } finally {
      if (current()) controllerRef.current = null;
    }
  }, []);
  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle', progress: 0, result: null });
  }, []);
  return { ...state, run, reset };
}
