// Pure helpers for the manager pages (frontend.md §6.3): the review queue (/manage/requests), today's
// handovers (/manage/handovers) and the return check (/manage/returns/:bookingId). They read data
// shaped as docs/api.md "Bookings" describes and never make up values. The pages and their
// components import from here, so the tests can check the rules without a browser.

import {
  CHECK_IN_OPENS_MINUTES,
  DECISION_TEXT_MAX,
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  ITEM_NOTE_MAX,
  OVERDUE_GRACE_MINUTES,
  REPORT_NOTES_MAX,
  idOf,
  isBorrower,
} from '../../bookings/api';
import { memberTypeLabel } from '../../verification/api';
import { fieldErrorsFrom } from '../../../lib/errors';
import { formatDuration, formatIstRange, istDayBounds, minutesBetween, toDate } from '../../../lib/time';

const MINUTE = 60 * 1000;

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── People and permissions ────────────────────────────────────────────────────

// The server's 403 for a review on one's own booking (approve, reject, waitlist, confirm-return).
export const OWN_BOOKING_MESSAGE =
  "You can't decide on your own booking. Another manager of this unit or an admin must.";

export function isAdmin(user) {
  return Array.isArray(user?.roles) && user.roles.includes('admin');
}

/**
 * Whether the server will refuse this user's decision because the booking is their own: a
 * manager can't review their own request or return; an admin can (api.md "Bookings").
 */
export function blocksOwnDecision(booking, user) {
  return isBorrower(booking, user) && !isAdmin(user);
}

/**
 * Whether this user may do the check-in or check-out of a booking: its borrower or a manager of
 * its unit (api.md check-in / check-out: "an admin who is neither can't"). GET /bookings/manage
 * lists every unit for an admin, so the admin role alone isn't enough.
 */
export function canHandOver(booking, user) {
  if (!booking || !user) return false;
  if (isBorrower(booking, user)) return true;
  const unit = idOf(booking.orgUnit);
  const managed = Array.isArray(user.managedOrgUnits) ? user.managedOrgUnits.map((u) => idOf(u)) : [];
  return Boolean(unit) && managed.includes(unit);
}

/** A populated department { name, code } → "Computer Science and Engineering (CSE)". */
export function departmentLabel(department) {
  if (!department || typeof department !== 'object') return 'No department';
  const name = asText(department.name);
  const code = asText(department.code).toUpperCase();
  if (name && code) return `${name} (${code})`;
  return name || code || 'No department';
}

/**
 * A populated borrower { _id, name, memberType, department } → { name, memberType, department }
 * as text. The manage lists never carry an email (api.md), so neither does this.
 */
export function requesterView(borrower) {
  const person = borrower && typeof borrower === 'object' ? borrower : {};
  return {
    name: asText(person.name) || 'A member',
    memberType: memberTypeLabel(person.memberType),
    department: departmentLabel(person.department),
  };
}

// ── Review queue ──────────────────────────────────────────────────────────────

// The eligibility rules in the server's order (api.md "Eligibility rules").
export const RULE_LABELS = {
  ACCOUNT_VERIFIED: 'ID verified',
  NOT_SUSPENDED: 'Not suspended',
  RESOURCE_ACTIVE: 'Resource active',
  MEMBER_TYPE: 'Member type',
  DEPARTMENT: 'Department',
  BADGES: 'Badges',
  OPEN_HOURS: 'Open hours',
  DURATION: 'Duration',
  BOOKING_WINDOW: 'Booking window',
  WEEKLY_HOURS: 'Weekly hours',
  ACTIVE_BOOKINGS: 'Active bookings',
  AVAILABILITY: 'Slot free',
};

export function ruleLabel(rule) {
  return RULE_LABELS[rule] ?? (asText(rule).replace(/_/g, ' ').toLowerCase() || 'Rule');
}

/**
 * A booking's eligibilitySnapshot [{ rule, passed, message }] → { items, total, passed,
 * hardFailed, slotTaken }. AVAILABILITY is the only soft rule: a taken slot means "waitlist", not
 * "ineligible", so it is counted apart.
 */
export function snapshotSummary(snapshot) {
  const items = (Array.isArray(snapshot) ? snapshot : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      rule: asText(entry.rule),
      label: ruleLabel(entry.rule),
      passed: entry.passed === true,
      soft: entry.rule === 'AVAILABILITY',
      message: asText(entry.message),
    }));
  const failed = items.filter((item) => !item.passed);
  return {
    items,
    total: items.length,
    passed: items.length - failed.length,
    hardFailed: failed.filter((item) => !item.soft),
    slotTaken: failed.some((item) => item.soft),
  };
}

