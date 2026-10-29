import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlarmClock, ArrowLeft, ClipboardList, History } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { formatIstDateTime, formatIstTime, formatRelative } from '../../lib/time';
import { canDo, checkInOpensAt, idOf, isBorrower, useBooking, useCancelBooking, useTimeline } from './api';
import { ActionBar } from './components/ActionBar';
import { CancelBookingDialog } from './components/CancelBookingDialog';
import { ConditionReports } from './components/ConditionReports';
import {
  decisionSummary,
  formatLocation,
  formatSlot,
  handoverStamps,
  resourceTitle,
  slotLength,
  statusExplanation,
} from './components/bookingView';
import { eyebrowClass, pageHeadingClass, sectionHeadingClass, textLinkClass } from './components/styles';
import { useNow, useRefetchAt } from './components/useClock';

// /bookings/:id (frontend.md §6.2): StatusBadge, the decision reason, the action bar from
// allowedActions, the condition reports and the BookingTimeline. GET /bookings/:id and
// /timeline, POST /bookings/:id/cancel. Nothing changes on screen before the server answers.

const DECISION_TONES = {
  green: 'border-[#1e7e45]',
  red: 'border-[#c0392b]',
  violet: 'border-[#8e44ad]',
  slate: 'border-[#5d6d7e]',
};

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
      <span className="sr-only">Loading the booking…</span>
      <div className="border-b-2 border-[#1a1a1a] pb-4 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

function OverdueBanner({ booking, now }) {
  const end = formatIstTime(booking.end);
  const since = formatRelative(booking.end, now);
  return (
    <div className="flex items-start gap-3 rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] p-4 shadow-[4px_4px_0_#c0392b]">
      <AlarmClock className="w-6 h-6 shrink-0 text-[#c0392b]" aria-hidden="true" />
      <div className="space-y-1 min-w-0">
        <p className="font-black text-[#c0392b] uppercase tracking-wide text-sm">Overdue</p>
        <p className="text-sm">
          This booking ended at {end} IST{since ? ` (${since})` : ''} and the item hasn&apos;t been
          checked out. Return it and check out now: a late return can lead to a strike.
        </p>
      </div>
    </div>
  );
}

