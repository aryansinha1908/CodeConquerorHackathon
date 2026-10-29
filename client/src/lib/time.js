// IST helpers (frontend.md §1 principle 6; api.md "Values": responses carry UTC ISO strings, and
// everything on screen is IST). India has no daylight saving, so IST is always UTC+05:30 and
// fixed-offset arithmetic is exact, as in the server's lib/time.js. The short formats are built from
// the offset rather than Intl, so they read the same in every browser and match the server's
// messages ("3 Nov, 10:00–12:00").
//
// Every formatter takes a Date, an ISO string or epoch milliseconds, and returns null for a missing
// or invalid value, so a page can write `formatIstRange(b.start, b.end) ?? 'Not set'`.

export const IST_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OFFSET = IST_OFFSET_MINUTES * MINUTE;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');

/** value (Date, ISO string, epoch ms) → a new Date, or null when it is missing or invalid. */
export function toDate(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The IST wall clock of an instant: { year, month (0–11), day, weekday (0 = Sunday), hours,
 * minutes, dateKey: 'YYYY-MM-DD' }, or null.
 */
export function istParts(value) {
  const date = toDate(value);
  if (!date) return null;
  const clock = new Date(date.getTime() + OFFSET);
  const year = clock.getUTCFullYear();
  const month = clock.getUTCMonth();
  const day = clock.getUTCDate();
  return {
    year,
    month,
    day,
    weekday: clock.getUTCDay(),
    hours: clock.getUTCHours(),
    minutes: clock.getUTCMinutes(),
    dateKey: `${year}-${pad(month + 1)}-${pad(day)}`,
  };
}

/** The IST calendar date of an instant: '2026-11-03', or null. */
export function istDateKey(value) {
  return istParts(value)?.dateKey ?? null;
}

/** Whether two instants fall on the same IST calendar day. */
export function isSameIstDay(a, b) {
  const first = istDateKey(a);
  return first !== null && first === istDateKey(b);
}

/** "10:00" (24-hour, IST), or null. */
export function formatIstTime(value) {
  const p = istParts(value);
  return p ? `${pad(p.hours)}:${pad(p.minutes)}` : null;
}

/**
 * "3 Nov"; with { weekday: true } "Tue, 3 Nov"; with { year: true } "3 Nov 2026" (both: "Tue, 3 Nov
 * 2026"). Or null.
 */
export function formatIstDate(value, { weekday = false, year = false } = {}) {
  const p = istParts(value);
  if (!p) return null;
  const date = `${p.day} ${MONTHS[p.month]}${year ? ` ${p.year}` : ''}`;
  return weekday ? `${WEEKDAYS[p.weekday]}, ${date}` : date;
}

/** "3 Nov, 14:30" (the server's message style, 24-hour IST), or null. */
export function formatIstShortDateTime(value) {
  const p = istParts(value);
  return p ? `${p.day} ${MONTHS[p.month]}, ${pad(p.hours)}:${pad(p.minutes)}` : null;
}

const istDateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** "29 Oct 2026, 02:49 am IST" (a full timestamp: submissions, reviews, link expiry), or null. */
export function formatIstDateTime(value) {
  const date = toDate(value);
  return date ? `${istDateTime.format(date)} IST` : null;
}

/**
 * A booking slot like the server writes it: "3 Nov, 10:00–12:00" on one IST day, else
 * "3 Nov, 16:00 – 5 Nov, 10:00". Null when either end is missing or invalid.
 */
export function formatIstRange(start, end) {
  const from = istParts(start);
  const to = istParts(end);
  if (!from || !to) return null;
  if (from.dateKey === to.dateKey) {
    return `${formatIstShortDateTime(start)}–${pad(to.hours)}:${pad(to.minutes)}`;
  }
  return `${formatIstShortDateTime(start)} – ${formatIstShortDateTime(end)}`;
}

/** The whole minutes from start to end (negative when end is first), or null. */
export function minutesBetween(start, end) {
  const a = toDate(start);
  const b = toDate(end);
  return a && b ? Math.round((b.getTime() - a.getTime()) / MINUTE) : null;
}

/** 30 → "30 min", 120 → "2 h", 90 → "1 h 30 min", 1440 → "1 day", 2880 → "2 days". Or null. */
export function formatDuration(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const mins = Math.max(0, Math.round(Number(minutes)));
  if (mins >= 1440 && mins % 1440 === 0) {
    const days = mins / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * An instant relative to `now`: "in 2 h", "in 1 h 30 min", "in 45 min", "in 3 days", "5 min ago",
 * "2 h ago", "now" (under a minute either way). Past 14 days it falls back to the IST date
 * ("3 Nov"). Or null.
 */
export function formatRelative(value, now = Date.now()) {
  const date = toDate(value);
  const reference = toDate(now);
  if (!date || !reference) return null;
  const diff = date.getTime() - reference.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return 'now';
  if (abs >= 14 * DAY) return formatIstDate(date);
  let span;
  if (abs < HOUR) {
    span = `${Math.floor(abs / MINUTE)} min`;
  } else if (abs < DAY) {
    const hours = Math.floor(abs / HOUR);
    const mins = Math.floor((abs % HOUR) / MINUTE);
    // Minutes matter for "starts in 1 h 30 min"; past a few hours they are noise.
    span = hours < 3 && mins ? `${hours} h ${mins} min` : `${hours} h`;
  } else {
    const days = Math.floor(abs / DAY);
    span = `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

// ── <input> converters ────────────────────────────────────────────────────────
// A datetime-local input has no time zone: its value is a wall-clock time, which this app always
// means as IST, whatever zone the browser is in.

const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * An instant → the value for an <input type="datetime-local"> that shows it in IST:
 * "2026-11-03T10:00". "" when the value is missing or invalid (an empty input).
 */
export function toIstInputValue(value) {
  const p = istParts(value);
  return p ? `${p.dateKey}T${pad(p.hours)}:${pad(p.minutes)}` : '';
}

/**
 * A datetime-local value read as IST ("2026-11-03T10:00", seconds optional) → the ISO instant
 * "2026-11-03T04:30:00.000Z", or null when it isn't a real date and time (e.g. 30 Feb, 24:00).
 */
export function fromIstInputValue(text) {
  const match = typeof text === 'string' ? INPUT_RE.exec(text.trim()) : null;
  if (!match) return null;
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map((n) => Number(n ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  const wall = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const check = new Date(wall);
  // Date.UTC rolls 30 Feb over to 2 Mar: refuse it rather than book a different day.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(wall - OFFSET).toISOString();
}

/** An instant → the IST date for an <input type="date">: "2026-11-03", or "". */
export function toIstDateInputValue(value) {
  return istDateKey(value) ?? '';
}

/**
 * An IST calendar day ('2026-11-03', or any instant on it) → { start, end } as ISO instants: IST
 * midnight and the next IST midnight. Suits `from`/`to` filters, which are [from, to). Defaults to
 * today. Null when the value isn't a date.
 */
export function istDayBounds(value = Date.now()) {
  const key = typeof value === 'string' && DATE_RE.test(value) ? value : istDateKey(value);
  if (!key) return null;
  const start = fromIstInputValue(`${key}T00:00`);
  if (!start) return null;
  const startMs = new Date(start).getTime();
  return { start, end: new Date(startMs + DAY).toISOString() };
}
