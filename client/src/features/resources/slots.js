import {
  IST_OFFSET_MINUTES,
  formatDuration,
  formatIstDate,
  formatIstTime,
  istDateKey,
  istDayBounds,
  istParts,
  toDate,
} from '../../lib/time';

// The availability grid and the booking panel's choices, from GET /resources/:id/availability
// ({ quantity, openWindows: [{ start, end }], busy: [{ start, end, inUse, full }] }, api.md
// "Resources") and the resource's availability { weekly, blackouts, slotMinutes }. Pure: the clock
// comes in as `now`.
//
// A cell is one slotMinutes step of an IST day, aligned to IST midnight. Its state:
//   free     inside an open window, no unit in use
//   partial  inside an open window, some units in use (inUse of quantity)
//   full     inside an open window, every unit in use: still selectable, the booking joins the waitlist
//   past     inside an open window but already started
//   blackout inside the weekly hours but cut out of the open windows (a closure)
//   closed   outside the opening hours
// Busy cells say how many units are in use, never who holds them (api.md: no borrower data).

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const OFFSET = IST_OFFSET_MINUTES * MINUTE;

export const GRID_DAYS = 7;
export const SLOT_SIZES = [15, 30, 60];
export const SELECTABLE_STATES = ['free', 'partial', 'full'];

const ms = (value) => {
  const date = toDate(value);
  return date ? date.getTime() : NaN;
};
const iso = (value) => new Date(value).toISOString();
const list = (value) => (Array.isArray(value) ? value : []);
const pad = (n) => String(n).padStart(2, '0');

// 00:00 IST of the day holding `t` (IST has no daylight saving: every day is DAY long).
const istMidnight = (t) => Math.floor((t + OFFSET) / DAY) * DAY - OFFSET;

