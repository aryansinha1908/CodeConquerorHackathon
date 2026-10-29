import { AlertCircle, BadgeCheck, Eye, ShieldAlert } from 'lucide-react';
import { bookingStatusOf } from '../../../lib/bookingStatus';
import { formatIstShortDateTime } from '../../../lib/time';
import { INCIDENT_OUTCOMES, INCIDENT_SEVERITIES, INCIDENT_TYPES } from '../api';
import { canReportIssue } from '../../bookings/components/bookingView';
import { idOf, isBorrower } from '../../bookings/api';
import { requesterView, slotText } from '../../manage/components/manageView';

// Pure helpers for the incident pages (frontend.md §6.2–§6.4): what an incident says on screen and
// who may do what with it. Each reader takes the objects docs/api.md "Incidents" describes and copes
// with a missing or odd field, so a page never renders an object as text. The server decides every
// permission again; these only pick what to show and explain a "no" (frontend.md §1).

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// ── Labels and styles (never colour alone: icon and text too, frontend.md §1 principle 2) ────────

export const INCIDENT_STATUS_STYLES = {
  open: { variant: 'amber', icon: AlertCircle, label: 'Open' },
  in_review: { variant: 'blue', icon: Eye, label: 'In review' },
  resolved: { variant: 'emerald', icon: BadgeCheck, label: 'Resolved' },
};

/** An incident status → { variant, icon, label }; an unknown one shows as itself, in neutral. */
export function incidentStatusView(status) {
  return (
    INCIDENT_STATUS_STYLES[status] ?? {
      variant: 'neutral',
      icon: null,
      label: status ? asText(status).replace(/_/g, ' ') : 'Unknown',
    }
  );
}

/** One sentence on where an incident stands and what happens next (frontend.md §1). */
export function incidentStatusText(incident) {
  switch (incident?.status) {
    case 'open':
      return incident.severity === 'high'
        ? 'Waiting for an admin to look into it.'
        : "Waiting for the unit's managers to look into it.";
    case 'in_review':
      return 'Staff are looking into it. Add anything that helps in the thread.';
    case 'resolved':
      return 'Resolved: the outcome and the reason are below.';
    default:
      return null;
  }
}

export const SEVERITY_STYLES = {
  low: { variant: 'neutral', icon: null, label: 'Low severity' },
  medium: { variant: 'amber', icon: null, label: 'Medium severity' },
  high: { variant: 'red', icon: ShieldAlert, label: 'High severity' },
};

/** A severity → { variant, icon, label } ("High severity" with a shield). */
export function severityView(severity) {
  return SEVERITY_STYLES[severity] ?? { variant: 'neutral', icon: null, label: 'Severity not set' };
}

/** damage → "Damage", delay → "Late return"; an unknown type shows as itself. */
export function typeLabel(type) {
  return INCIDENT_TYPES.find((t) => t.value === type)?.label ?? (asText(type).replace(/_/g, ' ') || 'Issue');
}

/** low → "Low"; an unknown severity shows as itself. */
export function severityLabel(severity) {
  return INCIDENT_SEVERITIES.find((s) => s.value === severity)?.label ?? asText(severity);
}

const TYPE_HINTS = {
  damage: 'Something is broken, scratched, bent or missing.',
  delay: 'It came back after the booking ended.',
  misuse: 'Used against the usage rules.',
  safety: 'A hazard to people: smoke, sparks, exposed wiring, a spill.',
  conflict: 'A dispute over the slot or the item.',
  other: 'Anything else the unit should know.',
};

const SEVERITY_HINTS = {
  low: 'Cosmetic or minor. It can still be used.',
  medium: 'It needs attention before the next booking.',
  high: 'Unsafe or out of action. The admins are told, and an admin resolves it.',
};

/** The report form's type choices: { value, label, description }. */
export function typeOptions() {
  return INCIDENT_TYPES.map((t) => ({ ...t, description: TYPE_HINTS[t.value] }));
}

/** The report form's severity choices: { value, label, description }. */
export function severityOptions() {
  return INCIDENT_SEVERITIES.map((s) => ({ ...s, description: SEVERITY_HINTS[s.value] }));
}

