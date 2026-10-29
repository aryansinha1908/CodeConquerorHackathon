import { bookingStatusOf } from '../../../lib/bookingStatus';
import {
  formatDuration,
  formatIstDate,
  formatIstRange,
  formatIstShortDateTime,
  formatIstTime,
  formatRelative,
  minutesBetween,
  toDate,
} from '../../../lib/time';
import { MINE_TABS, canDo, checkInOpensAt, idOf, isBorrower } from '../api';

// Pure helpers for the member's booking pages (frontend.md §6.2): what a booking says on screen.
// Every reader takes the objects docs/api.md describes and copes with a missing or odd field, so a
// page never renders an object as text.

const DAY = 24 * 60 * 60 * 1000;
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A resource's location ({ building?, room?, floor? }, api.md "Resources") → "Prototyping Lab,
 * Design and Innovation Centre, Ground floor", or null when nothing is set. A plain string is kept.
 */
export function formatLocation(location) {
  if (typeof location === 'string') return text(location) || null;
  if (!location || typeof location !== 'object') return null;
  const room = text(location.room);
  const building = text(location.building);
  const floor = text(location.floor);
  const floorText = !floor
    ? ''
    : /^\d+$/.test(floor)
      ? `Floor ${floor}`
      : /floor/i.test(floor)
        ? floor
        : `${floor} floor`;
  const parts = [room, building, floorText].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** "Tue 3 Nov, 10:00–12:00 IST" (or across days "Tue 3 Nov, 16:00 – 5 Nov, 10:00 IST"), or null. */
export function formatSlot(start, end) {
  const range = formatIstRange(start, end);
  if (!range) return null;
  const weekday = formatIstDate(start, { weekday: true })?.split(',')[0];
  return `${weekday} ${range} IST`;
}

/** "2 h", "1 h 30 min", "3 days" for a booking's length, or null. */
export function slotLength(start, end) {
  const minutes = minutesBetween(start, end);
  return minutes != null && minutes > 0 ? formatDuration(minutes) : null;
}

/** The resource's title from a populated booking, or a fallback that is never an object. */
export function resourceTitle(booking, fallback = 'Booking') {
  const resource = booking?.resource;
  return (resource && typeof resource === 'object' && text(resource.title)) || fallback;
}

/** ?tab= → one of MINE_TABS (Upcoming when missing or unknown). */
export function readTab(value) {
  return MINE_TABS.find((tab) => tab.id === value) ?? MINE_TABS[0];
}

export const TAB_EMPTY = {
  upcoming: {
    title: 'Nothing coming up',
    description: 'Approved bookings and the ones in use appear here. Find a resource to book.',
  },
  requests: {
    title: 'No open requests',
    description: 'Requests waiting for a manager, and your waitlist places, appear here.',
  },
  past: {
    title: 'No past bookings yet',
    description: 'Returned, completed, cancelled and rejected bookings appear here.',
  },
};

// Statuses a member may report an incident on (api.md "Incidents": POST /incidents).
const REPORTABLE = ['approved', 'checked_in', 'checked_out', 'completed', 'flagged'];
const REPORT_WINDOW_DAYS = 7;

/**
 * Whether to offer "Report an issue": the booking is approved, in use, returned, completed or
 * flagged, and a borrower is at most 7 days past its end (managers and admins have no limit). The
 * server checks it all again.
 */
export function canReportIssue(booking, user, now = Date.now()) {
  if (!REPORTABLE.includes(booking?.status)) return false;
  if (!isBorrower(booking, user)) return true;
  const end = toDate(booking.end);
  return !end || toDate(now).getTime() <= end.getTime() + REPORT_WINDOW_DAYS * DAY;
}

// The statuses a waitlisted request reaches through a promotion (pending, or approved at once) and
// what follows from there; a reject or cancel after it stores its own decision or cancellation.
const PROMOTED_STATUSES = ['pending', 'approved', 'checked_in', 'checked_out', 'completed', 'flagged', 'no_show'];

/**
 * The latest decision as the member reads it: { title, reason, reasonLabel, at, tone, expectsReason }
 * or null (`expectsReason`: a reject or waitlist, which the server only takes with a reason).
 * A promoted request keeps its old "waitlist" decision on the server, so the wording follows the
 * current status rather than the stored action alone.
 */
export function decisionSummary(booking, user) {
  if (!booking || typeof booking !== 'object') return null;
  const status = booking.status;
  const cancellation = booking.cancellation;
  if (status === 'cancelled' && cancellation && typeof cancellation === 'object') {
    const by = idOf(cancellation.by);
    const borrower = idOf(booking.borrower);
    const title = !by
      ? 'Cancelled automatically'
      : by === borrower
        ? isBorrower(booking, user)
          ? 'You cancelled this booking'
          : 'Cancelled by the borrower'
        : 'Cancelled by a manager';
    return { title, reason: text(cancellation.reason) || null, reasonLabel: 'Reason', at: cancellation.at ?? null, tone: 'slate' };
  }
  const decision = booking.decision;
  if (!decision || typeof decision !== 'object') return null;
  const reason = text(decision.reason) || null;
  const at = decision.at ?? null;
  if (decision.action === 'reject') {
    return { title: 'Request rejected', reason, reasonLabel: 'Reason', at, tone: 'red', expectsReason: true };
  }
  if (decision.action === 'waitlist') {
    // Only a promotion leads from the waitlist to these statuses. A request the sweeper expired
    // (its slot never freed) keeps the waitlist decision too, but it was never promoted.
    return PROMOTED_STATUSES.includes(status)
      ? { title: 'Promoted from the waitlist', reason, reasonLabel: 'Earlier waitlist reason', at, tone: 'green' }
      : { title: 'Moved to the waitlist', reason, reasonLabel: 'Reason', at, tone: 'violet', expectsReason: true };
  }
  if (decision.action === 'approve') {
    if (!decision.by && reason === 'Auto-approved') {
      return { title: 'Approved automatically', reason: null, reasonLabel: 'Note', at, tone: 'green' };
    }
    return { title: 'Approved by a manager', reason, reasonLabel: 'Note', at, tone: 'green' };
  }
  return null;
}

/** One sentence on what a status means and what happens next (frontend.md §1: every "no" has a why). */
export function statusExplanation(booking) {
  const position = Number(booking?.waitlistPosition);
  switch (booking?.status) {
    case 'pending':
      return 'A manager of the unit reviews your request. You get a notification when they decide.';
    case 'approved':
      return 'Your slot is confirmed. Check in when you collect the item, from 15 minutes before the start.';
    case 'waitlisted':
      return Number.isInteger(position) && position > 0
        ? `You're #${position} in line. If the slot frees up, your request moves up automatically.`
        : 'If the slot frees up, your request moves up automatically.';
    case 'checked_in':
      return booking?.isOverdue || booking?.flags?.overdue
        ? 'The end time has passed. Return the item and check out now.'
        : 'The item is with you. Check out when you return it.';
    case 'checked_out':
      return 'A manager checks the item and confirms the return.';
    case 'completed':
      return 'The return was confirmed. Nothing more to do.';
    case 'flagged':
      return 'The manager reported an issue at the return. The booking completes once the incident is resolved.';
    case 'rejected':
      return 'This request was turned down. You can book another slot.';
    case 'cancelled':
      return 'This booking was cancelled and its slot released.';
    case 'expired':
      return booking?.decision?.action === 'waitlist'
        ? "The slot didn't come free for this waitlisted request before its start time, so it lapsed."
        : 'Nobody decided on this request before its start time, so it lapsed.';
    case 'no_show':
      return 'Nobody checked in within 15 minutes of the start, so this counts as a no-show.';
    default:
      return null;
  }
}

/**
 * A short line for a list card: "Starts in 2 h", "Due back 12:00 IST", "Overdue since 12:00
 * IST", "#2 in line", or null.
 */
export function cardHint(booking, now = Date.now()) {
  const status = booking?.status;
  if (status === 'approved') {
    const relative = formatRelative(booking.start, now);
    const start = toDate(booking.start);
    if (!relative || !start) return null;
    return start.getTime() > toDate(now).getTime() ? `Starts ${relative}` : `Started ${relative}`;
  }
  if (status === 'checked_in') {
    const end = formatIstTime(booking.end);
    if (!end) return null;
    return booking.isOverdue || booking.flags?.overdue ? `Overdue since ${end} IST` : `Due back ${end} IST`;
  }
  if (status === 'waitlisted') {
    const position = Number(booking.waitlistPosition);
    return Number.isInteger(position) && position > 0 ? `#${position} in line` : null;
  }
  if (status === 'pending') return 'Waiting for a manager';
  return null;
}

/**
 * Why this viewer can't do the check-in or check-out now: null when allowedActions has it, else
 * { title, message, opensAt?, next? }. `next` names the handover that is open instead.
 */
export function handoverBlock(booking, phase, now = Date.now()) {
  const checkOut = phase === 'check_out';
  if (!booking || canDo(booking, checkOut ? 'checkOut' : 'checkIn')) return null;
  const status = booking.status;
  const label = bookingStatusOf(booking).label.toLowerCase();
  const at = toDate(now).getTime();
  if (!checkOut) {
    if (status === 'approved') {
      const opens = toDate(checkInOpensAt(booking));
      const end = toDate(booking.end);
      if (opens && at < opens.getTime()) {
        return {
          title: "Check-in isn't open yet",
          message: `Check-in opens 15 minutes before the start, at ${formatIstShortDateTime(opens)} IST (${formatRelative(opens, now)}).`,
          opensAt: opens.toISOString(),
        };
      }
      if (end && at > end.getTime()) {
        return { title: 'This booking has ended', message: 'The check-in window closed at the end time.' };
      }
      return {
        title: "You can't check in this booking",
        message: 'Only the borrower or a manager of the unit can check it in.',
      };
    }
    if (status === 'checked_in') {
      return {
        title: 'Already checked in',
        message: 'This booking is in use. Check out when you return the item.',
        next: canDo(booking, 'checkOut') ? 'check_out' : undefined,
      };
    }
    return {
      title: "This booking can't be checked in",
      message: `It is ${label}. Only an approved booking can be checked in.`,
    };
  }
  if (status === 'approved') {
    return {
      title: 'Check in first',
      message: 'Check-out opens once the booking is checked in.',
      next: canDo(booking, 'checkIn') ? 'check_in' : undefined,
    };
  }
  if (status === 'checked_in') {
    return {
      title: "You can't check out this booking",
      message: 'Only the borrower or a manager of the unit can check it out.',
    };
  }
  if (['checked_out', 'completed', 'flagged'].includes(status)) {
    return { title: 'Already checked out', message: 'The return is recorded on the booking.' };
  }
  return {
    title: "This booking can't be checked out",
    message: `It is ${label}. Only a booking in use can be checked out.`,
  };
}

/** The handover route of a booking: /bookings/:id/check-in or /check-out. */
export function handoverPath(id, phase) {
  return `/bookings/${encodeURIComponent(id)}/${phase === 'check_out' ? 'check-out' : 'check-in'}`;
}

/** The booking detail route. */
export function bookingPath(id) {
  return `/bookings/${encodeURIComponent(id)}`;
}

/** "Report an issue" (a later page): /incidents/new?bookingId=<id>. */
export function reportIssuePath(id) {
  return `/incidents/new?bookingId=${encodeURIComponent(id)}`;
}

/** "Approved", "Ended 3 Nov" … : the stage stamps shown on the detail page, from the stored object. */
export function handoverStamps(booking) {
  const stamps = [];
  const push = (label, at) => {
    const shown = formatIstShortDateTime(at);
    if (shown) stamps.push({ label, at, shown: `${shown} IST` });
  };
  push('Requested', booking?.createdAt);
  push('Checked in', booking?.checkIn?.at);
  push('Checked out', booking?.checkOut?.at);
  const outcome = booking?.returnConfirmation?.outcome;
  push(outcome === 'issue' ? 'Return checked: issue reported' : 'Return confirmed', booking?.returnConfirmation?.at);
  return stamps;
}

export const PHASE_LABELS = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  return_confirmation: 'Return check',
};
