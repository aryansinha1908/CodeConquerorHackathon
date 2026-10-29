// Pure helpers for /manage/badges (frontend.md §6.3): how a queue row reads, who may decide it, the
// grant form's checks and the success lines. They read data shaped as docs/api.md "Badges and
// badge requests" describes and never make up values, so the tests can check them without a
// browser.

import { Ban, CheckCircle2, Clock, TimerOff, XCircle } from 'lucide-react';
import { idOf } from '../../bookings/api';
import { formatIstDate, formatIstDateTime } from '../../../lib/time';
import { isAdmin, requesterView } from '../components/manageView';
import { BADGE_TEXT_MAX } from './api';

const DAY = 24 * 60 * 60 * 1000;
const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// The queue's status filter (GET /badge-requests ?status), in the order a manager works it.
export const STATUS_FILTERS = [
  { value: 'requested', label: 'Requested' },
  { value: 'active', label: 'Granted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'revoked', label: 'Revoked' },
];

// A row's `state` (api.md: show state, not status; "expired" exists only in state). Colour, icon
// and label together (frontend.md §1 principle 2); gold, not amber, keeps 4.5:1 on dark text.
export const BADGE_STATES = {
  requested: { variant: 'gold', icon: Clock, label: 'Requested' },
  active: { variant: 'forest', icon: CheckCircle2, label: 'Active' },
  expired: { variant: 'slate', icon: TimerOff, label: 'Expired' },
  rejected: { variant: 'red', icon: XCircle, label: 'Rejected' },
  revoked: { variant: 'slate', icon: Ban, label: 'Revoked' },
};

export function badgeStateView(row) {
  return BADGE_STATES[row?.state] ?? BADGE_STATES[row?.status] ?? BADGE_STATES.requested;
}

export const EMPTY_TEXT = {
  requested: {
    title: 'No badge requests waiting',
    description:
      'Members ask for your units’ badges from their Badges page. New requests appear here, oldest first.',
  },
  active: { title: 'No granted badges', description: 'Badges you approve or grant directly appear here.' },
  rejected: { title: 'No rejected requests', description: 'Rejections and their reasons appear here.' },
  revoked: { title: 'No revoked badges', description: 'Revoked badges appear here.' },
};

// Quick picks for a rejection (frontend.md §7 ReasonDialog); the manager can edit them.
export const REJECT_TEMPLATES = [
  'Please attach your training certificate as evidence.',
  'Complete the safety induction at the unit first.',
  "The evidence doesn't show this training.",
  'Book a supervised session with the unit before requesting.',
];

/** validityDays → "Never expires" / "Valid for 1 day" / "Valid for 365 days". */
export function validityText(validityDays) {
  const days = Number(validityDays);
  if (validityDays == null || !Number.isInteger(days) || days <= 0) return 'Never expires';
  return `Valid for ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * What approving or granting a badge now would set (api.md: expiresAt = now + validityDays, or
 * null): "It expires on 29 Oct 2027." or "It never expires."
 */
export function expiryOnGrant(validityDays, now = Date.now()) {
  const days = Number(validityDays);
  if (validityDays == null || !Number.isInteger(days) || days <= 0) return 'It never expires.';
  return `It expires on ${formatIstDate(now + days * DAY, { year: true })}.`;
}

/** A row's badge → "3D Printing Basics · Design and Innovation Centre". */
export function badgeLine(badge) {
  const name = asText(badge?.name) || 'A badge';
  const unit = asText(badge?.orgUnit?.name);
  return unit ? `${name} · ${unit}` : name;
}

/** Whether the row has an evidence file to open (hasEvidence, or the queue's evidence ref). */
export function hasEvidence(row) {
  return row?.hasEvidence === true || Boolean(row?.evidence?.publicId);
}

/** Whether the row is the signed-in user's own request. */
export function isOwnRequest(row, user) {
  const requester = idOf(row?.user);
  return Boolean(requester && user?._id && requester === String(user._id));
}

/**
 * Whether this user may decide the row now: it is still requested, and it isn't their own unless
 * they are an admin (api.md PATCH /badge-requests/:id: "Your own request only as an admin").
 */
export function canDecide(row, user) {
  return row?.status === 'requested' && (!isOwnRequest(row, user) || isAdmin(user));
}

export const OWN_REQUEST_MESSAGE =
  "You can't decide on your own badge request. Another manager of this unit or an admin must.";

/**
 * A queue row → the text a card shows: member (name, member type, department; never an email),
 * badge, note, times in IST and the decision.
 */
export function requestView(row) {
  const r = row && typeof row === 'object' ? row : {};
  const member = requesterView(r.user);
  const badge = r.badge && typeof r.badge === 'object' ? r.badge : {};
  return {
    id: idOf(r),
    member,
    badgeName: asText(badge.name) || 'A badge',
    badgeCode: asText(badge.code),
    unitName: asText(badge.orgUnit?.name),
    validity: validityText(badge.validityDays),
    evidenceRequired: badge.evidenceRequired === true,
    note: trimmed(r.note),
    reason: trimmed(r.reason),
    requestedAt: formatIstDateTime(r.requestedAt),
    decidedAt: formatIstDateTime(r.decidedAt),
    decidedBy: asText(r.decidedBy?.name) || null,
    expiresAt: r.expiresAt ? formatIstDateTime(r.expiresAt) : null,
    hasEvidence: hasEvidence(r),
  };
}

/** The success line after a decision: toast and live region. */
export function decisionMessage(decision, row) {
  const { member, badgeName } = requestView(row);
  return decision === 'approve'
    ? `Granted ${badgeName} to ${member.name}.`
    : `Rejected ${member.name}'s request for ${badgeName}.`;
}

/** What a failed decision means for the page: 'stale' (reload the queue) or 'stay' (retry). */
export function decisionFailure(err) {
  return err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND' ? 'stale' : 'stay';
}

// ── Grant directly ────────────────────────────────────────────────────────────

/** user.managedOrgUnits (ids or populated) → their ids as strings. */
export function managedUnitIds(user) {
  return (Array.isArray(user?.managedOrgUnits) ? user.managedOrgUnits : [])
    .map((unit) => idOf(unit))
    .filter(Boolean);
}

/**
 * The badges of GET /badges → [{ unit: { _id, name }, badges }] by unit name, badges by name, for
 * the picker's <optgroup>s.
 */
export function groupBadgesByUnit(badges) {
  const groups = new Map();
  for (const badge of Array.isArray(badges) ? badges : []) {
    if (!badge?._id) continue;
    const unitId = idOf(badge.orgUnit) ?? 'none';
    if (!groups.has(unitId)) {
      groups.set(unitId, { unit: { _id: unitId, name: asText(badge.orgUnit?.name) || 'Other badges' }, badges: [] });
    }
    groups.get(unitId).badges.push(badge);
  }
  const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return [...groups.values()]
    .map((group) => ({ ...group, badges: group.badges.sort((a, b) => byName(asText(a.name), asText(b.name))) }))
    .sort((a, b) => byName(a.unit.name, b.unit.name));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The grant form { badgeId, email, note } → { body, errors }. body ({ badgeId, email, note? }) is
 * null while errors has a field. The email must look like one; a manager can't grant to their own
 * address (the server would refuse it; an admin may). The note is optional, at most 500
 * characters. The server checks everything again and matches the email itself.
 */
export function readGrant({ badgeId, email, note } = {}, user = null) {
  const errors = {};
  const cleanEmail = trimmed(email);
  const cleanNote = trimmed(note);
  if (!badgeId) errors.badgeId = 'Choose a badge.';
  if (!cleanEmail) errors.email = "Enter the member's email address.";
  else if (!EMAIL_RE.test(cleanEmail)) errors.email = 'Enter a valid email address, like name@nitjsr.ac.in.';
  else if (
    !isAdmin(user) &&
    typeof user?.email === 'string' &&
    user.email.trim().toLowerCase() === cleanEmail.toLowerCase()
  ) {
    errors.email = "You can't grant a badge to yourself. Another manager of this unit or an admin must.";
  }
  if (cleanNote.length > BADGE_TEXT_MAX) {
    errors.note = `Use at most ${BADGE_TEXT_MAX} characters (now ${cleanNote.length}).`;
  }
  if (Object.keys(errors).length) return { body: null, errors };
  return { body: { badgeId, email: cleanEmail, ...(cleanNote && { note: cleanNote }) }, errors };
}

/** The success line of a grant, from its answer (the queue row). */
export function grantMessage(row, fallbackBadge) {
  const r = row && typeof row === 'object' ? row : {};
  const badgeName = asText(r.badge?.name) || asText(fallbackBadge?.name) || 'the badge';
  const name = asText(r.user?.name) || 'the member';
  const expiry = r.expiresAt ? ` It expires on ${formatIstDate(r.expiresAt, { year: true })}.` : '';
  return `Granted ${badgeName} to ${name}.${expiry}`;
}