/** An outcome → { value, label, description }; an unknown one shows as itself. */
export function outcomeView(outcome) {
  return (
    INCIDENT_OUTCOMES.find((o) => o.value === outcome) ?? {
      value: asText(outcome),
      label: asText(outcome).replace(/_/g, ' ') || 'Resolved',
      description: '',
    }
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * Where an incident page sits: 'manage' under /manage, 'admin' under /admin, else 'member'. It picks
 * the back link, the list the page belongs to and the heading level (the manage and admin layouts
 * have their own h1).
 */
export function incidentScopeOf(pathname) {
  const pathText = asText(pathname);
  if (pathText === '/manage' || pathText.startsWith('/manage/')) return 'manage';
  if (pathText === '/admin' || pathText.startsWith('/admin/')) return 'admin';
  return 'member';
}

/** The detail route of an incident in a scope: /manage/incidents/:id, /admin/… or /incidents/:id. */
export function incidentPath(id, scope = 'member') {
  const safe = encodeURIComponent(asText(id));
  if (scope === 'manage') return `/manage/incidents/${safe}`;
  if (scope === 'admin') return `/admin/incidents/${safe}`;
  return `/incidents/${safe}`;
}

/** The list a scope's detail page goes back to, or null (a member has no incident list). */
export function incidentListPath(scope) {
  if (scope === 'manage') return '/manage/incidents';
  if (scope === 'admin') return '/admin/incidents';
  return null;
}

/** The admin audit log filtered to one entity (judge step 12): /admin/audit?entityType=…&entityId=…. */
export function auditPath(entityType, entityId) {
  const params = new URLSearchParams({ entityType: asText(entityType), entityId: asText(entityId) });
  return `/admin/audit?${params.toString()}`;
}

/** Heading elements for a scope: the member pages own their h1; under a layout's h1 they shift down. */
export function headingsFor(scope) {
  return scope === 'member' ? { page: 'h1', section: 'h2' } : { page: 'h2', section: 'h3' };
}

// ── What an incident says ─────────────────────────────────────────────────────

/** The resource's title from a populated incident, or a fallback that is never an object. */
export function incidentResourceTitle(incident, fallback = 'Resource') {
  const resource = incident?.resource;
  return (resource && typeof resource === 'object' && trimmed(resource.title)) || fallback;
}

/** A resource card (GET /resources or /resources/:id) → the report picker's { _id, title, unit, status }. */
export function toPick(resource) {
  if (!resource || typeof resource !== 'object' || !resource._id) return null;
  return {
    _id: String(resource._id),
    title: trimmed(resource.title) || 'Resource',
    unit: unitLabel(resource.orgUnit),
    status: typeof resource.status === 'string' ? resource.status : null,
  };
}

/** "Damage: FDM 3D Printer #2". */
export function incidentTitle(incident) {
  return `${typeLabel(incident?.type)}: ${incidentResourceTitle(incident)}`;
}

/** "Design and Innovation Centre (DIC)", or null. */
export function unitLabel(orgUnit) {
  if (!orgUnit || typeof orgUnit !== 'object') return null;
  const name = trimmed(orgUnit.name);
  const code = trimmed(orgUnit.code).toUpperCase();
  if (name && code) return `${name} (${code})`;
  return name || code || null;
}

/**
 * Who raised it: "Aarav Student, the borrower" (source user), "Priya Manager, unit staff" (source
 * manager), or "Raised automatically for a late return" (source system, reportedBy null).
 */
export function reporterText(incident) {
  const name = trimmed(incident?.reportedBy?.name);
  if (incident?.source === 'system' || !incident?.reportedBy) {
    return 'Raised automatically for a late return';
  }
  if (incident.source === 'user') return `${name || 'The borrower'}, the borrower`;
  return `${name || 'A manager'}, unit staff`;
}

/** The first `max` characters of a description on one line, with "…" when cut. */
export function excerpt(value, max = 160) {
  const flat = asText(value).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** "3 comments", "1 comment", "No comments". */
export function commentCountText(count) {
  const n = Number(count) || 0;
  if (!n) return 'No comments';
  return `${n} ${n === 1 ? 'comment' : 'comments'}`;
}

/**
 * The booking an incident is on, as the pages show it: { id, slot, status (the booking status
 * view), borrower: { name, memberType, department } }, or null when it isn't tied to one.
 */
export function incidentBookingView(incident) {
  const booking = incident?.booking;
  if (!booking || typeof booking !== 'object' || !booking._id) return null;
  return {
    id: asText(booking._id),
    slot: slotText(booking.start, booking.end),
    status: bookingStatusOf(booking),
    borrower: booking.borrower && typeof booking.borrower === 'object' ? requesterView(booking.borrower) : null,
  };
}

/** The resolution as shown: { outcome, rationale, by, at } (at as "3 Nov, 14:30 IST"), or null. */
export function resolutionView(resolution) {
  if (!resolution || typeof resolution !== 'object' || !resolution.outcome) return null;
  const at = formatIstShortDateTime(resolution.at);
  return {
    outcome: outcomeView(resolution.outcome),
    rationale: asText(resolution.rationale),
    by: trimmed(resolution.decidedBy?.name) || 'A manager',
    at: at ? `${at} IST` : null,
  };
}

/**
 * What resolving did to the booking: bookingClosed (from POST /incidents/:id/resolve) means it was
 * the flagged booking's last open incident, so the booking is now completed. A booking still flagged
 * waits for its other incidents. Null when there's nothing to say.
 */
export function bookingAfterResolve(incident, bookingClosed) {
  if (bookingClosed === true) {
    return 'This was the last open incident on the booking, so the booking is now completed.';
  }
  if (incident?.status === 'resolved' && incident?.booking?.status === 'flagged') {
    return 'The booking stays flagged until its other incidents are resolved.';
  }
  return null;
}

/** "You" for the signed-in user's own comment, else the author's name. */
export function commentAuthor(comment, user) {
  const by = comment?.by;
  if (user?._id && idOf(by) === String(user._id)) return 'You';
  return trimmed(by?.name) || 'Someone';
}

// ── Permissions (the server decides; these explain) ──────────────────────────

export function isAdmin(user) {
  return Array.isArray(user?.roles) && user.roles.includes('admin');
}

/** Whether the user manages `orgUnit` (a populated unit or an id) as a manager. */
export function managesUnit(user, orgUnit) {
  const unit = idOf(orgUnit);
  if (!unit || !Array.isArray(user?.roles) || !user.roles.includes('manager')) return false;
  const managed = Array.isArray(user.managedOrgUnits) ? user.managedOrgUnits.map((u) => idOf(u)) : [];
  return managed.includes(unit);
}

/** Managers and admins may report an incident without a booking (on their units' resources). */
export function canReportWithoutBooking(user) {
  return Array.isArray(user?.roles) && (user.roles.includes('manager') || user.roles.includes('admin'));
}

/**
 * Why this viewer has no "Resolve" button on an unresolved incident (api.md resolve: the unit's
 * managers for low and medium severity, admins for any; nobody but an admin on their own
 * booking), or null when they have it, it's resolved, or there's nothing to explain.
 */
export function resolveHint(incident, user) {
  if (!incident || incident.status === 'resolved' || incident.canResolve === true) return null;
  const unit = trimmed(incident.orgUnit?.name) || "the unit";
  const admin = isAdmin(user);
  const manager = managesUnit(user, incident.orgUnit);
  if (manager && !admin) {
    if (incident.severity === 'high') {
      return 'A high-severity incident is resolved by an admin. You can still add to the thread.';
    }
    if (incident.booking?.borrower && idOf(incident.booking.borrower) === String(user?._id ?? '')) {
      return "You can't resolve an incident on your own booking. Another manager of this unit or an admin must.";
    }
  }
  if (!admin && !manager) {
    return incident.severity === 'high'
      ? `An admin reviews it and decides the outcome. You'll get a notification.`
      : `A manager of ${unit} reviews it and decides the outcome. You'll get a notification.`;
  }
  return null;
}

/**
 * Why this booking can't take a report now, or null when it can: POST /incidents takes a booking
 * that is approved, in use, returned, completed or flagged, and its borrower up to 7 days after it
 * ends (managers and admins have no limit). The server checks it again.
 */
export function reportBlock(booking, user, now = Date.now()) {
  if (!booking || canReportIssue(booking, user, now)) return null;
  const label = bookingStatusOf(booking).label.toLowerCase();
  const reportable = ['approved', 'checked_in', 'checked_out', 'completed', 'flagged'].includes(booking.status);
  if (!reportable) {
    return {
      title: "This booking can't take a report",
      message: `Incidents can't be reported on a booking that is ${label}.`,
    };
  }
  if (isBorrower(booking, user)) {
    return {
      title: 'The reporting window has closed',
      message: "Incidents can be reported up to 7 days after a booking ends. Contact the unit's managers instead.",
    };
  }
  return null;
}
