import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Gavel, ImageIcon, Sparkles } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { formatIstDateTime, formatIstShortDateTime } from '../../lib/time';
import { textLinkClass } from '../bookings/components/styles';
import { useIncident, useResolveIncident } from './api';
import { CommentThread } from './components/CommentThread';
import { IncidentStatusBadge, SeverityBadge, TypeBadge } from './components/IncidentBadges';
import { Notice } from './components/Notice';
import { ResolutionCard } from './components/ResolutionCard';
import { ResolveDialog } from './components/ResolveDialog';
import {
  auditPath,
  headingsFor,
  incidentBookingView,
  incidentListPath,
  incidentResourceTitle,
  incidentScopeOf,
  incidentStatusText,
  incidentTitle,
  isAdmin,
  outcomeView,
  reporterText,
  resolveHint,
  unitLabel,
} from './components/incidentView';

// /incidents/:id, also routed at /manage/incidents/:id and /admin/incidents/:id (frontend.md §6.2
// "Incident detail", §6.3, §6.4; judge step 11): the status, the description and photos, the
// booking, the thread with its comment form (closed once resolved), the resolution, and for those
// the server allows (canResolve) the resolve dialog. GET /incidents/:id, POST …/comments and
// …/resolve (api.md "Incidents"). Nothing changes on screen before the server answers.

