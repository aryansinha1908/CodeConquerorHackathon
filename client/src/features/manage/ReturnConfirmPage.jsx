import React, { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardCheck, History, Info, Lock } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { BookingTimeline } from '../../components/BookingTimeline';
import { bookingStatusOf } from '../../lib/bookingStatus';
import { formatDuration, formatIstShortDateTime } from '../../lib/time';
import {
  OVERDUE_GRACE_MINUTES,
  canDo,
  idOf,
  latestReport,
  useBooking,
  useConfirmReturn,
  useTimeline,
} from '../bookings/api';
import { Field, LinkButton } from './components/Bits';
import { ReportComparison } from './components/ReportComparison';
import { ReturnForm } from './components/ReturnForm';
import {
  OWN_BOOKING_MESSAGE,
  blocksOwnDecision,
  confirmationOutcomeLabel,
  lateReturnMinutes,
  requesterView,
  returnMessage,
  slotText,
} from './components/manageView';

// /manage/returns/:bookingId (frontend.md §6.3, F-12; judge step 10): the borrower's check-in and
// check-out reports side by side, the manager's own checklist, then "All good" or "Report issue"
// (POST /bookings/:id/confirm-return, api.md "Bookings"). On success the hook refetches the
// booking, its timeline, every booking list, the resource's availability and, for an issue, the
// incident lists; then the page returns to /manage/handovers.

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const backLinkClass =
  'inline-flex items-center gap-1.5 text-xs font-bold text-[#183d2d] underline underline-offset-2 hover:text-[#c0392b] rounded px-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]';

function PageSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading the return…</span>
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

function Notice({ icon: Icon = Info, children }) {
  return (
    <div className="p-4 rounded-lg border-2 border-[#1a1a1a] bg-[#f5f0e8] text-sm flex items-start gap-2">
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      <div className="space-y-2 min-w-0">{children}</div>
    </div>
  );
}

// Why there's no form: already checked, not returned yet, the manager's own booking, or no rights.
function NoFormReason({ booking, user }) {
  const status = booking.status;
  const bookingLink = (
    <Link to={`/bookings/${encodeURIComponent(idOf(booking))}`} className="font-bold underline underline-offset-2 text-[#183d2d]">
      Open the booking
    </Link>
  );
  if (status === 'completed' || status === 'flagged') {
    const outcome = confirmationOutcomeLabel(booking.returnConfirmation?.outcome);
    const at = formatIstShortDateTime(booking.returnConfirmation?.at);
    return (
      <Notice icon={ClipboardCheck}>
        <p className="font-bold">
          This return has already been checked{outcome ? `: ${outcome.toLowerCase()}` : ''}
          {at ? ` on ${at} IST` : ''}.
        </p>
        {status === 'flagged' && (
          <p>The booking stays flagged until its incident is resolved.</p>
        )}
        <p>{bookingLink}</p>
      </Notice>
    );
  }
  if (status !== 'checked_out') {
    return (
      <Notice>
        <p className="font-bold">
          There&apos;s no return to confirm: this booking is {bookingStatusOf(booking).label.toLowerCase()}.
        </p>
        <p>A return can be confirmed once the borrower checks out.</p>
        <p>{bookingLink}</p>
      </Notice>
    );
  }
  return (
    <Notice icon={Lock}>
      <p className="font-bold">
        {blocksOwnDecision(booking, user)
          ? OWN_BOOKING_MESSAGE
          : "You're not allowed to confirm this return. Only the unit's managers or an admin can."}
      </p>
    </Notice>
  );
}

