// Opening windows and busy blocks for GET /resources/:id/availability (architecture.md §6 Resources,
// backend.md B-07). Pure: no database, no Redis, no I/O.
//
// Ranges are half-open, [from, to). Inputs may be Dates, ISO strings or epoch milliseconds; outputs
// are Dates. Opening hours are IST wall-clock times (lib/time.js); everything else is an instant.

import {
  DAY,
  IST_OFFSET_MINUTES,
  MINUTE,
  istParts,
  parseHHmm,
} from "../lib/time.js";

const OFFSET = IST_OFFSET_MINUTES * MINUTE;
const ms = (value) => new Date(value).getTime();

// 00:00 IST of the day containing `t`. IST has no daylight saving, so every day is exactly DAY long.
const istMidnight = (t) => Math.floor((t + OFFSET) / DAY) * DAY - OFFSET;

// Sorted, with overlapping windows merged. Windows that only touch stay apart: a slot booking has
// to fit inside one window (eligibility.js), so 09:00–13:00 and 13:00–17:00 aren't one 09:00–17:00.
function merge(windows) {
  const merged = [];
  for (const [start, end] of [...windows].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

// Cuts each [start, end) closure out of the windows; a closure that overhangs a window removes only
// the part that overlaps it.
function subtract(windows, closures) {
  let pieces = windows;
  for (const [cutStart, cutEnd] of closures) {
    pieces = pieces.flatMap(([start, end]) =>
      cutEnd <= start || end <= cutStart
        ? [[start, end]]
        : [
            [start, Math.min(end, cutStart)],
            [Math.max(start, cutEnd), end],
          ].filter(([s, e]) => s < e),
    );
  }
  return pieces;
}

// weekly:    [{ day: 0–6 (0 = Sunday), open: "HH:mm", close: "HH:mm" }] in IST
// blackouts: [{ start, end }]
// → [{ start: Date, end: Date }]: the concrete windows inside [from, to), sorted, none overlapping.
export function openWindows(weekly, blackouts, from, to) {
  const rangeStart = ms(from);
  const rangeEnd = ms(to);
  if (!(rangeStart < rangeEnd)) return [];

  const windows = [];
  // From the IST midnight before `from`, so a window that began before the range is clipped, not lost.
  for (let day = istMidnight(rangeStart); day < rangeEnd; day += DAY) {
    const weekday = istParts(day).day;
    for (const w of weekly ?? []) {
      if (w.day !== weekday) continue;
      const start = Math.max(day + parseHHmm(w.open) * MINUTE, rangeStart);
      const end = Math.min(day + parseHHmm(w.close) * MINUTE, rangeEnd);
      if (start < end) windows.push([start, end]);
    }
  }
  const closures = (blackouts ?? [])
    .map((b) => [ms(b.start), ms(b.end)])
    .filter(([start, end]) => start < end);

  return subtract(merge(windows), closures).map(([start, end]) => ({
    start: new Date(start),
    end: new Date(end),
  }));
}

// intervals: anything with { start, end }, usually the slot-holding bookings; nothing else is read.
// → [{ start: Date, end: Date, inUse, full }]: maximal runs inside [from, to) where the number of
// overlapping intervals is constant and above 0, with full = inUse >= quantity. No ids or names are
// copied, so the result is safe to show any member (architecture.md §16 "Least data").
export function busySegments(intervals, from, to, quantity = 1) {
  const rangeStart = ms(from);
  const rangeEnd = ms(to);
  if (!(rangeStart < rangeEnd)) return [];

  // Net change per instant. An end and a start at the same instant cancel out, so back-to-back
  // bookings don't count as overlapping and one run continues across the hand-over.
  const deltas = new Map();
  for (const interval of intervals ?? []) {
    const start = Math.max(ms(interval.start), rangeStart);
    const end = Math.min(ms(interval.end), rangeEnd);
    if (!(start < end)) continue;
    deltas.set(start, (deltas.get(start) ?? 0) + 1);
    deltas.set(end, (deltas.get(end) ?? 0) - 1);
  }
  const instants = [...deltas.keys()].sort((a, b) => a - b);

  const runs = [];
  let inUse = 0;
  for (let i = 0; i < instants.length - 1; i++) {
    inUse += deltas.get(instants[i]);
    if (inUse <= 0) continue;
    const last = runs.at(-1);
    if (last && last.inUse === inUse && last.end === instants[i]) {
      last.end = instants[i + 1];
    } else {
      runs.push({ start: instants[i], end: instants[i + 1], inUse });
    }
  }
  const capacity = quantity ?? 1;
  return runs.map(({ start, end, inUse }) => ({
    start: new Date(start),
    end: new Date(end),
    inUse,
    full: inUse >= capacity,
  }));
}
