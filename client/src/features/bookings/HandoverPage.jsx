import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlarmClock, ArrowLeft, ArrowRight, Clock, LogIn, LogOut } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { idOf, latestReport, useBooking, useCheckIn, useCheckOut, useTimeline } from './api';
import { bookingPath, formatSlot, handoverBlock, handoverPath, resourceTitle } from './components/bookingView';
import {
  HANDOVER_STEPS,
  LAST_STEP,
  checklistOf,
  checklistSummary,
  fieldDomId,
  handoverReducer,
  hasFieldErrors,
  initialHandover,
  itemsByLabel,
  reportFor,
  validateAll,
} from './components/handoverForm';
import { ChecklistStep, ConditionStep, PhotosStep, StepProgress } from './components/HandoverSteps';
import { eyebrowClass, linkButtonClass, pageHeadingClass, textLinkClass } from './components/styles';
import { useNow, useRefetchAt } from './components/useClock';

// /bookings/:id/check-in and /bookings/:id/check-out (frontend.md §6.2): one wizard, the phase from
// the route. ① the resource's checklist, each item OK or not with an optional note; ② photos
// through PhotoUploader (optional; check-out shows the check-in photos for reference); ③ overall
// condition and notes. Then POST …/check-in or …/check-out with { items, photos, overall, notes }
// (api.md). Errors such as the check-in window (409) stay in place; after success the booking's
// keys are refreshed (the hooks wait for it) and the page goes back to the booking.

const COPY = {
  check_in: {
    title: 'Check in',
    icon: LogIn,
    submit: 'Check in now',
    pending: 'Checking in…',
    toast: 'Checked in',
    announce: 'Checked in. The booking is now in use.',
    errorTitle: "You weren't checked in",
  },
  check_out: {
    title: 'Check out',
    icon: LogOut,
    submit: 'Check out now',
    pending: 'Checking out…',
    toast: 'Checked out',
    announce: 'Checked out. The booking is returned and awaits the manager’s confirmation.',
    errorTitle: "You weren't checked out",
  },
};

function WizardSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading the booking…</span>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function BlockedCard({ block, booking, onRefresh, refreshing }) {
  return (
    <Card variant="warning" className="p-5 space-y-3">
      <h2 className="text-lg font-black flex items-center gap-2">
        <Clock className="w-5 h-5 shrink-0" aria-hidden="true" />
        {block.title}
      </h2>
      <p className="text-sm">{block.message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold">Status:</span>
        <StatusBadge booking={booking} size="sm" />
      </div>
      <div className="flex flex-col sm:flex-row gap-3 pt-1">
        {block.next && (
          <Link to={handoverPath(booking._id, block.next)} className={linkButtonClass('forest')}>
            {block.next === 'check_out' ? 'Go to check-out' : 'Go to check-in'}
          </Link>
        )}
        <Link to={bookingPath(booking._id)} className={linkButtonClass('outline')}>
          Back to the booking
        </Link>
        {block.opensAt && (
          <Button type="button" variant="ghost" size="md" className="min-h-[44px]" onClick={onRefresh} loading={refreshing}>
            Check again
          </Button>
        )}
      </div>
    </Card>
  );
}

function HandoverWizard({ id, phase }) {
  const checkOut = phase === 'check_out';
  const copy = COPY[phase];
  const navigate = useNavigate();
  const now = useNow();
  const prefix = `handover${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const bookingQuery = useBooking(id);
  const timelineQuery = useTimeline(id, { enabled: Boolean(id) && checkOut });
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const mutation = checkOut ? checkOutMutation : checkInMutation;

  const [state, dispatch] = useReducer(handoverReducer, undefined, initialHandover);
  const [photosBusy, setPhotosBusy] = useState(false);
  const onPhotosBusy = useCallback((busy) => setPhotosBusy(busy), []);
  const onPhotos = useCallback((photos) => dispatch({ type: 'photos', photos }), []);

  const booking = bookingQuery.data?.data ?? null;
  const checklist = useMemo(() => checklistOf(booking), [booking]);
  const subject = resourceTitle(booking, '');
  const reference = checkOut ? latestReport(timelineQuery.data?.data, 'check_in') : null;
  const referenceItems = useMemo(() => (reference ? itemsByLabel(reference) : null), [reference]);
  const summary = checklistSummary(checklist, state.answers);

  // Only before anything was sent: once a submit has started, the refetched booking (checked in,
  // or a 409's fresh state) must not swap the form for this card. The error stays in place instead.
  const block = booking && mutation.isIdle ? handoverBlock(booking, phase, now) : null;
  useRefetchAt(block?.opensAt ?? null, bookingQuery.refetch);

  // Focus: the page heading once the booking is on screen; then the step heading on each step, or
  // the first field with an error.
  const titleRef = useRef(null);
  const stepRefs = useRef({});
  const focusedOnLoad = useRef(false);
  useEffect(() => {
    if (!booking || focusedOnLoad.current) return;
    focusedOnLoad.current = true;
    titleRef.current?.focus();
  }, [booking]);
  useEffect(() => {
    if (!state.focus) return;
    const domId = fieldDomId(prefix, state.focus.target);
    const target = (domId && document.getElementById(domId)) || stepRefs.current[state.step];
    target?.focus();
  }, [state.focus, state.step, prefix]);

  const requestError = mutation.error && !hasFieldErrors(mutation.error) ? mutation.error : null;
  const photoError =
    state.errors.photos ??
    Object.entries(state.errors).find(([path]) => path.startsWith('photos.'))?.[1] ??
    null;

  const submit = () => {
    if (mutation.isPending || photosBusy || !booking) return;
    const errors = validateAll(state, checklist);
    if (Object.keys(errors).length) {
      dispatch({ type: 'invalid', errors });
      return;
    }
    mutation.mutate(
      { id, resourceId: idOf(booking.resource), ...reportFor(state, checklist) },
      {
        onSuccess: () => {
          toast.success(copy.toast, { description: subject || undefined });
          navigate(bookingPath(id), { state: { announce: copy.announce } });
        },
        onError: (err) => {
          // Field errors go beside their fields (on the step they belong to); anything else
          // (the check-in window, a changed status, 403, 503) shows above the button.
          if (hasFieldErrors(err)) dispatch({ type: 'serverError', error: err });
        },
      }
    );
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (state.step < LAST_STEP) dispatch({ type: 'next', checklist });
    else submit();
  };

  const back = () => dispatch({ type: 'back' });

  return (
    <div className="space-y-6 font-mono text-[#1a1a1a] max-w-3xl mx-auto">
      <Link to={bookingPath(id)} className={`${textLinkClass} inline-flex items-center gap-1.5 text-sm py-2 min-h-[44px]`}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to the booking
      </Link>

      <div className="border-b-2 border-[#1a1a1a] pb-4 space-y-1">
        <span className={eyebrowClass}>Handover</span>
        <h1 ref={titleRef} tabIndex={-1} className={`${pageHeadingClass} flex items-center gap-2`}>
          <copy.icon className="w-6 h-6 shrink-0" aria-hidden="true" />
          {copy.title}
        </h1>
        {booking && (
          <p className="text-sm">
            <span className="font-bold">{subject || 'Booking'}</span>
            {formatSlot(booking.start, booking.end) && (
              <>
                {' · '}
                <time dateTime={String(booking.start ?? '')}>{formatSlot(booking.start, booking.end)}</time>
              </>
            )}
          </p>
        )}
      </div>

      {bookingQuery.isPending && <WizardSkeleton />}

      {bookingQuery.isError && !booking && (
        <ErrorState
          error={bookingQuery.error}
          title="Couldn't load this booking"
          onRetry={() => bookingQuery.refetch()}
          retrying={bookingQuery.isFetching}
        >
          <Link to="/bookings" className={textLinkClass}>
            Back to my bookings
          </Link>
        </ErrorState>
      )}

      {block && (
        <BlockedCard
          block={block}
          booking={booking}
          onRefresh={() => bookingQuery.refetch()}
          refreshing={bookingQuery.isFetching}
        />
      )}

      {booking && !block && (
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          {checkOut && booking.isOverdue && (
            <p className="flex items-start gap-2 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] p-3 text-sm">
              <AlarmClock className="w-5 h-5 shrink-0 text-[#c0392b]" aria-hidden="true" />
              <span>
                <span className="font-bold text-[#c0392b]">Overdue. </span>
                This booking has ended. Check out as soon as you return the item.
              </span>
            </p>
          )}

          <StepProgress step={state.step} />

          <section hidden={state.step !== 1} className="space-y-6">
            <ChecklistStep
              prefix={prefix}
              checklist={checklist}
              answers={state.answers}
              errors={state.errors}
              itemsErrors={state.itemsErrors}
              reference={referenceItems}
              dispatch={dispatch}
              headingRef={(node) => {
                stepRefs.current[1] = node;
              }}
              onReload={() => bookingQuery.refetch()}
              reloading={bookingQuery.isFetching}
            />
            <div className="flex justify-end pt-2 border-t-2 border-[#1a1a1a]/15">
              <Button type="submit" variant="forest" size="lg" className="w-full sm:w-auto">
                Next: {HANDOVER_STEPS[1].label}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </section>

          <section hidden={state.step !== 2} className="space-y-6">
            <PhotosStep
              checkOut={checkOut}
              photos={state.photos}
              onPhotos={onPhotos}
              onBusyChange={onPhotosBusy}
              error={photoError}
              subject={subject}
              headingRef={(node) => {
                stepRefs.current[2] = node;
              }}
              reference={reference}
              referenceQuery={timelineQuery}
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 pt-2 border-t-2 border-[#1a1a1a]/15">
              <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto bg-white" onClick={back}>
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back
              </Button>
              <Button type="submit" variant="forest" size="lg" className="w-full sm:w-auto">
                Next: {HANDOVER_STEPS[2].label}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </section>

          <section hidden={state.step !== 3} className="space-y-6">
            <ConditionStep
              prefix={prefix}
              overall={state.overall}
              notes={state.notes}
              errors={state.errors}
              summary={summary}
              photoCount={state.photos.length}
              checkOut={checkOut}
              dispatch={dispatch}
              headingRef={(node) => {
                stepRefs.current[3] = node;
              }}
            />

            <ErrorState error={requestError} title={copy.errorTitle}>
              {requestError?.code === 'INVALID_TRANSITION' || requestError?.status === 403 ? (
                <Link to={bookingPath(id)} className={textLinkClass}>
                  See the booking as it is now
                </Link>
              ) : null}
            </ErrorState>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 pt-2 border-t-2 border-[#1a1a1a]/15">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full sm:w-auto bg-white"
                onClick={back}
                disabled={mutation.isPending}
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back
              </Button>
              {/* loading, not disabled: the pressed button keeps a keyboard user's focus. */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                loading={mutation.isPending || photosBusy}
              >
                {mutation.isPending ? copy.pending : photosBusy ? 'Waiting for the photos…' : copy.submit}
              </Button>
            </div>
          </section>
        </form>
      )}
    </div>
  );
}

/**
 * The wizard for one booking. It is keyed by the booking id (the route already keys it by phase),
 * so moving to another booking's handover starts from an empty form.
 */
export default function HandoverPage({ phase = 'check_in' }) {
  const { id } = useParams();
  const known = phase === 'check_out' ? 'check_out' : 'check_in';
  return <HandoverWizard key={id ?? 'none'} id={id} phase={known} />;
}