function ReturnConfirm({ bookingId }) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const bookingQuery = useBooking(bookingId);
  const timelineQuery = useTimeline(bookingId);
  const confirm = useConfirmReturn();
  const [stale, setStale] = useState(null);

  const booking = bookingQuery.data?.data ?? null;
  const items = Array.isArray(timelineQuery.data?.data) ? timelineQuery.data.data : [];
  const checkIn = latestReport(items, 'check_in');
  const checkOut = latestReport(items, 'check_out');
  const title = asText(booking?.resource?.title) || 'Resource';
  const checklist = Array.isArray(booking?.resource?.checklist) ? booking.resource.checklist : [];

  // While the request runs, and after it succeeds (the refetched booking is already completed or
  // flagged), the form stays as it was until the page moves on.
  const submitting = confirm.isPending || confirm.isSuccess;
  const allowed = Boolean(booking) && (canDo(booking, 'confirmOk') || canDo(booking, 'confirmIssue'));
  const showForm = Boolean(booking) && ((booking.status === 'checked_out' && allowed) || submitting);

  const submit = (input) => {
    if (submitting) return;
    setStale(null);
    confirm.mutate(
      { id: bookingId, resourceId: idOf(booking?.resource) ?? undefined, ...input },
      {
        onSuccess: (result) => {
          const message = returnMessage(result?.data, { outcome: input.outcome, title });
          toast.success(message);
          navigate('/manage/handovers', { state: { notice: message } });
        },
        onError: (err) => {
          // Confirmed by someone else meanwhile, or gone: the hook has refetched the booking, so the
          // page shows its current state; say why at the top.
          if (err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND') {
            setStale(err);
            headingRef.current?.focus();
          }
        },
      }
    );
  };

  if (bookingQuery.isPending) return <PageSkeleton />;

  if (bookingQuery.isError && !booking) {
    return (
      <div className="space-y-4">
        <Link to="/manage/handovers" className={backLinkClass}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to handovers
        </Link>
        <ErrorState
          error={bookingQuery.error}
          title="Couldn't load this booking"
          onRetry={() => bookingQuery.refetch()}
          retrying={bookingQuery.isFetching}
        />
      </div>
    );
  }

  const person = requesterView(booking.borrower);
  const checkedIn = formatIstShortDateTime(booking.checkIn?.at);
  const checkedOut = formatIstShortDateTime(booking.checkOut?.at);
  const late = lateReturnMinutes(booking);

  return (
    <section aria-labelledby="return-heading" className="space-y-6 font-mono text-[#1a1a1a]">
      <Link to="/manage/handovers" className={backLinkClass}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to handovers
      </Link>

      <div className="border-b-2 border-[#1a1a1a] pb-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">Return check</span>
            <h2
              id="return-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-black tracking-tight break-words focus:outline-none"
            >
              {title}
            </h2>
          </div>
          <StatusBadge booking={booking} className="self-start shrink-0" />
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Field label="Borrower">
            {person.name}
            <span className="block font-normal text-[#1a1a1a]/70">
              {person.memberType} · {person.department}
            </span>
          </Field>
          <Field label="Slot (IST)">{slotText(booking.start, booking.end)}</Field>
          <Field label="Checked in">{checkedIn ? `${checkedIn} IST` : 'Not recorded'}</Field>
          <Field label="Checked out">
            {checkedOut ? `${checkedOut} IST` : 'Not yet'}
            {late > OVERDUE_GRACE_MINUTES && (
              <span className="block text-[#a04000]">{formatDuration(late)} after the slot ended</span>
            )}
          </Field>
          {booking.orgUnit?.name && <Field label="Unit">{asText(booking.orgUnit.name)}</Field>}
          {booking.purpose && (
            <Field label="Purpose" className="sm:col-span-2 lg:col-span-3">
              <span className="font-normal">“{asText(booking.purpose)}”</span>
            </Field>
          )}
        </dl>
      </div>

      {stale && (
        <ErrorState
          error={stale}
          title="This return changed meanwhile"
          onRetry={() => {
            bookingQuery.refetch();
            timelineQuery.refetch();
          }}
          retrying={bookingQuery.isFetching}
          retryLabel="Reload"
        >
          The page now shows the booking as it is.
        </ErrorState>
      )}

      {!showForm && <NoFormReason booking={booking} user={user} />}

      <section aria-labelledby="return-compare-heading" className="space-y-3">
        <h3 id="return-compare-heading" className="text-lg font-black tracking-tight">
          Check-in and check-out, side by side
        </h3>
        {timelineQuery.isPending && (
          <div aria-busy="true" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <span className="sr-only">Loading the condition reports…</span>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        )}
        {timelineQuery.isError && !timelineQuery.data && (
          <ErrorState
            error={timelineQuery.error}
            title="Couldn't load the condition reports"
            onRetry={() => timelineQuery.refetch()}
            retrying={timelineQuery.isFetching}
          />
        )}
        {timelineQuery.data && (
          <ReportComparison checklist={checklist} checkIn={checkIn} checkOut={checkOut} subject={title} />
        )}
      </section>

      {showForm && (
        <section
          aria-labelledby="return-check-heading"
          className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 sm:p-6 shadow-[4px_4px_0_#1a1a1a] space-y-4"
        >
          <div>
            <h3 id="return-check-heading" className="text-lg font-black tracking-tight">
              Your check
            </h3>
            <p className="text-xs text-[#1a1a1a]/70 mt-0.5">
              Look the item over, record what you find, then decide.
            </p>
          </div>
          <ReturnForm
            checklist={checklist}
            checkOut={checkOut}
            subject={title}
            pending={submitting}
            pendingOutcome={confirm.variables?.outcome}
            error={stale ? null : confirm.error}
            onSubmit={submit}
          />
        </section>
      )}

      {timelineQuery.data && (
        <details className="group rounded-xl border-2 border-[#1a1a1a]/30 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]">
            <History className="w-4 h-4" aria-hidden="true" />
            Full booking history
          </summary>
          <div className="mt-4">
            <BookingTimeline items={items} subject={title} label={`History of the ${title} booking`} />
          </div>
        </details>
      )}

      {!showForm && (
        <LinkButton to="/manage/handovers">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to handovers
        </LinkButton>
      )}
    </section>
  );
}

export default function ReturnConfirmPage() {
  const { bookingId } = useParams();
  // Keyed by the booking, so moving to another return starts a fresh form.
  return <ReturnConfirm key={bookingId} bookingId={bookingId} />;
}
