import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  Award,
  Building2,
  CalendarOff,
  CheckSquare,
  Clock,
  Layers,
  MapPin,
  ScrollText,
  SearchX,
  Users,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';
import { formatIstRange, istDateKey } from '../lib/time';
import {
  useResource,
  useResourceAvailability,
  useResourceEligibility,
} from '../features/resources/api';
import {
  approvalView,
  bookingModeLabel,
  categoryLabel,
  departmentsText,
  formatLocation,
  formatQuantity,
  limitsList,
  memberTypesText,
  resourceStatusView,
  riskView,
} from '../features/resources/format';
import { useNow } from '../features/resources/hooks';
import { availabilityRange, buildSlotGrid, pickCell, slotMinutesOf } from '../features/resources/slots';
import { AvailabilityGrid } from '../features/resources/components/AvailabilityGrid';
import { BookingPanel } from '../features/resources/components/BookingPanel';
import { EligibilityChecklist } from '../features/resources/components/EligibilityChecklist';
import { QuotaMeter } from '../features/resources/components/QuotaMeter';

// /resources/:id (frontend.md §6.2): the header (unit, location, risk, status), the usage rules,
// the server's eligibility checklist and quota (GET /resources/:id/eligibility), the next 7 days of
// availability (GET /resources/:id/availability) and the booking panel (POST /bookings/check,
// POST /bookings). Every figure comes from the server; nothing is worked out from the user here.

const backLinkClass =
  'inline-flex items-center gap-1.5 min-h-[40px] font-bold text-[#183d2d] hover:text-[#a93226] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] rounded-sm';

const cardClass =
  'rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a]';