/** A conflict group → { total, pending, waitlisted } request counts. */
export function groupCounts(group) {
  const bookings = Array.isArray(group?.bookings) ? group.bookings : [];
  return {
    total: bookings.length,
    pending: bookings.filter((b) => b?.status === 'pending').length,
    waitlisted: bookings.filter((b) => b?.status === 'waitlisted').length,
  };
}

/** A stable React key for a conflict group: its resource and the id of its oldest request. */
export function groupKey(group, index = 0) {
  const first = Array.isArray(group?.bookings) ? idOf(group.bookings[0]) : null;
  return `${idOf(group?.resource) ?? 'resource'}:${first ?? index}`;
}

/** resource.quantity → "1 unit" / "3 units"; null without a number. */
export function quantityText(quantity) {
  const n = Number(quantity);
  return Number.isInteger(n) && n > 0 ? plural(n, 'unit') : null;
}

/** "3 Nov, 10:00–12:00 (2 h)", or "Time not set". */
export function slotText(start, end) {
  const range = formatIstRange(start, end);
  if (!range) return 'Time not set';
  const length = formatDuration(minutesBetween(start, end));
  return length ? `${range} (${length})` : range;
}

// The quick picks of the decision dialogs (frontend.md §7 ReasonDialog); the manager can edit them.
export const DECISION_TEMPLATES = {
  reject: [
    'Clashes with a lab session at that time.',
    'Missing the safety training for this equipment.',
    'The resource is reserved for coursework then.',
    'Please book a shorter slot.',
  ],
  waitlist: [
    'An earlier request holds this slot.',
    'Held for a scheduled class; you are next in line.',
  ],
};

/**
 * The variables of a decision mutation (features/bookings/api.js): approve sends an optional
 * note, reject and waitlist a reason. resourceId is never sent; it refreshes the resource's
 * availability.
 */
export function decisionVars(kind, booking, text) {
  const id = idOf(booking);
  const resourceId = idOf(booking?.resource) ?? undefined;
  if (kind === 'approve') return { id, note: trimmed(text), resourceId };
  return { id, reason: trimmed(text), resourceId };
}