const backLinkClass = `${textLinkClass} inline-flex items-center gap-1.5 text-sm py-2`;

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase font-bold tracking-wider text-[#1a1a1a]/70">{label}</dt>
      <dd className="text-sm mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading the incident…</span>
      <div className="border-b-2 border-[#1a1a1a] pb-4 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-64" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

function Photos({ photos, subject, Heading }) {
  const list = (Array.isArray(photos) ? photos : []).filter((p) => p && typeof p.url === 'string');
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      <Heading className="text-sm font-bold flex items-center gap-2">
        <ImageIcon className="w-4 h-4" aria-hidden="true" />
        Photos
      </Heading>
      <ul className="grid grid-cols-3 gap-2 max-w-md" aria-label={`Incident photos: ${list.length}`}>
        {list.map((photo, index) => {
          const alt = `Incident photo ${index + 1} of ${list.length}${subject ? `, ${subject}` : ''}`;
          return (
            <li key={String(photo.publicId ?? index)}>
              <a
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md border-2 border-[#1a1a1a] overflow-hidden bg-[#f5f0e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
              >
                <img src={photo.url} alt={alt} loading="lazy" className="block w-full aspect-square object-cover" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DetailsCard({ incident, user, Heading }) {
  const booking = incidentBookingView(incident);
  const resourceId = incident.resource?._id;
  const unit = unitLabel(incident.orgUnit);
  const reported = formatIstDateTime(incident.createdAt);
  const updated = formatIstDateTime(incident.updatedAt);
  const admin = isAdmin(user);
  return (
    <Card className="p-5 space-y-4">
      <Heading className="text-base md:text-lg font-bold tracking-tight">Details</Heading>
      <dl className="space-y-3">
        <Fact label="Resource">
          {resourceId ? (
            <Link to={`/resources/${encodeURIComponent(resourceId)}`} className={textLinkClass}>
              {incidentResourceTitle(incident)}
            </Link>
          ) : (
            incidentResourceTitle(incident)
          )}
        </Fact>
        {unit && <Fact label="Unit">{unit}</Fact>}
        <Fact label="Reported by">{reporterText(incident)}</Fact>
        {reported && (
          <Fact label="Reported">
            <time dateTime={String(incident.createdAt)}>{reported}</time>
          </Fact>
        )}
        {updated && incident.updatedAt !== incident.createdAt && (
          <Fact label="Last updated">
            <time dateTime={String(incident.updatedAt)}>{updated}</time>
          </Fact>
        )}
        <Fact label="Booking">
          {booking ? (
            <span className="space-y-1 block">
              <Link to={`/bookings/${encodeURIComponent(booking.id)}`} className={textLinkClass}>
                Open the booking
              </Link>
              <span className="block text-xs">{booking.slot} IST</span>
              <StatusBadge booking={incident.booking} size="sm" />
              {booking.borrower && (
                <span className="block text-xs text-[#1a1a1a]/70">
                  Borrower: {booking.borrower.name} · {booking.borrower.memberType} · {booking.borrower.department}
                </span>
              )}
            </span>
          ) : (
            'Not tied to a booking'
          )}
        </Fact>
      </dl>
      {/* Any admin, whichever route they came by: the booking history links to /incidents/:id. */}
      {admin && (
        <div className="pt-3 border-t border-[#1a1a1a]/15 space-y-1">
          <p className="text-[11px] uppercase font-bold tracking-wider text-[#1a1a1a]/70">Audit log</p>
          <p className="text-sm">
            <Link to={auditPath('incident', incident._id)} className={`${textLinkClass} inline-flex items-center gap-1`}>
              <FileText className="w-4 h-4" aria-hidden="true" />
              This incident’s entries
            </Link>
          </p>
          {booking && (
            <p className="text-sm">
              <Link to={auditPath('booking', booking.id)} className={`${textLinkClass} inline-flex items-center gap-1`}>
                <FileText className="w-4 h-4" aria-hidden="true" />
                The booking’s entries
              </Link>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// The AI summary (C-14): only for the unit's staff, only when one was generated, always labelled.
function AiSummary({ summary, Heading }) {
  if (!summary || typeof summary !== 'object' || typeof summary.text !== 'string' || !summary.text.trim()) return null;
  const at = formatIstShortDateTime(summary.generatedAt);
  return (
    <Card variant="cream" className="p-5 space-y-2">
      <Heading className="text-sm font-bold flex items-center gap-2">
        <Sparkles className="w-4 h-4" aria-hidden="true" />
        AI suggestion: summary
      </Heading>
      <p className="text-sm whitespace-pre-wrap break-words">{summary.text}</p>
      <p className="text-xs text-[#1a1a1a]/70">
        Generated automatically{at ? ` on ${at} IST` : ''}. Check it against the thread; a person decides the outcome.
      </p>
    </Card>
  );
}

function IncidentDetail({ id }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const scope = incidentScopeOf(location.pathname);
  const { page: PageHeading, section: SectionHeading } = headingsFor(scope);
  const query = useIncident(id);
  const resolve = useResolveIncident();
  const incident = query.data?.data ?? null;

  const headingRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  // bookingClosed from this page's resolve, which GET /incidents/:id doesn't carry.
  const [bookingClosed, setBookingClosed] = useState(null);

  // Arriving from the report form: announce it and focus the heading, then drop the history
  // entry's state so a reload doesn't announce it again (as on the booking page).
  const arrivalRef = useRef(location.state?.announce ?? null);
  const loaded = Boolean(incident);
  useEffect(() => {
    const message = arrivalRef.current;
    if (!message || !loaded) return;
    arrivalRef.current = null;
    headingRef.current?.focus();
    setTimeout(() => setAnnouncement(message), 100);
    navigate('.', { replace: true, state: null });
  }, [loaded, navigate]);

  const listPath = incidentListPath(scope);
  const bookingId = incident?.booking?._id ? String(incident.booking._id) : null;
  const back = listPath
    ? { to: listPath, label: scope === 'admin' ? 'Escalations' : 'Incidents' }
    : bookingId
      ? { to: `/bookings/${encodeURIComponent(bookingId)}`, label: 'The booking' }
      : { to: '/bookings', label: 'My bookings' };

  const openResolve = () => {
    resolve.reset();
    setResolveOpen(true);
  };
  const closeResolve = () => {
    if (resolve.isPending) return;
    setResolveOpen(false);
    resolve.reset(); // a refusal shown in the dialog goes with it
  };
  const submitResolve = ({ outcome, rationale }) => {
    resolve.mutate(
      { id, outcome, rationale, bookingId },
      {
        onSuccess: (result) => {
          const closed = result?.data?.bookingClosed === true;
          const label = outcomeView(outcome).label;
          const message = closed
            ? `Incident resolved: ${label}. The booking is now completed.`
            : `Incident resolved: ${label}.`;
          setBookingClosed(closed);
          setResolveOpen(false);
          setAnnouncement(message);
          toast.success(message);
        },
        onError: (err) => {
          // Resolved by someone else meanwhile, or no longer allowed: the hook refetches the
          // incident; close the dialog so the page shows where things stand.
          if (err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND') setResolveOpen(false);
        },
      }
    );
  };

  const hint = resolveHint(incident, user);
  const subject = incidentResourceTitle(incident, '');

  return (
    <div className="space-y-6 font-mono text-[#1a1a1a]">
      <Link to={back.to} className={backLinkClass}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {back.label}
      </Link>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {query.isPending && <DetailSkeleton />}

      {query.isError && !incident && (
        <div className="space-y-4">
          <PageHeading className="text-2xl font-black tracking-tight">Incident</PageHeading>
          <ErrorState
            error={query.error}
            title="Couldn't load this incident"
            onRetry={() => query.refetch()}
            retrying={query.isFetching}
          >
            {query.error?.status === 404 || query.error?.status === 403 ? (
              <Link to={back.to} className={textLinkClass}>
                Back to {back.label.toLowerCase()}
              </Link>
            ) : null}
          </ErrorState>
        </div>
      )}

      {incident && (
        <>
          <div className="border-b-2 border-[#1a1a1a] pb-4 space-y-3">
            <div className="min-w-0">
              <span className="text-xs uppercase font-bold text-[#c0392b] tracking-widest block mb-1">
                Incident{incident.orgUnit?.name ? ` · ${incident.orgUnit.name}` : ''}
              </span>
              <PageHeading
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-black tracking-tight break-words focus:outline-none"
              >
                {incidentTitle(incident)}
              </PageHeading>
              <p className="text-xs text-[#1a1a1a]/70 mt-1">
                {reporterText(incident)}
                {formatIstShortDateTime(incident.createdAt) ? ` · ${formatIstShortDateTime(incident.createdAt)} IST` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <IncidentStatusBadge status={incident.status} />
              <SeverityBadge severity={incident.severity} />
              <TypeBadge type={incident.type} />
            </div>
            {incidentStatusText(incident) && <p className="text-sm">{incidentStatusText(incident)}</p>}
          </div>

          {query.isError && (
            <ErrorState
              error={query.error}
              title="Couldn't refresh this incident"
              onRetry={() => query.refetch()}
              retrying={query.isFetching}
            />
          )}

          {resolve.isError && !resolveOpen && (
            <ErrorState error={resolve.error} title="The incident wasn't resolved">
              The page now shows the incident as it is.
            </ErrorState>
          )}

          {incident.canResolve === true && (
            <section
              aria-label="Resolve"
              className="rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df] p-4 shadow-[4px_4px_0_#1a1a1a] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <p className="text-sm">
                You can resolve this incident: choose an outcome and give the rationale. The thread
                then closes.
              </p>
              <Button
                type="button"
                variant="forest"
                size="lg"
                className="shrink-0"
                onClick={openResolve}
              >
                <Gavel className="w-4 h-4" aria-hidden="true" />
                Resolve incident
              </Button>
            </section>
          )}
          {hint && <Notice>{hint}</Notice>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6">
              <ResolutionCard incident={incident} bookingClosed={bookingClosed} Heading={SectionHeading} />
              <Card className="p-5 space-y-4">
                <SectionHeading className="text-base md:text-lg font-bold tracking-tight">What happened</SectionHeading>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {typeof incident.description === 'string' ? incident.description : ''}
                </p>
                <Photos photos={incident.photos} subject={subject} Heading={scope === 'member' ? 'h3' : 'h4'} />
              </Card>
              <AiSummary summary={incident.aiSummary} Heading={SectionHeading} />
              <CommentThread incident={incident} user={user} Heading={SectionHeading} onAnnounce={setAnnouncement} />
            </div>
            <DetailsCard incident={incident} user={user} Heading={SectionHeading} />
          </div>
        </>
      )}

      <ResolveDialog
        open={resolveOpen && Boolean(incident)}
        onClose={closeResolve}
        incident={incident}
        pending={resolve.isPending}
        error={resolve.error}
        onSubmit={submitResolve}
        returnFocusRef={headingRef}
      />
    </div>
  );
}

export default function IncidentDetailPage() {
  const { id } = useParams();
  // Keyed by the incident, so moving to another one starts with fresh dialogs and announcements.
  return <IncidentDetail key={id} id={id} />;
}
