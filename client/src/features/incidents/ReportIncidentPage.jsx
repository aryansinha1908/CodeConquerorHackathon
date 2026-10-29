import React, { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CalendarCheck, Lock, Send, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { PhotoUploader } from '../../components/PhotoUploader';
import { useBooking } from '../bookings/api';
import { useResource } from '../resources/api';
import { formatSlot } from '../bookings/components/bookingView';
import { eyebrowClass, linkButtonClass, pageHeadingClass, sectionHeadingClass, textLinkClass } from '../bookings/components/styles';
import { useNow } from '../bookings/components/useClock';
import {
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  MAX_INCIDENT_PHOTOS,
  incidentErrorsFrom,
  isId,
  useCreateIncident,
  validateIncident,
} from './api';
import { ChoiceGroup } from './components/ChoiceGroup';
import { Notice } from './components/Notice';
import { ResourcePicker } from './components/ResourcePicker';
import { TextAreaField } from './components/TextAreaField';
import {
  canReportWithoutBooking,
  incidentPath,
  isAdmin,
  reportBlock,
  severityOptions,
  toPick,
  typeOptions,
  unitLabel,
} from './components/incidentView';

// /incidents/new (frontend.md §6.2 "Report incident", F-13): type, severity, description (20–2000)
// and up to 3 photos, sent as POST /incidents (api.md "Incidents"). ?bookingId= ties the report to
// that booking (and so its resource): its borrower up to 7 days after it ends, or the unit's staff.
// Without a booking only managers and admins report, choosing one of their units' resources
// (?resourceId= pre-selects one). On success the page opens the new incident.

const FIELD_ORDER = ['resourceId', 'type', 'severity', 'description', 'photos'];

const backLinkClass = `${textLinkClass} inline-flex items-center gap-1.5 text-sm py-2`;

function BookingSummary({ booking, user }) {
  const title = booking.resource?.title ?? 'Resource';
  const unit = unitLabel(booking.orgUnit);
  const borrower = booking.borrower && typeof booking.borrower === 'object' ? booking.borrower : null;
  const own = borrower && user?._id && String(borrower._id) === String(user._id);
  return (
    <Card className="p-4 sm:p-5 space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase font-bold tracking-wider text-[#1a1a1a]/70">About this booking</p>
          <p className="text-base font-black tracking-tight break-words">{title}</p>
          <p className="text-xs">
            <time dateTime={String(booking.start ?? '')}>{formatSlot(booking.start, booking.end) ?? 'Time not set'}</time>
          </p>
          {unit && <p className="text-xs text-[#1a1a1a]/70">{unit}</p>}
          {borrower && !own && (
            <p className="text-xs text-[#1a1a1a]/70">Borrower: {borrower.name ?? 'A member'}</p>
          )}
        </div>
        <StatusBadge booking={booking} size="sm" className="self-start shrink-0" />
      </div>
    </Card>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/**
 * The report form. `booking` (GET /bookings/:id) or the chosen resource names what it is about;
 * `presetResource` (a resource card) pre-selects the resource of a report without a booking.
 */
function ReportForm({ booking, user, presetResource, cancelTo, onBookingStale }) {
  const navigate = useNavigate();
  const create = useCreateIncident();
  const [picked, setPicked] = useState(undefined); // undefined: use the preset
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const resourceRef = useRef(null);
  const typeRef = useRef(null);
  const severityRef = useRef(null);
  const descriptionRef = useRef(null);

  const resource = picked === undefined ? toPick(presetResource) : picked;
  const bookingId = booking?._id ? String(booking._id) : null;
  const subject = booking?.resource?.title ?? resource?.title;
  const submitting = create.isPending || create.isSuccess;
  const server = incidentErrorsFrom(create.error);
  const general =
    create.error && (Object.keys(server.fields).length === 0 || server.other.length > 0)
      ? server.other.length
        ? { ...create.error, message: server.other.join(' ') }
        : create.error
      : null;

  const clear = (field) =>
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  // Called from the submit handler and the request's callbacks, never during render.
  const focusFirst = (found) => {
    const targets = { resourceId: resourceRef, type: typeRef, severity: severityRef, description: descriptionRef };
    const first = FIELD_ORDER.find((field) => found[field] && targets[field]);
    targets[first]?.current?.focus();
  };

  const submit = (event) => {
    event.preventDefault();
    if (submitting) return;
    const input = { bookingId, resourceId: bookingId ? undefined : resource?._id, type, severity, description, photos };
    const found = validateIncident(input);
    if (photosBusy) found.photos = 'Wait for the photos to finish uploading, or remove them.';
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirst(found);
      return;
    }
    create.mutate(input, {
      onSuccess: (result) => {
        const incident = result?.data;
        toast.success('Issue reported');
        // From a booking: the member route, which every party can open. Without one (staff only):
        // the console the reporter works in.
        const scope = bookingId ? 'member' : user?.roles?.includes('manager') ? 'manage' : isAdmin(user) ? 'admin' : 'member';
        navigate(incidentPath(incident?._id, scope), {
          state: { announce: 'Your report was sent. The unit’s managers have been notified.' },
        });
      },
      onError: (err) => {
        const { fields } = incidentErrorsFrom(err);
        setErrors(fields);
        focusFirst(fields);
        // The booking changed (no longer reportable) or the window closed: show it as it is now.
        if (err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND') onBookingStale?.();
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {!booking && (
        <section aria-labelledby="report-resource-heading" className="space-y-3">
          <h2 id="report-resource-heading" className={sectionHeadingClass}>
            Which resource?
          </h2>
          <ResourcePicker
            ref={resourceRef}
            value={resource}
            onChange={(next) => {
              setPicked(next);
              clear('resourceId');
            }}
            error={errors.resourceId}
            disabled={submitting}
          />
        </section>
      )}

      <section aria-labelledby="report-what-heading" className="space-y-5">
        <h2 id="report-what-heading" className={sectionHeadingClass}>
          What happened?
        </h2>
        <ChoiceGroup
          ref={typeRef}
          legend="Kind of issue"
          name="incident-type"
          options={typeOptions()}
          value={type}
          onChange={(value) => {
            setType(value);
            clear('type');
          }}
          error={errors.type}
          columns={3}
          disabled={submitting}
        />
        <ChoiceGroup
          ref={severityRef}
          legend="How serious is it?"
          name="incident-severity"
          options={severityOptions()}
          value={severity}
          onChange={(value) => {
            setSeverity(value);
            clear('severity');
          }}
          error={errors.severity}
          columns={3}
          disabled={submitting}
        />
        {severity === 'high' && (
          <p className="text-xs flex items-start gap-1.5 text-[#a93226]">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            High severity goes to the admins too. If anyone is in danger, get help first.
          </p>
        )}
        <TextAreaField
          ref={descriptionRef}
          label="Description"
          required
          rows={5}
          value={description}
          onChange={(value) => {
            setDescription(value);
            clear('description');
          }}
          maxLength={INCIDENT_DESCRIPTION_MAX}
          hint={`${INCIDENT_DESCRIPTION_MIN}–${INCIDENT_DESCRIPTION_MAX} characters: what happened, when, and the state the item is in.`}
          error={errors.description}
          disabled={submitting}
        />
        <PhotoUploader
          value={photos}
          onChange={(next) => {
            setPhotos(next);
            clear('photos');
          }}
          max={MAX_INCIDENT_PHOTOS}
          photoLabel="Incident photo"
          subject={subject}
          error={errors.photos}
          disabled={submitting}
          onBusyChange={setPhotosBusy}
          hint={`Up to ${MAX_INCIDENT_PHOTOS} photos of the damage or the scene (JPG, PNG or WebP). They are compressed before upload.`}
        />
      </section>

      <ErrorState error={general} title="The report wasn't sent">
        {create.error?.code === 'INVALID_TRANSITION' ? 'The booking above shows its current state.' : null}
      </ErrorState>

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t-2 border-[#1a1a1a]/15">
        <Link to={cancelTo} className={linkButtonClass('outline')}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" loading={submitting}>
          {!submitting && <Send className="w-4 h-4" aria-hidden="true" />}
          {submitting ? 'Sending…' : 'Send the report'}
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {create.isPending ? 'Sending the report…' : ''}
      </p>
    </form>
  );
}

function WithBooking({ bookingId, user }) {
  const now = useNow();
  const bookingQuery = useBooking(bookingId);
  const booking = bookingQuery.data?.data ?? null;
  const backTo = `/bookings/${encodeURIComponent(bookingId)}`;

  if (bookingQuery.isPending) return <PageSkeleton />;
  if (!booking) {
    return (
      <ErrorState
        error={bookingQuery.error}
        title="Couldn't load the booking"
        onRetry={() => bookingQuery.refetch()}
        retrying={bookingQuery.isFetching}
      >
        <Link to="/bookings" className={textLinkClass}>
          Back to my bookings
        </Link>
      </ErrorState>
    );
  }

  const block = reportBlock(booking, user, now);
  return (
    <div className="space-y-6">
      <BookingSummary booking={booking} user={user} />
      {block ? (
        <Notice icon={Lock} title={block.title}>
          <p>{block.message}</p>
          <p>
            <Link to={backTo} className={textLinkClass}>
              Back to the booking
            </Link>
          </p>
        </Notice>
      ) : (
        <ReportForm
          booking={booking}
          user={user}
          cancelTo={backTo}
          onBookingStale={() => bookingQuery.refetch()}
        />
      )}
    </div>
  );
}

function WithoutBooking({ user, presetResourceId, cancelTo }) {
  const preset = useResource(isId(presetResourceId) ? presetResourceId : null);
  if (!canReportWithoutBooking(user)) {
    return (
      <Notice icon={CalendarCheck} title="Report it from the booking">
        <p>
          An issue is reported on the booking it happened in, so the unit sees the slot and the
          condition reports. Open the booking and choose “Report an issue”.
        </p>
        <p>
          <Link to="/bookings" className={textLinkClass}>
            Go to my bookings
          </Link>
        </p>
      </Notice>
    );
  }
  if (isId(presetResourceId) && preset.isPending) return <PageSkeleton />;
  return (
    <div className="space-y-4">
      {preset.isError && (
        <ErrorState error={preset.error} title="Couldn't load the resource from the link">
          Choose the resource below instead.
        </ErrorState>
      )}
      <ReportForm user={user} presetResource={preset.data?.data ?? null} cancelTo={cancelTo} />
    </div>
  );
}

export default function ReportIncidentPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('bookingId') || null;
  const resourceId = searchParams.get('resourceId') || null;
  const staff = canReportWithoutBooking(user);
  const back = bookingId
    ? { to: `/bookings/${encodeURIComponent(bookingId)}`, label: 'Back to the booking' }
    : staff
      ? { to: user?.roles?.includes('manager') ? '/manage/incidents' : '/admin/incidents', label: 'Back to incidents' }
      : { to: '/bookings', label: 'My bookings' };

  return (
    <div className="space-y-6 font-mono text-[#1a1a1a] max-w-3xl">
      <Link to={back.to} className={backLinkClass}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {back.label}
      </Link>
      <div className="border-b-2 border-[#1a1a1a] pb-4">
        <span className={eyebrowClass}>Incidents</span>
        <h1 className={pageHeadingClass}>Report an issue</h1>
        <p className="text-sm mt-1 leading-relaxed">
          Tell the unit about damage, a late return, misuse or a safety problem. Their managers are
          notified and reply in the incident’s thread; a person decides the outcome.
        </p>
      </div>
      {/* Keyed, so another booking or resource in the URL starts a fresh form. */}
      {bookingId ? (
        <WithBooking key={`b:${bookingId}`} bookingId={bookingId} user={user} />
      ) : (
        <WithoutBooking
          key={`r:${resourceId ?? ''}`}
          user={user}
          presetResourceId={resourceId}
          cancelTo={back.to}
        />
      )}
    </div>
  );
}