/** What a failed decision means for the page: 'slotTaken', 'stale' (reload) or 'stay' (retry). */
export function decisionFailure(kind, err) {
  if (kind === 'approve' && err?.code === 'SLOT_TAKEN') return 'slotTaken';
  if (err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND') return 'stale';
  return 'stay';
}

/** The success line of a decision: toast and live region. */
export function decisionMessage(kind, booking) {
  const { name } = requesterView(booking?.borrower);
  const title = asText(booking?.resource?.title) || 'the resource';
  if (kind === 'approve') return `Approved ${name}'s request for ${title}.`;
  if (kind === 'reject') return `Rejected ${name}'s request for ${title}.`;
  return `Moved ${name}'s request for ${title} to the waitlist.`;
}

export const DECISION_MAX = DECISION_TEXT_MAX;

// ── Handovers ─────────────────────────────────────────────────────────────────

/** The three handover lists (frontend.md §6.3) and the GET /bookings/manage status of each. */
export const HANDOVER_SECTIONS = [
  { id: 'starting', status: 'approved', today: true },
  { id: 'inUse', status: 'checked_in', today: false },
  { id: 'returns', status: 'checked_out', today: false },
];

export const HANDOVER_PAGE_SIZE = 20;

/**
 * The GET /bookings/manage filters of one handover list. "Starting soon" is today's approved
 * bookings: start in [IST midnight, next IST midnight). The other two take every booking in that
 * state, so yesterday's late return still shows.
 */
export function handoverFilters(sectionId, { page = 1, now = Date.now() } = {}) {
  const section = HANDOVER_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return null;
  const filters = { status: section.status, page, limit: HANDOVER_PAGE_SIZE };
  if (section.today) {
    const day = istDayBounds(now);
    if (day) Object.assign(filters, { from: day.start, to: day.end });
  }
  return filters;
}

/**
 * Whether a checked-in booking is overdue: the server's flag (isOverdue on the detail,
 * flags.overdue in the lists, set by the sweeper) or, between sweeps, more than 15 minutes past
 * its end.
 */
export function isOverdueAt(booking, now = Date.now()) {
  if (booking?.status !== 'checked_in') return false;
  if (booking.isOverdue === true || booking.flags?.overdue === true) return true;
  const end = toDate(booking.end);
  return Boolean(end) && now > end.getTime() + OVERDUE_GRACE_MINUTES * MINUTE;
}

/** Minutes past the end (0 when not past it), or null without an end. */
export function minutesPastEnd(booking, now = Date.now()) {
  const end = toDate(booking?.end);
  if (!end) return null;
  return Math.max(0, Math.floor((now - end.getTime()) / MINUTE));
}

/**
 * Where an approved booking is in its check-in window (api.md: opens 15 minutes before start,
 * closes at end): 'early', 'open', 'ended', or null without times.
 */
export function checkInWindow(booking, now = Date.now()) {
  const start = toDate(booking?.start);
  const end = toDate(booking?.end);
  if (!start || !end) return null;
  if (now < start.getTime() - CHECK_IN_OPENS_MINUTES * MINUTE) return 'early';
  if (now < end.getTime()) return 'open';
  return 'ended';
}

/** Minutes the item came back after its end (0 when on time), from checkOut.at; null without. */
export function lateReturnMinutes(booking) {
  const end = toDate(booking?.end);
  const returned = toDate(booking?.checkOut?.at);
  if (!end || !returned) return null;
  return Math.max(0, Math.floor((returned.getTime() - end.getTime()) / MINUTE));
}

// ── Return check ──────────────────────────────────────────────────────────────

/** A resource checklist ['Nozzle clean', …] → the manager's unanswered checks. */
export function emptyChecks(checklist) {
  return (Array.isArray(checklist) ? checklist : [])
    .filter((label) => typeof label === 'string' && label)
    .map((label) => ({ label, ok: null, note: '' }));
}

/**
 * The resource checklist next to the check-in and check-out reports: one row per label (the
 * checklist's order, then any label only a report has), each side { ok, note } or null, and
 * `changed` when an item that was OK at check-in isn't at check-out.
 */
export function compareChecklists(checklist, checkIn, checkOut) {
  const entries = (report) =>
    new Map(
      (Array.isArray(report?.items) ? report.items : [])
        .filter((item) => item && typeof item.label === 'string')
        .map((item) => [item.label, { ok: item.ok === true, note: asText(item.note) }])
    );
  const before = entries(checkIn);
  const after = entries(checkOut);
  const labels = [
    ...(Array.isArray(checklist) ? checklist.filter((l) => typeof l === 'string' && l) : []),
  ];
  for (const label of [...before.keys(), ...after.keys()]) {
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.map((label) => {
    const atCheckIn = before.get(label) ?? null;
    const atCheckOut = after.get(label) ?? null;
    return {
      label,
      checkIn: atCheckIn,
      checkOut: atCheckOut,
      changed: Boolean(atCheckIn?.ok && atCheckOut && !atCheckOut.ok),
    };
  });
}

/**
 * The manager's return check → { field: message } for what has to change before it is sent
 * (frontend.md §9 "Condition report" and "Incident"; api.md confirm-return):
 * - every checklist item answered (`items.<i>`), with a note on one that isn't OK
 *   (`items.<i>.note`, at most 200 characters);
 * - "All good" with an item marked not OK is a contradiction (`outcome`);
 * - `note` at most 1000 characters;
 * - an issue needs `incident.type`, `incident.severity` and `incident.description` (20–2000).
 */
export function validateReturn({ outcome, checks, note, incident } = {}) {
  const errors = {};
  const list = Array.isArray(checks) ? checks : [];
  list.forEach((check, i) => {
    if (check?.ok !== true && check?.ok !== false) {
      errors[`items.${i}`] = 'Mark this item OK or not OK.';
      return;
    }
    const text = trimmed(check.note);
    if (check.ok === false && !text) errors[`items.${i}.note`] = "Say what's wrong with it.";
    else if (text.length > ITEM_NOTE_MAX) {
      errors[`items.${i}.note`] = `Use at most ${ITEM_NOTE_MAX} characters (now ${text.length}).`;
    }
  });
  const notOk = list.filter((check) => check?.ok === false).length;
  if (outcome === 'ok' && notOk > 0) {
    errors.outcome = `You marked ${plural(notOk, 'item')} not OK. Report an issue instead, or change ${
      notOk === 1 ? 'that item' : 'those items'
    }.`;
  }
  const noteText = trimmed(note);
  if (noteText.length > REPORT_NOTES_MAX) {
    errors.note = `Use at most ${REPORT_NOTES_MAX} characters (now ${noteText.length}).`;
  }
  if (outcome === 'issue') {
    if (!INCIDENT_TYPES.some((t) => t.value === incident?.type)) {
      errors['incident.type'] = 'Choose the kind of issue.';
    }
    if (!INCIDENT_SEVERITIES.some((s) => s.value === incident?.severity)) {
      errors['incident.severity'] = 'Choose how serious it is.';
    }
    const description = trimmed(incident?.description);
    if (!description) errors['incident.description'] = 'Describe what happened.';
    else if (description.length < INCIDENT_DESCRIPTION_MIN) {
      errors['incident.description'] = `Use at least ${INCIDENT_DESCRIPTION_MIN} characters (now ${description.length}).`;
    } else if (description.length > INCIDENT_DESCRIPTION_MAX) {
      errors['incident.description'] = `Use at most ${INCIDENT_DESCRIPTION_MAX} characters (now ${description.length}).`;
    }
  }
  return errors;
}

/**
 * The form → the useConfirmReturn variables { outcome, items, photos, note, incident? }. The
 * checklist goes as answered; buildReturnBody (bookings/api.js) trims, drops blank notes and leaves
 * out what is empty.
 */
export function returnInput({ outcome, checks, photos, note, incident } = {}) {
  const input = {
    outcome,
    items: (Array.isArray(checks) ? checks : []).map((check) => ({
      label: check.label,
      ok: check.ok === true,
      note: check.note,
    })),
    photos: Array.isArray(photos) ? photos : [],
    note,
  };
  if (outcome === 'issue') {
    input.incident = {
      type: incident?.type,
      severity: incident?.severity,
      description: incident?.description,
    };
  }
  return input;
}

// The server names the incident's fields without the `incident.` prefix (model messages).
const SERVER_FIELD_MAP = {
  type: 'incident.type',
  severity: 'incident.severity',
  description: 'incident.description',
  incident: 'incident.description',
  note: 'note',
  notes: 'note',
  outcome: 'outcome',
};

/**
 * A failed confirm-return → { fields: { formField: message }, other: [message] }: VALIDATION_ERROR
 * details on a field the form shows go beside it; the rest (the checklist changed meanwhile:
 * "Missing: …") are listed above the buttons.
 */
export function returnErrorsFrom(err) {
  const fields = {};
  const other = [];
  if (err?.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return { fields, other };
  for (const [path, message] of Object.entries(fieldErrorsFrom(err))) {
    let key = SERVER_FIELD_MAP[path] ?? null;
    if (!key && /^photos(\.\d+)?$/.test(path)) key = 'photos';
    if (!key) {
      const item = /^items\.(\d+)(?:\.(ok|note))?$/.exec(path);
      if (item) key = item[2] === 'note' ? `items.${item[1]}.note` : `items.${item[1]}`;
    }
    if (key && !(key in fields)) fields[key] = message;
    else if (!key) other.push(message);
  }
  // A list-wide "items" problem can come once per missing label: keep each line.
  for (const detail of err.details) {
    if (detail?.path === 'items' && detail.message && !other.includes(String(detail.message))) {
      other.push(String(detail.message));
    }
  }
  return { fields, other };
}

/** The order the return form's fields appear in, to focus the first one with an error. */
export function firstErrorField(errors, checkCount = 0) {
  const order = [];
  for (let i = 0; i < checkCount; i += 1) order.push(`items.${i}`, `items.${i}.note`);
  order.push('note', 'photos', 'outcome', 'incident.type', 'incident.severity', 'incident.description');
  return order.find((key) => errors?.[key]) ?? null;
}

/** The success line after confirm-return, from its { booking, incident } answer. */
export function returnMessage(result, { outcome, title } = {}) {
  const what = asText(title) || 'the resource';
  const flagged = result?.booking?.status === 'flagged' || outcome === 'issue';
  return flagged
    ? `Issue reported for ${what}. The booking stays flagged until the incident is resolved.`
    : `Return confirmed for ${what}. The booking is completed.`;
}

/** How a finished return check reads: "All good" / "Issue reported", or null. */
export function confirmationOutcomeLabel(outcome) {
  if (outcome === 'ok') return 'All good';
  if (outcome === 'issue') return 'Issue reported';
  return null;
}