function BackLink() {
  return (
    <Link to="/explore" className={backLinkClass}>
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      Back to Explore
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6 font-mono" aria-busy="true">
      <p role="status" className="sr-only">
        Loading the resource…
      </p>
      <Skeleton className="h-5 w-40" />
      <div className={`${cardClass} space-y-3`}>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Skeleton className="h-64 lg:col-span-5" />
        <Skeleton className="h-64 lg:col-span-7" />
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <section className={cardClass}>
      <h2 className="text-base font-black tracking-tight flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-[#183d2d]" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <dt className="shrink-0">
        <Icon className="w-4 h-4 mt-0.5 text-[#183d2d]" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Header({ resource }) {
  const risk = riskView(resource.riskLevel);
  const status = resourceStatusView(resource.status);
  const approval = approvalView(resource.eligibility?.approvalMode);
  const unit = resource.orgUnit && typeof resource.orgUnit === 'object' ? resource.orgUnit : null;
  const location = formatLocation(resource.location);
  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral" size="sm">
          {categoryLabel(resource.category)}
        </Badge>
        <Badge variant={risk.variant} size="sm">
          {risk.label}
        </Badge>
        <Badge variant={status.variant} size="sm">
          {status.label}
        </Badge>
        <Badge variant={approval.variant} size="sm">
          {approval.label}
        </Badge>
        {resource.canManage && (
          <Badge variant="dark" size="sm">
            You manage this
          </Badge>
        )}
      </div>
      <h1 className="text-2xl md:text-3xl font-black tracking-tight leading-tight break-words">{resource.title}</h1>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Fact icon={Building2} label="Unit">
          {unit?.name ?? 'Unit not listed'}
          {unit?.code ? ` (${unit.code.toUpperCase()})` : ''}
        </Fact>
        <Fact icon={MapPin} label="Location">
          {location ?? 'Location not listed'}
        </Fact>
        <Fact icon={Clock} label="Opening hours">
          {resource.openHours
            ? resource.openHours === 'closed all week'
              ? 'Closed all week'
              : `${resource.openHours} (IST)`
            : 'Hours not listed'}
        </Fact>
        <Fact icon={Layers} label="Booking">
          {bookingModeLabel(resource.bookingMode)} · {formatQuantity(resource.quantity)}
        </Fact>
      </dl>
      {resource.description && (
        <p className="text-sm leading-relaxed text-[#1a1a1a]/85 whitespace-pre-line">{resource.description}</p>
      )}
      <a href="#booking" className={`${backLinkClass} text-sm`}>
        <ArrowDown className="w-4 h-4" aria-hidden="true" />
        Check availability and book
      </a>
    </div>
  );
}

function Requirements({ resource }) {
  const badges = Array.isArray(resource.eligibility?.badges)
    ? resource.eligibility.badges.filter((b) => b && typeof b === 'object')
    : [];
  const approval = approvalView(resource.eligibility?.approvalMode);
  return (
    <SectionCard icon={Users} title="Who can book">
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75">Member types</dt>
          <dd>{memberTypesText(resource.eligibility?.memberTypes)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75">Departments</dt>
          <dd>{departmentsText(resource.eligibility?.departments)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75">Badges needed</dt>
          <dd>
            {badges.length ? (
              <ul className="flex flex-wrap gap-1.5 mt-1">
                {badges.map((badge) => (
                  <li
                    key={badge._id ?? badge.code}
                    className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded border border-[#1a1a1a] bg-[#fdf3c4]"
                  >
                    <Award className="w-3.5 h-3.5" aria-hidden="true" />
                    {badge.name ?? badge.code}
                    {badge.orgUnit?.name ? (
                      <span className="font-normal"> · from {badge.orgUnit.name}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              'None'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75">Approval</dt>
          <dd>
            {approval.label}: {approval.description}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

function Closures({ blackouts }) {
  const now = useNow(5 * 60 * 1000);
  const upcoming = (Array.isArray(blackouts) ? blackouts : [])
    .filter((b) => b && Date.parse(b.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!upcoming.length) return null;
  return (
    <SectionCard icon={CalendarOff} title="Upcoming closures">
      <ul className="space-y-2 text-sm">
        {upcoming.map((b) => (
          <li key={b._id ?? b.start} className="p-2.5 rounded-lg border-2 border-[#c0392b]/50 bg-[#fff5f5]">
            <p className="font-bold">{formatIstRange(b.start, b.end) ?? 'Dates not set'}</p>
            {b.reason && <p className="text-xs mt-0.5">{b.reason}</p>}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function EligibilityCard({ resource }) {
  const eligibility = useResourceEligibility(resource._id);
  const data = eligibility.data?.data;
  if (eligibility.isPending) {
    return (
      <div className={`${cardClass} space-y-3`} aria-busy="true">
        <p role="status" className="text-sm font-bold">
          Checking whether you can book this…
        </p>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (eligibility.isError && !data) {
    return (
      <div className={cardClass}>
        <h2 className="text-base font-black tracking-tight mb-3">Can you book it?</h2>
        <ErrorState
          error={eligibility.error}
          title="Couldn't load your eligibility"
          onRetry={() => eligibility.refetch()}
          retrying={eligibility.isFetching}
        />
      </div>
    );
  }
  return (
    <EligibilityChecklist
      title="Can you book it?"
      eyebrow="Eligibility checklist"
      results={data?.results}
      resource={resource}
      summary={
        data?.eligible
          ? 'You meet every rule that needs no time. Pick a time below to check the rest.'
          : undefined
      }
    >
      <QuotaMeter quota={data?.quota} />
    </EligibilityChecklist>
  );
}

function BookingArea({ resource }) {
  const now = useNow(60 * 1000);
  const today = istDateKey(now);
  const range = useMemo(() => availabilityRange(today), [today]);
  const availability = useResourceAvailability(resource._id, range);
  const data = availability.data?.data;
  const model = useMemo(
    () =>
      data
        ? buildSlotGrid({
            range,
            slotMinutes: slotMinutesOf(resource),
            openWindows: data.openWindows,
            busy: data.busy,
            quantity: data.quantity ?? resource.quantity,
            weekly: resource.availability?.weekly,
            blackouts: resource.availability?.blackouts,
            now,
          })
        : null,
    [data, range, resource, now]
  );
  const mode = resource.bookingMode === 'loan' ? 'loan' : 'slot';
  const [pick, setPick] = useState({ selection: null, anchor: null });
  const loadError = availability.isError && !data ? availability.error : null;

  return (
    <div id="booking" className="space-y-6 scroll-mt-24">
      <AvailabilityGrid
        model={model}
        selection={pick.selection}
        anchor={pick.anchor}
        onPick={(cell) => setPick((current) => pickCell({ ...current, cell, mode }))}
        loading={availability.isPending}
        error={loadError}
        onRetry={() => availability.refetch()}
        retrying={availability.isFetching}
      />
      <BookingPanel
        resource={resource}
        model={model}
        modelLoading={availability.isPending}
        modelError={loadError}
        selection={pick.selection}
        onSelectionChange={(selection) => setPick({ selection, anchor: null })}
        onBooked={() => setPick({ selection: null, anchor: null })}
      />
    </div>
  );
}

/** The page body for a loaded resource (the Detail of GET /resources/:id). Exported for the tests. */
export function ResourceDetail({ resource }) {
  const limits = limitsList(resource.limits);
  const checklist = Array.isArray(resource.checklist) ? resource.checklist.filter(Boolean) : [];
  return (
    <div className="space-y-6 font-mono text-[#1a1a1a]">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center justify-between gap-2 text-xs pb-2 border-b-2 border-[#1a1a1a]/15">
        <BackLink />
        <p className="text-[#1a1a1a]/75 min-w-0 break-words">
          {resource.orgUnit?.name ?? 'Campus'} / <span className="font-bold text-[#1a1a1a]">{resource.title}</span>
        </p>
      </nav>

      <Header resource={resource} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-6">
          <SectionCard icon={ScrollText} title="Usage rules">
            {resource.usageRules ? (
              <p className="text-sm leading-relaxed whitespace-pre-line break-words">{resource.usageRules}</p>
            ) : (
              <p className="text-sm text-[#1a1a1a]/75">The unit hasn&apos;t listed extra rules.</p>
            )}
          </SectionCard>
          <Requirements resource={resource} />
          <SectionCard icon={Clock} title="Limits">
            {limits.length ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {limits.map((item) => (
                  <div key={item.label}>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75">{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-[#1a1a1a]/75">No limits on length or hours.</p>
            )}
          </SectionCard>
          {checklist.length > 0 && (
            <SectionCard icon={CheckSquare} title="Handover checklist">
              <p className="text-xs text-[#1a1a1a]/75 mb-2">
                You confirm each item, with photos, at check-in and at check-out.
              </p>
              <ol className="space-y-1.5 text-sm list-decimal list-inside">
                {checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </SectionCard>
          )}
          <Closures blackouts={resource.availability?.blackouts} />
        </div>

        <div className="lg:col-span-7 space-y-6">
          <EligibilityCard resource={resource} />
          <BookingArea resource={resource} />
        </div>
      </div>
    </div>
  );
}

export default function ResourceDetailPage() {
  const { id } = useParams();
  const query = useResource(id);
  const resource = query.data?.data;

  if (query.isPending) return <DetailSkeleton />;

  if (!resource) {
    const notFound = query.error?.code === 'NOT_FOUND';
    return (
      <div className="space-y-6 font-mono text-[#1a1a1a]">
        <BackLink />
        <div className={`${cardClass} space-y-4 max-w-xl`}>
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
            <SearchX className="w-5 h-5 text-[#a93226]" aria-hidden="true" />
            {notFound ? 'Resource not found' : "Couldn't load this resource"}
          </h1>
          {notFound ? (
            <p className="text-sm leading-relaxed">
              {query.error?.message ?? 'Resource not found.'} It may have been archived, or the
              link is wrong.
            </p>
          ) : (
            <ErrorState
              error={query.error}
              title="The request failed"
              onRetry={() => query.refetch()}
              retrying={query.isFetching}
            />
          )}
        </div>
      </div>
    );
  }

  return <ResourceDetail resource={resource} />;
}