const parseHHmm = (text) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(typeof text === 'string' ? text.trim() : '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const clock = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** availability.slotMinutes (15 | 30 | 60) of a resource; 30, the server's default, otherwise. */
export function slotMinutesOf(resource) {
  const n = Number(resource?.availability?.slotMinutes);
  return SLOT_SIZES.includes(n) ? n : 30;
}

/**
 * The availability query's range: IST midnight of `day` (an instant, epoch ms or 'YYYY-MM-DD';
 * default today) and `days` days later, as ISO instants. The same day gives the same range, so the
 * query key holds still until midnight. Null for an invalid day.
 */
export function availabilityRange(day = Date.now(), days = GRID_DAYS) {
  const bounds = istDayBounds(day);
  if (!bounds) return null;
  const from = Date.parse(bounds.start);
  return { from: bounds.start, to: iso(from + days * DAY) };
}

/** Whether a cell can be picked as a booking's start or end. */
export function isSelectable(cell) {
  return Boolean(cell) && SELECTABLE_STATES.includes(cell.state);
}

/**
 * The grid model: { days: [{ index, start, dateKey, label, weekday, date, isToday, open, cells }],
 * rows: [{ index, minute, label }], slotMinutes, quantity, hasOpenSlots }. Each day has one cell per
 * row: { key, dayIndex, rowIndex, start, end (ISO), startMs, endMs, state, inUse, windowIndex,
 * reason }. Rows run from the earliest opening to the latest closing in the range; a range with no
 * opening hours has no rows.
 */
export function buildSlotGrid({
  range,
  slotMinutes = 30,
  openWindows = [],
  busy = [],
  quantity = 1,
  weekly = [],
  blackouts = [],
  now = Date.now(),
} = {}) {
  const slot = SLOT_SIZES.includes(Number(slotMinutes)) ? Number(slotMinutes) : 30;
  const units = Math.max(1, Number(quantity) || 1);
  const empty = { days: [], rows: [], slotMinutes: slot, quantity: units, hasOpenSlots: false };
  const fromMs = ms(range?.from);
  const toMs = ms(range?.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !(fromMs < toMs)) return empty;
  const nowMs = Number.isFinite(ms(now)) ? ms(now) : Date.now();

  const windows = list(openWindows)
    .map((w) => ({ start: ms(w?.start), end: ms(w?.end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.start < w.end)
    .sort((a, b) => a.start - b.start);
  const segments = list(busy)
    .map((b) => ({
      start: ms(b?.start),
      end: ms(b?.end),
      inUse: Math.max(0, Math.round(Number(b?.inUse) || 0)),
      full: Boolean(b?.full),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start < s.end);
  const closures = list(blackouts)
    .map((b) => ({
      start: ms(b?.start),
      end: ms(b?.end),
      reason: typeof b?.reason === 'string' && b.reason.trim() ? b.reason.trim() : null,
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start < c.end);
  const hours = list(weekly)
    .map((w) => ({ day: Number(w?.day), open: parseHHmm(w?.open), close: parseHHmm(w?.close) }))
    .filter((w) => w.open != null && w.close != null && w.open < w.close);

  const dayStarts = [];
  for (let day = istMidnight(fromMs); day < toMs; day += DAY) dayStarts.push(day);

  // The rows cover every opening in the range: the open windows, and the weekly hours of these
  // days (so a day closed by a blackout still shows its hours, as closed).
  let first = Infinity;
  let last = -Infinity;
  for (const w of windows) {
    const midnight = istMidnight(w.start);
    first = Math.min(first, (w.start - midnight) / MINUTE);
    last = Math.max(last, (w.end - midnight) / MINUTE);
  }
  for (const day of dayStarts) {
    const weekday = istParts(day).weekday;
    for (const h of hours) {
      if (h.day !== weekday) continue;
      first = Math.min(first, h.open);
      last = Math.max(last, h.close);
    }
  }
  if (!Number.isFinite(first) || !(first < last)) {
    return { ...empty, days: dayStarts.map((day, index) => dayView(day, index, [], nowMs)) };
  }
  first = Math.max(0, Math.floor(first / slot) * slot);
  last = Math.min(24 * 60, Math.ceil(last / slot) * slot);
  const rows = [];
  for (let minute = first; minute + slot <= last; minute += slot) {
    rows.push({ index: rows.length, minute, label: clock(minute) });
  }

  const days = dayStarts.map((dayStart, dayIndex) => {
    const weekday = istParts(dayStart).weekday;
    const dayHours = hours.filter((h) => h.day === weekday);
    const cells = rows.map((row) => {
      const start = dayStart + row.minute * MINUTE;
      const end = start + slot * MINUTE;
      const windowIndex = windows.findIndex((w) => w.start <= start && end <= w.end);
      let state;
      let inUse = 0;
      let reason = null;
      if (windowIndex === -1) {
        const scheduled = dayHours.some((h) => h.open <= row.minute && row.minute + slot <= h.close);
        if (scheduled) {
          state = 'blackout';
          reason = closures.find((c) => c.start < end && start < c.end)?.reason ?? null;
        } else {
          state = 'closed';
        }
      } else if (start < nowMs) {
        state = 'past';
      } else {
        let full = false;
        for (const s of segments) {
          if (s.start < end && start < s.end) {
            inUse = Math.max(inUse, s.inUse);
            if (s.full || s.inUse >= units) full = true;
          }
        }
        state = full ? 'full' : inUse > 0 ? 'partial' : 'free';
      }
      return {
        key: `${dayIndex}-${row.index}`,
        dayIndex,
        rowIndex: row.index,
        start: iso(start),
        end: iso(end),
        startMs: start,
        endMs: end,
        state,
        inUse,
        windowIndex,
        reason,
      };
    });
    return dayView(dayStart, dayIndex, cells, nowMs);
  });

  return { days, rows, slotMinutes: slot, quantity: units, hasOpenSlots: days.some((d) => d.open) };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayView(dayStart, index, cells, nowMs) {
  const parts = istParts(dayStart);
  return {
    index,
    start: iso(dayStart),
    dateKey: parts.dateKey,
    label: formatIstDate(dayStart, { weekday: true }),
    weekday: WEEKDAYS[parts.weekday],
    date: formatIstDate(dayStart),
    isToday: parts.dateKey === istDateKey(nowMs),
    open: cells.some(isSelectable),
    cells,
  };
}

const allCells = (model) => list(model?.days).flatMap((day) => day.cells);

/** The cell that starts at `start` (an instant), or null. */
export function cellStartingAt(model, start) {
  const t = ms(start);
  return Number.isFinite(t) ? (allCells(model).find((cell) => cell.startMs === t) ?? null) : null;
}

/** The cell that ends at `end` (an instant), or null. */
export function cellEndingAt(model, end) {
  const t = ms(end);
  return Number.isFinite(t) ? (allCells(model).find((cell) => cell.endMs === t) ?? null) : null;
}

/**
 * Whether startCell's start to endCell's end can be one booking: both selectable, end after start,
 * and for a slot booking (`mode` 'slot') inside one open window, as the server's OPEN_HOURS rule
 * asks. A loan ('loan') only needs pickup and return inside opening hours.
 */
export function isRangeBookable(startCell, endCell, mode = 'slot') {
  if (!isSelectable(startCell) || !isSelectable(endCell)) return false;
  if (!(endCell.endMs > startCell.startMs) || endCell.startMs < startCell.startMs) return false;
  if (mode === 'loan') return true;
  return startCell.dayIndex === endCell.dayIndex && startCell.windowIndex === endCell.windowIndex;
}

/**
 * A pick on the grid → the next { selection, anchor }. The first pick selects that one slot and
 * becomes the anchor; a second pick at or after it extends the selection to the picked slot's end
 * when the range is bookable, otherwise it starts again from the new slot. Cells that can't be
 * picked change nothing.
 */
export function pickCell({ selection = null, anchor = null, cell, mode = 'slot' }) {
  if (!isSelectable(cell)) return { selection, anchor };
  if (anchor && isRangeBookable(anchor, cell, mode)) {
    return { selection: { start: anchor.start, end: cell.end }, anchor: null };
  }
  return { selection: { start: cell.start, end: cell.end }, anchor: cell };
}

/** Whether a cell lies inside the selection (closed cells of a multi-day loan don't count). */
export function isCellSelected(cell, selection) {
  if (!cell || !selection || cell.state === 'closed' || cell.state === 'blackout') return false;
  const start = ms(selection.start);
  const end = ms(selection.end);
  return Number.isFinite(start) && Number.isFinite(end) && cell.startMs >= start && cell.endMs <= end;
}

const cellNote = (cell, quantity) => {
  if (cell.state === 'full') return quantity > 1 ? 'all in use, waitlist' : 'taken, waitlist';
  if (cell.state === 'partial') return `${cell.inUse} of ${quantity} in use`;
  return '';
};

/** The days with a start to offer: [{ value (day index as text), label }]. */
export function startDayOptions(model) {
  return list(model?.days)
    .filter((day) => day.open)
    .map((day) => ({ value: String(day.index), label: day.label }));
}

/** The start times of a day: [{ value (ISO), label: '10:00' or '10:00 (taken, waitlist)' }]. */
export function startTimeOptions(model, dayIndex) {
  if (dayIndex === '' || dayIndex == null) return [];
  const day = list(model?.days)[Number(dayIndex)];
  if (!day) return [];
  return day.cells.filter(isSelectable).map((cell) => {
    const note = cellNote(cell, model.quantity);
    return { value: cell.start, label: note ? `${formatIstTime(cell.startMs)} (${note})` : formatIstTime(cell.startMs) };
  });
}

/**
 * The ends a booking from `start` can have: [{ value (ISO), dayIndex, minutes, label: '12:00 (2 h)' }],
 * earliest first. Slot mode: the rest of that open window. Loan mode: every open slot's end after it.
 */
export function endOptions(model, start, mode = 'slot') {
  const startCell = cellStartingAt(model, start);
  if (!isSelectable(startCell)) return [];
  return allCells(model)
    .filter((cell) => isRangeBookable(startCell, cell, mode))
    .map((cell) => {
      const minutes = Math.round((cell.endMs - startCell.startMs) / MINUTE);
      return {
        value: cell.end,
        dayIndex: cell.dayIndex,
        minutes,
        label: `${formatIstTime(cell.endMs)} (${formatDuration(minutes)})`,
      };
    });
}

/** The days a loan can end on, from endOptions: [{ value (day index as text), label }]. */
export function endDayOptions(model, options) {
  const indexes = [...new Set(list(options).map((option) => option.dayIndex))];
  return indexes
    .map((index) => list(model?.days)[index])
    .filter(Boolean)
    .map((day) => ({ value: String(day.index), label: day.label }));
}

/**
 * The end to use for a new start: the first that is at least `minMinutes` long (the resource's
 * minimum length), else the first one. Null when there is none.
 */
export function defaultEnd(model, start, mode = 'slot', minMinutes = 0) {
  const options = endOptions(model, start, mode);
  if (!options.length) return null;
  const min = Number(minMinutes) || 0;
  return (options.find((option) => option.minutes >= min) ?? options[0]).value;
}

/**
 * A chosen start → the selection to show: the previous end when it still fits, else defaultEnd.
 * Null when the start can't be picked.
 */
export function selectionFromStart(model, start, { mode = 'slot', previousEnd = null, minMinutes = 0 } = {}) {
  const options = endOptions(model, start, mode);
  if (!options.length) return null;
  const keep = previousEnd && options.some((option) => option.value === previousEnd);
  return { start, end: keep ? previousEnd : defaultEnd(model, start, mode, minMinutes) };
}

/**
 * "Tue, 3 Nov, 10:00–12:00 (2 h)" on one IST day, else "Tue, 3 Nov, 16:00 → Thu, 5 Nov, 10:00
 * (1 day 18 h)". Null for an incomplete selection.
 */
export function describeSelection(selection) {
  const start = toDate(selection?.start);
  const end = toDate(selection?.end);
  if (!start || !end) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE);
  const length = minutes >= 1440 && minutes % 1440 !== 0
    ? `${Math.floor(minutes / 1440)} ${Math.floor(minutes / 1440) === 1 ? 'day' : 'days'} ${formatDuration(minutes % 1440)}`
    : formatDuration(minutes);
  const startDay = formatIstDate(start, { weekday: true });
  if (istDateKey(start) === istDateKey(end)) {
    return `${startDay}, ${formatIstTime(start)}–${formatIstTime(end)} (${length})`;
  }
  return `${startDay}, ${formatIstTime(start)} → ${formatIstDate(end, { weekday: true })}, ${formatIstTime(end)} (${length})`;
}

/** The selection as a stable text key ('' when incomplete), for debouncing and comparing. */
export function selectionKey(selection) {
  const start = toDate(selection?.start);
  const end = toDate(selection?.end);
  return start && end ? `${start.toISOString()}|${end.toISOString()}` : '';
}

/** selectionKey → { start, end } ISO, or null. */
export function selectionFromKey(key) {
  if (typeof key !== 'string' || !key.includes('|')) return null;
  const [start, end] = key.split('|');
  return toDate(start) && toDate(end) ? { start, end } : null;
}

/** A cell's words for a screen reader: "Tue, 3 Nov, 10:00–10:30: free". */
export function describeCell(cell, quantity = 1) {
  if (!cell) return '';
  const when = `${formatIstDate(cell.startMs, { weekday: true })}, ${formatIstTime(cell.startMs)}–${formatIstTime(cell.endMs)}`;
  const state = {
    free: quantity > 1 ? `free, ${quantity} units` : 'free',
    partial: `${cell.inUse} of ${quantity} units in use`,
    full: quantity > 1 ? 'all units in use, waitlist only' : 'taken, waitlist only',
    past: 'already started',
    blackout: cell.reason ? `closed: ${cell.reason}` : 'closed for a closure',
    closed: 'outside opening hours',
  }[cell.state];
  return `${when}: ${state ?? cell.state}`;
}
