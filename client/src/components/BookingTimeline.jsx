import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock,
  AlertTriangle,
  ArrowUpCircle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  ExternalLink,
  History,
  ListOrdered,
  LogIn,
  LogOut,
  Send,
  ShieldAlert,
  TimerOff,
  UserX,
  XCircle,
} from 'lucide-react';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { ErrorState } from './ui/ErrorState';
import { Skeleton } from './ui/Skeleton';
import { formatIstShortDateTime } from '../lib/time';
import { cn } from '../lib/utils';
import { useTimeline } from '../features/bookings/api';

// GET /bookings/:id/timeline (api.md "Bookings"): audit events, condition reports and incidents,
// oldest first, as a vertical timeline with the actor, the IST time and the reason
// (frontend.md §7 BookingTimeline).

const EVENT_STYLES = {
  'booking.requested': { icon: Send, tone: 'bg-white text-[#1a1a1a]' },
  'booking.approved': { icon: CheckCircle2, tone: 'bg-[#1e7e45] text-white' },
  'booking.rejected': { icon: XCircle, tone: 'bg-[#c0392b] text-white' },
  'booking.waitlisted': { icon: ListOrdered, tone: 'bg-[#8e44ad] text-white' },
  'booking.cancelled': { icon: Ban, tone: 'bg-[#5d6d7e] text-white' },
  'booking.promoted': { icon: ArrowUpCircle, tone: 'bg-[#1e7e45] text-white' },
  'booking.expired': { icon: TimerOff, tone: 'bg-[#d5dbe1] text-[#1a1a1a]' },
  'booking.checked_in': { icon: LogIn, tone: 'bg-[#2471a3] text-white' },
  'booking.no_show': { icon: UserX, tone: 'bg-[#be185d] text-white' },
  'booking.checked_out': { icon: LogOut, tone: 'bg-[#1abc9c] text-[#1a1a1a]' },
  'booking.completed': { icon: BadgeCheck, tone: 'bg-[#0b6e4f] text-white' },
  'booking.flagged': { icon: AlertTriangle, tone: 'bg-[#b9470b] text-white' },
  'booking.overdue': { icon: AlarmClock, tone: 'bg-white text-[#c0392b]' },
};

const ROLE_LABELS = { member: 'member', manager: 'manager', admin: 'admin' };

const PHASE_LABELS = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  return_confirmation: 'Return check',
};

const OVERALL_BADGES = {
  good: { variant: 'green', label: 'Good condition' },
  minor_issue: { variant: 'amber', label: 'Minor issue' },
  damaged: { variant: 'red', label: 'Damaged' },
};

const SEVERITY_BADGES = {
  low: { variant: 'neutral', label: 'Low severity' },
  medium: { variant: 'amber', label: 'Medium severity' },
  high: { variant: 'red', label: 'High severity' },
};

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** "Priya Sharma (manager)", "Manager", "System (automatic)", or null without an actor. */
function actorLabel(actor) {
  if (!actor || typeof actor !== 'object') return null;
  if (actor.role === 'system') return 'System (automatic)';
  const role = ROLE_LABELS[actor.role] ?? asText(actor.role);
  const name = asText(actor.name);
  if (name) return role ? `${name} (${role})` : name;
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
}

// The server writes the reason into the event text ('Manager (DIC) rejected: "…"'). It is shown on
// its own line, so the headline drops that copy.
function eventHeadline(item) {
  const full = asText(item.text) || asText(item.action) || 'Booking updated';
  const reason = asText(item.reason);
  const suffix = reason ? `: "${reason}"` : '';
  return suffix && full.endsWith(suffix) ? full.slice(0, -suffix.length) : full;
}

function When({ at }) {
  const shown = formatIstShortDateTime(at);
  if (!shown) return null;
  return <time dateTime={asText(at)}>{shown} IST</time>;
}

function Dot({ icon: Icon, tone }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute -left-[19px] top-0 w-9 h-9 rounded-full border-2 border-[#1a1a1a] flex items-center justify-center shadow-[2px_2px_0_#1a1a1a] ${tone}`}
    >
      <Icon className="w-4 h-4" />
    </span>
  );
}

function Reason({ children, label = 'Reason' }) {
  return (
    <p className="mt-2 text-xs bg-[#f5f0e8] border-l-4 border-[#1a1a1a] px-3 py-2 rounded-r-md break-words">
      <span className="font-bold">{label}: </span>“{children}”
    </p>
  );
}

function EventItem({ item }) {
  const style = EVENT_STYLES[item.action] ?? { icon: CircleDot, tone: 'bg-white text-[#1a1a1a]' };
  const actor = actorLabel(item.actor);
  return (
    <>
      <Dot icon={style.icon} tone={style.tone} />
      <p className="text-sm font-bold break-words">{eventHeadline(item)}</p>
      <p className="text-xs text-[#1a1a1a]/70 mt-0.5">
        <When at={item.at} />
        {actor && <span> · by {actor}</span>}
      </p>
      {item.reason && <Reason>{asText(item.reason)}</Reason>}
    </>
  );
}

