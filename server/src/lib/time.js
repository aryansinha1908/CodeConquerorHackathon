// IST helpers. India has no daylight saving, so IST is always UTC+05:30 and fixed-offset math is exact.
// Dates are stored in UTC; everything users see (opening hours, weeks, messages) is in IST.

export const IST_OFFSET_MINUTES = 330;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A Date whose UTC fields read as IST wall-clock time. Internal only: never store or return it.
const asIstClock = (date) =>
  new Date(new Date(date).getTime() + IST_OFFSET_MINUTES * MINUTE);

// { day: 0–6 (0 = Sunday), minutes: since IST midnight, dateKey: 'YYYY-MM-DD' in IST }
export function istParts(date) {
  const d = asIstClock(date);
  return {
    day: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dateKey: d.toISOString().slice(0, 10),
  };
}

// Monday 00:00 IST of the week containing `date` (weeks run Mon–Sun, architecture.md §17).
export function istWeekStart(date) {
  const d = asIstClock(date);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const mondayMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysSinceMonday,
  );
  return new Date(mondayMidnight - IST_OFFSET_MINUTES * MINUTE);
}

export function istWeekRange(date) {
  const start = istWeekStart(date);
  return { start, end: new Date(start.getTime() + 7 * DAY) };
}

// '09:30' ↔ 570
export function parseHHmm(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const formatIstDate = (date) => dateFormat.format(new Date(date)); // "5 Nov"
export const formatIstDateTime = (date) =>
  dateTimeFormat.format(new Date(date)); // "5 Nov, 14:30"

// "3 Nov, 10:00–12:00", or "3 Nov, 16:00 – 5 Nov, 10:00" when it spans days.
export function formatIstRange(start, end) {
  const from = formatIstDateTime(start);
  if (istParts(start).dateKey === istParts(end).dateKey) {
    return `${from}–${formatHHmm(istParts(end).minutes)}`;
  }
  return `${from} – ${formatIstDateTime(end)}`;
}

export const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

// 30 → "30 minutes", 240 → "4 hours", 90 → "1 h 30 min", 4320 → "3 days"
export function formatDuration(minutes) {
  const mins = Math.round(minutes);
  if (mins >= 1440 && mins % 1440 === 0) return plural(mins / 1440, "day");
  if (mins >= 60 && mins % 60 === 0) return plural(mins / 60, "hour");
  if (mins < 60) return plural(mins, "minute");
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