function StatusCard({ booking, user }) {
  const decision = decisionSummary(booking, user);
  const explanation = statusExplanation(booking);
  const at = formatIstDateTime(decision?.at);
  return (
    <Card className="p-5 space-y-3">
      <h2 className={sectionHeadingClass}>Status</h2>
      <StatusBadge booking={booking} />
      {explanation && <p className="text-sm leading-relaxed">{explanation}</p>}
      {decision && (
        <div className={`border-l-4 pl-3 py-1 space-y-1 ${DECISION_TONES[decision.tone] ?? 'border-[#1a1a1a]'}`}>
          <p className="text-sm font-bold">{decision.title}</p>
          {at && <p className="text-xs text-[#1a1a1a]/70">{at}</p>}
          {decision.reason ? (
            <p className="text-sm bg-[#f5f0e8] rounded-md px-3 py-2 break-words">
              <span className="font-bold">{decision.reasonLabel}: </span>“{decision.reason}”
            </p>
          ) : (
            decision.expectsReason && <p className="text-xs text-[#1a1a1a]/70">No reason was given.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function DetailsCard({ booking, user }) {
  const slot = formatSlot(booking.start, booking.end) ?? 'Not set';
  const length = slotLength(booking.start, booking.end);
  const location = formatLocation(booking.resource?.location);
  const unit = booking.orgUnit && typeof booking.orgUnit === 'object' ? booking.orgUnit : null;
  const borrower = booking.borrower && typeof booking.borrower === 'object' ? booking.borrower : null;
  const showBorrower = borrower && !isBorrower(booking, user);
  const stamps = handoverStamps(booking);
  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className={`${sectionHeadingClass} mb-4`}>Details</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Fact label="When">
          <time dateTime={String(booking.start ?? '')}>{slot}</time>
          {length && <span className="text-[#1a1a1a]/70"> · {length}</span>}
        </Fact>
        <Fact label="Where">{location ?? 'No location given'}</Fact>
        {unit?.name && (
          <Fact label="Unit">
            {unit.name}
            {unit.code ? ` (${String(unit.code).toUpperCase()})` : ''}
          </Fact>
        )}
        {showBorrower && (
          <Fact label="Borrower">
            {borrower.name ?? 'Unknown'}
            {borrower.memberType ? ` · ${String(borrower.memberType).toUpperCase()}` : ''}
            {borrower.department?.name ? ` · ${borrower.department.name}` : ''}
          </Fact>
        )}
        {booking.purpose && (
          <div className="sm:col-span-2">
            <Fact label="Purpose">{String(booking.purpose)}</Fact>
          </div>
        )}
        {stamps.map((stamp) => (
          <Fact key={stamp.label} label={stamp.label}>
            <time dateTime={String(stamp.at)}>{stamp.shown}</time>
          </Fact>
        ))}
      </dl>
    </Card>
  );
}

function HistorySkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading the booking history…</span>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-5/6" />
      <Skeleton className="h-12 w-4/6" />
    </div>
  );
}

export default function BookingDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const now = useNow();
  const bookingQuery = useBooking(id);
  const timelineQuery = useTimeline(id);
  const cancel = useCancelBooking();
  const booking = bookingQuery.data?.data ?? null;
  const timeline = Array.isArray(timelineQuery.data?.data) ? timelineQuery.data.data : null;
  const title = resourceTitle(booking);

  const headingRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  // What the dialog shows: the booking as it was when it opened, so its wording doesn't change
  // while it closes over the refetched (cancelled) booking.
  const [cancelTarget, setCancelTarget] = useState(null);

  // Arriving from a finished check-in or check-out: announce it and put focus on the page heading
  // (the wizard's button that was pressed is gone). The history entry's state is then dropped, so
  // a reload doesn't announce it again. Read once, on the first render.
  const arrivalRef = useRef(location.state?.announce ?? null);
  const loaded = Boolean(booking);
  useEffect(() => {
    const message = arrivalRef.current;
    if (!message || !loaded) return;
    arrivalRef.current = null;
    headingRef.current?.focus();
    // After focus has moved, so the live region's change is read rather than lost.
    setTimeout(() => setAnnouncement(message), 100);
    navigate('.', { replace: true, state: null });
  }, [loaded, navigate]);

  // allowedActions is computed when the booking is fetched: ask again when the check-in window opens.
  const waitingForCheckIn = booking?.status === 'approved' && !canDo(booking, 'checkIn');
  useRefetchAt(waitingForCheckIn ? checkInOpensAt(booking) : null, bookingQuery.refetch);

  const openCancel = () => {
    cancel.reset();
    setCancelTarget(booking);
    setCancelOpen(true);
  };
  const closeCancel = () => {
    if (cancel.isPending) return;
    setCancelOpen(false);
  };
  const confirmCancel = (reason) => {
    const isRequest = cancelTarget?.status === 'pending' || cancelTarget?.status === 'waitlisted';
    cancel.mutate(
      { id, resourceId: idOf(booking?.resource), reason },
      {
        onSuccess: () => {
          const message = isRequest ? 'Request cancelled.' : 'Booking cancelled. Its slot has been released.';
          setCancelOpen(false);
          setAnnouncement(message);
          toast.success(isRequest ? 'Request cancelled' : 'Booking cancelled');
        },
      }
    );
  };

  return (
    <div className="space-y-6 font-mono text-[#1a1a1a]">
      <Link to="/bookings" className={`${textLinkClass} inline-flex items-center gap-1.5 text-sm py-2`}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        My bookings
      </Link>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {bookingQuery.isPending && <DetailSkeleton />}

      {bookingQuery.isError && !booking && (
        <div className="space-y-4">
          <h1 className={pageHeadingClass}>Booking</h1>
          <ErrorState
            error={bookingQuery.error}
            title="Couldn't load this booking"
            onRetry={() => bookingQuery.refetch()}
            retrying={bookingQuery.isFetching}
          >
            {bookingQuery.error?.status === 404 || bookingQuery.error?.status === 403 ? (
              <Link to="/bookings" className={textLinkClass}>
                Back to my bookings
              </Link>
            ) : null}
          </ErrorState>
        </div>
      )}

      {booking && (
        <>
          <div className="border-b-2 border-[#1a1a1a] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="min-w-0">
              <span className={eyebrowClass}>
                Booking{booking.orgUnit?.name ? ` · ${booking.orgUnit.name}` : ''}
              </span>
              <h1 ref={headingRef} tabIndex={-1} className={pageHeadingClass}>
                {title}
              </h1>
              <p className="text-sm mt-1">
                <time dateTime={String(booking.start ?? '')}>{formatSlot(booking.start, booking.end) ?? 'Time not set'}</time>
              </p>
            </div>
            <StatusBadge booking={booking} size="lg" className="self-start sm:self-auto" />
          </div>

          {bookingQuery.isError && (
            <ErrorState
              error={bookingQuery.error}
              title="Couldn't refresh this booking"
              onRetry={() => bookingQuery.refetch()}
              retrying={bookingQuery.isFetching}
            />
          )}

          {booking.isOverdue && <OverdueBanner booking={booking} now={now} />}

          <ActionBar booking={booking} user={user} now={now} onCancel={openCancel} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <DetailsCard booking={booking} user={user} />
            <StatusCard booking={booking} user={user} />
          </div>

          <section aria-labelledby="booking-reports-heading" className="space-y-4">
            <h2 id="booking-reports-heading" className={`${sectionHeadingClass} flex items-center gap-2`}>
              <ClipboardList className="w-5 h-5" aria-hidden="true" />
              Condition reports
            </h2>
            {timelineQuery.isPending && <Skeleton className="h-32 w-full" />}
            {timeline && (
              <ConditionReports items={timeline} subject={title} />
            )}
            {timeline && !timeline.some((item) => item?.kind === 'condition_report') && (
              <p className="text-sm text-[#1a1a1a]/70">
                No condition reports yet. They are added at check-in, at check-out and when a manager
                checks the return.
              </p>
            )}
            {timelineQuery.isError && !timeline && (
              <p className="text-sm text-[#1a1a1a]/70">The reports load with the history below.</p>
            )}
          </section>

          <section aria-labelledby="booking-history-heading" className="space-y-4">
            <h2 id="booking-history-heading" className={`${sectionHeadingClass} flex items-center gap-2`}>
              <History className="w-5 h-5" aria-hidden="true" />
              History
            </h2>
            {timelineQuery.isPending && <HistorySkeleton />}
            {timelineQuery.isError && (
              <ErrorState
                error={timelineQuery.error}
                title="Couldn't load the booking history"
                onRetry={() => timelineQuery.refetch()}
                retrying={timelineQuery.isFetching}
              />
            )}
            {timeline && <BookingTimeline items={timeline} subject={title} />}
          </section>
        </>
      )}

      <CancelBookingDialog
        open={cancelOpen}
        onClose={closeCancel}
        onConfirm={confirmCancel}
        booking={cancelTarget ?? booking}
        user={user}
        request={cancel}
        returnFocusRef={headingRef}
      />
    </div>
  );
}