function ReportItem({ item, subject }) {
  const phase = PHASE_LABELS[item.phase] ?? 'Condition';
  const overall = OVERALL_BADGES[item.overall];
  const items = Array.isArray(item.items) ? item.items : [];
  const photos = Array.isArray(item.photos) ? item.photos : [];
  const flagged = items.filter((entry) => !entry?.ok).length;
  return (
    <>
      <Dot icon={ClipboardCheck} tone="bg-[#ede8df] text-[#1a1a1a]" />
      <p className="text-sm font-bold break-words">{asText(item.text) || `${phase} report`}</p>
      <p className="text-xs text-[#1a1a1a]/70 mt-0.5">
        <When at={item.at} />
        {item.by && <span> · by {asText(item.by)}</span>}
      </p>
      {overall && (
        <Badge variant={overall.variant} size="sm" className="mt-2">
          {overall.label}
        </Badge>
      )}
      {items.length > 0 && (
        <details className="mt-2 group" open={flagged > 0}>
          <summary className="cursor-pointer text-xs font-bold py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]">
            Checklist: {items.length} {items.length === 1 ? 'item' : 'items'}
            {flagged ? `, ${flagged} flagged` : ', all OK'}
          </summary>
          <ul className="mt-1 space-y-1 text-xs">
            {items.map((entry, index) => (
              <li key={`${asText(entry?.label)}-${index}`} className="flex gap-2">
                {entry?.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1e7e45]" aria-hidden="true" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0 text-[#c0392b]" aria-hidden="true" />
                )}
                <span className="break-words">
                  <span className="sr-only">{entry?.ok ? 'OK: ' : 'Not OK: '}</span>
                  {asText(entry?.label)}
                  {entry?.note && <span className="text-[#1a1a1a]/70"> — {asText(entry.note)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {item.notes && <Reason label="Notes">{asText(item.notes)}</Reason>}
      {photos.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2 max-w-sm" aria-label={`${phase} photos`}>
          {photos.map((photo, index) => {
            const alt = `${phase} photo ${index + 1} of ${photos.length}${subject ? `, ${subject}` : ''}`;
            return (
              <li key={asText(photo?.publicId) || index}>
                <a
                  href={asText(photo?.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md border-2 border-[#1a1a1a] overflow-hidden bg-[#f5f0e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
                >
                  <img
                    src={asText(photo?.url)}
                    alt={alt}
                    loading="lazy"
                    className="block w-full aspect-square object-cover"
                  />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function IncidentItem({ item, incidentHref }) {
  const severity = SEVERITY_BADGES[item.severity];
  const href = incidentHref && item.id ? incidentHref(asText(item.id)) : null;
  return (
    <>
      <Dot
        icon={item.event === 'resolved' ? BadgeCheck : ShieldAlert}
        tone={item.event === 'resolved' ? 'bg-[#0b6e4f] text-white' : 'bg-[#b9470b] text-white'}
      />
      <p className="text-sm font-bold break-words">
        {asText(item.text) || (item.event === 'resolved' ? 'Incident resolved' : 'Incident opened')}
      </p>
      <p className="text-xs text-[#1a1a1a]/70 mt-0.5">
        <When at={item.at} />
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {severity && item.event !== 'resolved' && (
          <Badge variant={severity.variant} size="sm">
            {severity.label}
          </Badge>
        )}
        {href && (
          <Link
            to={href}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#183d2d] underline underline-offset-2 hover:text-[#c0392b] rounded px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            Open the incident
          </Link>
        )}
      </div>
    </>
  );
}

/**
 * The timeline items of GET /bookings/:id/timeline, as given (oldest first). `subject` (the
 * resource's title) goes into the photos' alt text: "Check-in photo 1 of 2, FDM 3D Printer".
 * `incidentHref(id)` links an incident (default /incidents/:id; null for no link).
 */
export function BookingTimeline({
  items,
  subject,
  incidentHref = (id) => `/incidents/${encodeURIComponent(id)}`,
  label = 'Booking history',
  className,
}) {
  const list = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
  if (!list.length) {
    return (
      <EmptyState
        icon={History}
        title="No history yet"
        description="Requests, decisions, check-ins and returns appear here as they happen."
        className={className}
      />
    );
  }
  return (
    <ol
      aria-label={label}
      className={cn('relative ml-[18px] border-l-2 border-[#1a1a1a] space-y-6 font-mono text-[#1a1a1a]', className)}
    >
      {list.map((item, index) => (
        <li
          key={`${index}-${asText(item.kind)}-${asText(item.at)}`}
          className="relative pl-8 min-h-[36px]"
        >
          {item.kind === 'condition_report' ? (
            <ReportItem item={item} subject={subject} />
          ) : item.kind === 'incident' ? (
            <IncidentItem item={item} incidentHref={incidentHref} />
          ) : (
            <EventItem item={item} />
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The timeline of one booking with its own loading, empty and error states: GET
 * /bookings/:id/timeline through useTimeline (['booking', id, 'timeline']). Props as BookingTimeline.
 */
export function BookingHistory({ bookingId, ...props }) {
  const timeline = useTimeline(bookingId);
  if (timeline.isPending) {
    return (
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading the booking history…</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-5/6" />
        <Skeleton className="h-12 w-4/6" />
      </div>
    );
  }
  if (timeline.isError && !timeline.data) {
    return (
      <ErrorState
        error={timeline.error}
        title="Couldn't load the booking history"
        onRetry={() => timeline.refetch()}
        retrying={timeline.isFetching}
      />
    );
  }
  return <BookingTimeline items={timeline.data?.data} {...props} />;
}
