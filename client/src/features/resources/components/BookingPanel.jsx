import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, CalendarCheck, Clock, ListOrdered, ShieldAlert, Timer } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Select } from '../../../components/ui/Select';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { errorMessage, errorToastText, fieldErrorsFrom } from '../../../lib/errors';
import { cn, formatCountdown } from '../../../lib/utils';
import { PURPOSE_MAX, PURPOSE_MIN, useCreateBooking } from '../../bookings/api';
import { useBookingCheck } from '../api';
import { approvalView, limitsList } from '../format';
import { useDebouncedValue, useSecondsUntil } from '../hooks';
import {
  cellEndingAt,
  cellStartingAt,
  describeSelection,
  endDayOptions,
  endOptions,
  selectionFromKey,
  selectionFromStart,
  selectionKey,
  startDayOptions,
  startTimeOptions,
} from '../slots';
import { EligibilityChecklist } from './EligibilityChecklist';

// The booking panel of /resources/:id (frontend.md §7 BookingPanel; api.md "Bookings": check and
// create). Start and end come from the AvailabilityGrid or from the lists here, both on the
// resource's slot grid; the page holds the selection. A live pre-check (POST /bookings/check,
// debounced) shows every rule for the chosen time; POST /bookings then answers with the booking
// (pending, approved or waitlisted), 409 SLOT_TAKEN (offer the waitlist: joinWaitlist: true),
// 422 INELIGIBLE (the failed rules), or 429 (the wait). Nothing is shown before the server says so.

const CHECK_DELAY_MS = 400;
const FIELD_CODES_INLINE = ['purpose', 'start', 'end'];

const linkClass = (variant = 'primary') =>
  cn(
    'inline-flex items-center justify-center gap-2 font-bold font-mono tracking-tight border-2 border-[#1a1a1a]',
    'px-4 py-2.5 min-h-[44px] text-sm rounded-md shadow-[3px_3px_0px_0px_#1a1a1a] transition-all',
    'hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
    variant === 'primary' ? 'bg-[#183d2d] text-white' : 'bg-white text-[#1a1a1a]'
  );

const OUTCOME_COPY = {
  approved: {
    tone: 'success',
    title: 'You can book this time',
    text: () => 'Every check passes, and this resource approves automatically: you will be booked at once.',
  },
  pending: {
    tone: 'success',
    title: 'You can request this time',
    text: () => 'Every check passes. A manager reviews each request, so yours will be Awaiting review.',
  },
  slot_taken: {
    tone: 'warning',
    title: 'This slot is taken',
    text: (position) =>
      position
        ? `Every rule passes, but an earlier request holds this slot. You can join the waitlist as #${position}.`
        : 'Every rule passes, but an earlier request holds this slot. You can join the waitlist.',
  },
  ineligible: {
    tone: 'danger',
    title: "You can't book this time yet",
    text: () => 'Fix the checks marked "Not met", or pick another time.',
  },
};

const TONE_BOX = {
  success: 'bg-[#f0faf5] border-[#183d2d]',
  warning: 'bg-[#fef9f3] border-[#e67e22]',
  danger: 'bg-[#fff5f5] border-[#c0392b]',
};

/**
 * The pre-check of the chosen time. `result` is POST /bookings/check's data { eligible, outcome,
 * results, waitlistPosition }; `stale` marks it as the previous time's answer while the new one
 * is checked. One status region is on the page in every state and only its text changes: a live
 * region inserted with the answer already in it is usually not read out, so the first answer
 * would go unannounced.
 */
export function PreCheck({ hasSelection, result, loading, stale, error, onRetry, retrying, resource, slotText }) {
  const failed = hasSelection && error && !result;
  const copy = result ? (OUTCOME_COPY[result.outcome] ?? OUTCOME_COPY.pending) : null;
  let box = null;
  let message = null;
  if (!hasSelection) {
    box = 'text-[#1a1a1a]/75 border-dashed border-[#1a1a1a]/40 bg-[#f5f0e8]';
    message = <p>Pick a time to check it against every rule before you send anything.</p>;
  } else if (!failed && !result) {
    box = 'border-[#1a1a1a]/30 bg-white';
    message = <p className="font-bold">Checking this time…</p>;
  } else if (result) {
    box = cn(TONE_BOX[copy.tone], (loading || stale) && 'opacity-70');
    message =
      loading || stale ? (
        <p className="font-bold">Checking the new time…</p>
      ) : (
        <>
          <p className="font-black text-sm">{copy.title}</p>
          <p className="mt-0.5 leading-relaxed">{copy.text(result.waitlistPosition)}</p>
        </>
      );
  }
  // No space-y: the region is empty while the error shows, and must not leave a gap.
  return (
    <div>
      <div role="status" aria-live="polite" className={box ? cn('p-3 rounded-lg border-2 text-xs', box) : undefined}>
        {message}
      </div>
      {failed && (
        <ErrorState error={error} title="Couldn't check this time" onRetry={onRetry} retrying={retrying}>
          You can still send the request: the server checks every rule again.
        </ErrorState>
      )}
      {result && (
        <EligibilityChecklist
          bare
          headingLevel="h3"
          title="Pre-check"
          eyebrow={slotText ?? undefined}
          results={result.results}
          resource={resource}
          busy={loading || stale}
          className="mt-3"
        />
      )}
    </div>
  );
}

const CONFIRMATION_COPY = {
  pending: (unit) => ({
    title: 'Request sent',
    text: `It is awaiting review by ${unit}. You'll get a notification when a manager decides.`,
  }),
  approved: () => ({
    title: "You're booked",
    text: 'Approved automatically: every check passed. Check in from the booking page when your time starts.',
  }),
  waitlisted: (_unit, position) => ({
    title: "You're on the waitlist",
    text: position
      ? `You're #${position} in line. If the slot frees up you move up, and you'll be notified.`
      : "If the slot frees up you move up, and you'll be notified.",
  }),
};

/**
 * POST /bookings succeeded: `result` is its data { booking, evaluation, waitlistPosition }. Links to
 * the booking; "Book another time" goes back to the form.
 */
export function BookingConfirmation({ result, resource, onBookAnother, headingRef }) {
  const booking = result?.booking ?? null;
  const status = booking?.status ?? 'pending';
  const position = result?.waitlistPosition ?? null;
  const unit = resource?.orgUnit?.name ?? 'the unit';
  const copy = (CONFIRMATION_COPY[status] ?? CONFIRMATION_COPY.pending)(unit, position);
  const when = describeSelection(booking);
  return (
    <div className="p-4 rounded-xl border-2 border-[#183d2d] bg-[#f0faf5] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-black tracking-tight focus:outline-none">
          {copy.title}
        </h3>
        <StatusBadge status={status} waitlistPosition={position} />
      </div>
      {when && (
        <p className="text-sm font-bold flex items-center gap-1.5">
          <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
          {when}
        </p>
      )}
      <p className="text-xs leading-relaxed">{copy.text}</p>
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-1">
        {booking?._id && (
          <Link to={`/bookings/${encodeURIComponent(booking._id)}`} className={linkClass('primary')}>
            View booking
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
        <Link to="/bookings" className={linkClass('outline')}>
          My bookings
        </Link>
        <Button type="button" variant="ghost" size="md" className="min-h-[44px]" onClick={onBookAnother}>
          Book another time
        </Button>
      </div>
    </div>
  );
}

/**
 * POST /bookings was refused: 409 SLOT_TAKEN (details { waitlistPosition }: offer the waitlist),
 * 422 INELIGIBLE (details [{ rule, passed: false, message, fixHint }]), 429 (the wait), anything else
 * as an ErrorState with a retry.
 */
export function BookingRefusal({
  error,
  resource,
  onJoinWaitlist,
  joining = false,
  onChooseAnother,
  onRetry,
  retrying = false,
  secondsLeft = 0,
  headingRef,
}) {
  if (!error) return null;
  const heading = (text) => (
    <h3 ref={headingRef} tabIndex={-1} className="text-base font-black tracking-tight focus:outline-none">
      {text}
    </h3>
  );

  if (error.code === 'SLOT_TAKEN') {
    const position = Number(error.details?.waitlistPosition) || null;
    return (
      <div role="alert" className="p-4 rounded-xl border-2 border-[#e67e22] bg-[#fef9f3] space-y-3">
        <div className="flex items-start gap-2">
          <ListOrdered className="w-5 h-5 shrink-0 text-[#b9470b] mt-0.5" aria-hidden="true" />
          {heading('This slot is held by an earlier request')}
        </div>
        <p className="text-sm leading-relaxed">{errorMessage(error)}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" variant="primary" size="md" className="min-h-[44px]" loading={joining} onClick={onJoinWaitlist}>
            {joining ? 'Joining the waitlist…' : position ? `Join the waitlist as #${position}` : 'Join the waitlist'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-[44px] bg-white"
            disabled={joining}
            onClick={onChooseAnother}
          >
            Choose another time
          </Button>
        </div>
      </div>
    );
  }

  if (error.code === 'INELIGIBLE') {
    const failed = (Array.isArray(error.details) ? error.details : []).filter((r) => r && typeof r === 'object');
    return (
      <div role="alert" className="p-4 rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] space-y-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-5 h-5 shrink-0 text-[#a93226] mt-0.5" aria-hidden="true" />
          {heading("You can't book this time")}
        </div>
        <p className="text-sm leading-relaxed">{errorMessage(error)}</p>
        {failed.length > 0 && (
          <EligibilityChecklist
            bare
            headingLevel="h4"
            title="What stopped it"
            summary="Each rule says what to do next."
            results={failed.map((r) => ({ ...r, passed: false }))}
            resource={resource}
          />
        )}
        {error.requestId && <p className="text-xs text-[#1a1a1a]/70 break-all">ref: {error.requestId}</p>}
      </div>
    );
  }

  if (error.code === 'RATE_LIMITED') {
    // The alert holds the refusal and the server's message (which says how long to wait). The
    // countdown ticks every second, so it sits outside the alert: inside it, a screen reader would
    // read the new time out every second.
    return (
      <div className="p-4 rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] space-y-2">
        <div role="alert" className="space-y-2">
          <div className="flex items-start gap-2">
            <Timer className="w-5 h-5 shrink-0 text-[#a93226] mt-0.5" aria-hidden="true" />
            {heading('Too many booking requests')}
          </div>
          <p className="text-sm leading-relaxed">{error.message}</p>
        </div>
        <p className="text-sm font-bold">
          {secondsLeft > 0 ? (
            <>
              You can send again in <span className="tabular-nums">{formatCountdown(secondsLeft)}</span>.
            </>
          ) : (
            'You can send again now.'
          )}
        </p>
        {error.requestId && <p className="text-xs text-[#1a1a1a]/70 break-all">ref: {error.requestId}</p>}
      </div>
    );
  }

  return (
    <div>
      <span ref={headingRef} tabIndex={-1} className="sr-only">
        Your booking wasn't sent
      </span>
      <ErrorState error={error} title="Your booking wasn't sent" onRetry={onRetry} retrying={retrying} />
    </div>
  );
}

/** Whether a create error is a field error shown beside its field instead of in BookingRefusal. */
function isInlineFieldError(err) {
  const fields = fieldErrorsFrom(err);
  return Object.keys(fields).some((path) => FIELD_CODES_INLINE.includes(path));
}

export function BookingPanel({
  resource,
  model,
  modelLoading = false,
  modelError = null,
  selection = null,
  onSelectionChange,
  onBooked,
}) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const purposeId = `${ids}-purpose`;
  const purposeHintId = `${ids}-purpose-hint`;
  const purposeErrorId = `${ids}-purpose-error`;
  const submitHintId = `${ids}-submit-hint`;
  const startDayRef = useRef(null);
  const purposeRef = useRef(null);
  const confirmationRef = useRef(null);
  const refusalRef = useRef(null);

  const resourceId = resource?._id;
  const mode = resource?.bookingMode === 'loan' ? 'loan' : 'slot';
  const minMinutes = Number(resource?.limits?.minDurationMins) || 0;
  const approval = approvalView(resource?.eligibility?.approvalMode);

  const [purpose, setPurpose] = useState('');
  const [purposeError, setPurposeError] = useState(null);
  const [slotError, setSlotError] = useState(null);
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(null); // { key, joinWaitlist } of the last send
  // The last refusal, kept in state (not read from the mutation) so that a retry from inside it
  // ("Join the waitlist", "Try again") keeps it, and the button just pressed, on screen.
  const [refusalError, setRefusalError] = useState(null);
  const [retryAt, setRetryAt] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  // ── Pre-check ──────────────────────────────────────────────────────────────
  const key = selectionKey(selection);
  const settledKey = useDebouncedValue(key, CHECK_DELAY_MS);
  const checkedSlot = selectionFromKey(settledKey);
  const check = useBookingCheck(resourceId, key ? checkedSlot : null);
  const checkData = key ? check.data?.data : null;
  // The answer is for the time on screen: the pause is over and it isn't the previous time's
  // answer kept as a placeholder. A background refetch of the same time keeps it current.
  const checkCurrent = Boolean(key && settledKey === key && check.isSuccess && !check.isPlaceholderData);
  const rechecking = Boolean(key) && (settledKey !== key || check.isPlaceholderData);
  const outcome = checkCurrent ? checkData?.outcome : null;
  const waitlistPosition = checkCurrent ? (checkData?.waitlistPosition ?? null) : null;

  // ── Create ─────────────────────────────────────────────────────────────────
  const create = useCreateBooking();
  const joining = create.isPending && Boolean(attempt?.joinWaitlist);
  const refusal = refusalError && attempt?.key === key ? refusalError : null;

  const secondsLeft = useSecondsUntil(retryAt);
  const rateLimited = secondsLeft > 0;

  useEffect(() => {
    if (result) confirmationRef.current?.focus();
  }, [result]);
  useEffect(() => {
    if (refusalError) refusalRef.current?.focus();
  }, [refusalError]);

  // ── Pickers ────────────────────────────────────────────────────────────────
  const startDays = startDayOptions(model);
  const startCell = cellStartingAt(model, selection?.start);
  const startDay = startCell ? String(startCell.dayIndex) : '';
  const startTimes = startTimeOptions(model, startDay);
  const ends = selection ? endOptions(model, selection.start, mode) : [];
  const endCell = cellEndingAt(model, selection?.end);
  const endDay = endCell ? String(endCell.dayIndex) : '';
  const endDays = endDayOptions(model, ends);
  const endTimes = mode === 'loan' ? ends.filter((option) => String(option.dayIndex) === endDay) : ends;
  const hasEnd = ends.some((option) => option.value === selection?.end);

  const choose = (next) => {
    setSlotError(null);
    onSelectionChange?.(next);
  };
  const onStartDay = (value) => {
    if (value === '') return choose(null);
    const first = startTimeOptions(model, value)[0];
    choose(first ? selectionFromStart(model, first.value, { mode, minMinutes }) : null);
  };
  const onStartTime = (value) =>
    choose(value ? selectionFromStart(model, value, { mode, previousEnd: selection?.end, minMinutes }) : null);
  const onEndDay = (value) => {
    const options = ends.filter((option) => String(option.dayIndex) === value);
    const pick = options.find((option) => option.minutes >= minMinutes) ?? options[0];
    if (pick && selection) choose({ start: selection.start, end: pick.value });
  };
  const onEndTime = (value) => {
    if (value && selection) choose({ start: selection.start, end: value });
  };

  // ── Send ───────────────────────────────────────────────────────────────────
  const purposeLength = purpose.trim().length;
  const blocked = outcome === 'ineligible';

  // `fromRefusal`: sent from the refusal's own button, which stays on screen while it runs.
  const send = (joinWaitlist = false, { fromRefusal = false } = {}) => {
    if (create.isPending || rateLimited) return;
    let firstInvalid = null;
    if (!key) {
      setSlotError('Choose when you need it: a start and an end.');
      firstInvalid = startDayRef;
    }
    const text = purpose.trim();
    const problem =
      text.length < PURPOSE_MIN
        ? `Say what it's for in at least ${PURPOSE_MIN} characters.`
        : text.length > PURPOSE_MAX
          ? `Keep it to ${PURPOSE_MAX} characters or fewer.`
          : null;
    setPurposeError(problem);
    if (problem && !firstInvalid) firstInvalid = purposeRef;
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }
    if (blocked && !joinWaitlist) return;
    setAttempt({ key, joinWaitlist });
    if (!fromRefusal) setRefusalError(null);
    setAnnouncement('');
    create.mutate(
      { resourceId, start: selection.start, end: selection.end, purpose: text, joinWaitlist },
      {
        onSuccess: (response) => {
          const data = response?.data ?? null;
          const status = data?.booking?.status;
          const message =
            status === 'approved'
              ? 'Booked: approved automatically.'
              : status === 'waitlisted'
                ? `Joined the waitlist${data?.waitlistPosition ? ` as #${data.waitlistPosition}` : ''}.`
                : 'Request sent: awaiting review.';
          setResult(data);
          setPurpose('');
          setAttempt(null);
          setRefusalError(null);
          setRetryAt(null);
          setAnnouncement(message);
          toast.success(message);
          onBooked?.(data?.booking ?? null);
        },
        onError: (err) => {
          if (err?.code === 'RATE_LIMITED' && err.retryAfter) setRetryAt(Date.now() + err.retryAfter * 1000);
          const fields = fieldErrorsFrom(err);
          if (fields.purpose) {
            setRefusalError(null);
            setPurposeError(fields.purpose);
            purposeRef.current?.focus();
            return;
          }
          if (fields.start || fields.end) {
            setRefusalError(null);
            setSlotError(fields.start ?? fields.end);
            startDayRef.current?.focus();
            return;
          }
          setRefusalError(isInlineFieldError(err) ? null : err);
          if (!['SLOT_TAKEN', 'INELIGIBLE', 'RATE_LIMITED'].includes(err?.code)) {
            toast.error("Your booking wasn't sent", { description: errorToastText(err) });
          }
        },
      }
    );
  };

  const chooseAnother = () => {
    create.reset();
    setAttempt(null);
    setRefusalError(null);
    startDayRef.current?.focus();
  };

  // "Clear" goes away with the selection: focus the Day picker (the next thing to choose), so a
  // keyboard user isn't dropped to <body> at the top of a long page.
  const clearSelection = () => {
    choose(null);
    startDayRef.current?.focus();
  };

  const bookAnother = () => {
    setResult(null);
    create.reset();
    setRefusalError(null);
    setAnnouncement('');
    setTimeout(() => startDayRef.current?.focus(), 0);
  };

  // ── View ───────────────────────────────────────────────────────────────────
  const limitsText = limitsList(resource?.limits)
    .map((item) => `${item.label}: ${item.value}`)
    .join(' · ');
  const slotText = describeSelection(selection);
  const submitLabel = create.isPending
    ? joining
      ? 'Joining the waitlist…'
      : 'Sending…'
    : rateLimited
      ? `Try again in ${formatCountdown(secondsLeft)}`
      : outcome === 'slot_taken'
        ? waitlistPosition
          ? `Join the waitlist as #${waitlistPosition}`
          : 'Join the waitlist'
        : resource?.eligibility?.approvalMode === 'auto'
          ? 'Book now'
          : 'Request booking';
  const submitHint = rateLimited
    ? 'The server asked to wait before another booking request.'
    : blocked
      ? 'Fix the checks marked "Not met", or pick another time, before you send it.'
      : outcome === 'slot_taken'
        ? 'You join the waitlist and move up if the slot frees up.'
        : approval.description;

  let body;
  if (resource?.status && resource.status !== 'active') {
    body = (
      <p className="p-3 rounded-lg border-2 border-[#e67e22] bg-[#fef9f3] text-sm">
        {resource.status === 'maintenance'
          ? 'This resource is under maintenance, so it isn’t taking bookings right now.'
          : 'This resource is archived and can’t be booked.'}
      </p>
    );
  } else if (result) {
    body = (
      <BookingConfirmation
        result={result}
        resource={resource}
        onBookAnother={bookAnother}
        headingRef={confirmationRef}
      />
    );
  } else if (!model) {
    body = modelError ? (
      <p className="text-sm p-3 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5]">
        The open times couldn&apos;t be loaded, so there is nothing to pick yet. Use “Try again” on the
        availability grid.
      </p>
    ) : (
      <p role="status" className="text-sm font-bold">
        {modelLoading ? 'Loading the open times…' : 'No open times to show.'}
      </p>
    );
  } else if (!model.hasOpenSlots) {
    body = (
      <p className="text-sm p-3 rounded-lg border-2 border-dashed border-[#1a1a1a]/40 bg-[#f5f0e8]">
        There are no open times left in the next 7 days.
      </p>
    );
  } else {
    body = (
      <form
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          send(outcome === 'slot_taken');
        }}
      >
        <fieldset className="space-y-3">
          <legend className="text-sm font-black tracking-tight mb-2">
            {mode === 'loan' ? 'Pickup and return' : 'When'}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              ref={startDayRef}
              label={mode === 'loan' ? 'Pickup day' : 'Day'}
              value={startDay}
              onChange={(event) => onStartDay(event.target.value)}
              error={slotError ?? undefined}
            >
              <option value="">Choose a day</option>
              {startDays.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              label={mode === 'loan' ? 'Pickup time' : 'Start time'}
              value={startCell ? selection.start : ''}
              onChange={(event) => onStartTime(event.target.value)}
              disabled={!startDay}
            >
              <option value="">{startDay ? 'Choose a time' : 'Choose a day first'}</option>
              {startTimes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {mode === 'loan' && (
              <Select
                label="Return day"
                value={endDay}
                onChange={(event) => onEndDay(event.target.value)}
                disabled={!startCell}
              >
                <option value="">{startCell ? 'Choose a day' : 'Choose the pickup first'}</option>
                {endDays.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
            <Select
              label={mode === 'loan' ? 'Return time' : 'End time'}
              value={hasEnd ? selection.end : ''}
              onChange={(event) => onEndTime(event.target.value)}
              disabled={!startCell}
            >
              <option value="">{startCell ? 'Choose a time' : 'Choose the start first'}</option>
              {endTimes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          {limitsText && <p className="text-[11px] text-[#1a1a1a]/75">{limitsText}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border-2 border-[#1a1a1a] bg-[#ede8df]">
            <p aria-live="polite" className="text-sm font-bold flex items-center gap-1.5 min-w-0">
              <CalendarCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{slotText ? `Selected: ${slotText}` : 'Nothing selected yet.'}</span>
            </p>
            {selection && (
              <Button type="button" variant="ghost" size="sm" className="min-h-[36px]" onClick={clearSelection}>
                Clear
              </Button>
            )}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={purposeId} className="text-sm font-bold tracking-tight">
            What&apos;s it for?
          </label>
          <textarea
            ref={purposeRef}
            id={purposeId}
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
              if (purposeError) setPurposeError(null);
            }}
            rows={3}
            maxLength={PURPOSE_MAX}
            required
            aria-required="true"
            aria-invalid={purposeError ? 'true' : undefined}
            aria-describedby={[purposeHintId, purposeError && purposeErrorId].filter(Boolean).join(' ')}
            placeholder="e.g. Printing the chassis for the robotics club"
            className={cn(
              'w-full px-4 py-2.5 text-sm rounded-lg border-2 bg-white font-mono placeholder:text-[#1a1a1a]/60',
              'focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
              purposeError ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
            )}
          />
          <p id={purposeHintId} className="text-xs text-[#1a1a1a]/75 flex justify-between gap-2">
            <span>
              {PURPOSE_MIN}–{PURPOSE_MAX} characters. The unit&apos;s managers see it.
            </span>
            <span aria-hidden="true" className="shrink-0 tabular-nums">
              {purposeLength}/{PURPOSE_MAX}
            </span>
          </p>
          {purposeError && (
            <p id={purposeErrorId} role="alert" className="text-xs font-semibold text-[#a93226] flex items-center gap-1">
              <span aria-hidden="true">✕</span> {purposeError}
            </p>
          )}
        </div>

        <PreCheck
          hasSelection={Boolean(key)}
          result={checkData}
          loading={rechecking}
          stale={check.isPlaceholderData}
          error={check.error}
          onRetry={() => check.refetch()}
          retrying={check.isFetching}
          resource={resource}
          slotText={slotText}
        />

        <BookingRefusal
          error={refusal}
          resource={resource}
          joining={joining}
          onJoinWaitlist={() => send(true, { fromRefusal: true })}
          onChooseAnother={chooseAnother}
          onRetry={() => send(Boolean(attempt?.joinWaitlist), { fromRefusal: true })}
          retrying={create.isPending}
          secondsLeft={secondsLeft}
          headingRef={refusalRef}
        />

        {!(refusal?.code === 'SLOT_TAKEN') && (
          <div className="space-y-2 pt-2 border-t-2 border-[#1a1a1a]/15">
            <Button
              type="submit"
              variant={outcome === 'slot_taken' ? 'primary' : 'forest'}
              size="lg"
              className="w-full"
              loading={create.isPending}
              aria-disabled={blocked || rateLimited || undefined}
              aria-describedby={submitHintId}
            >
              {submitLabel}
            </Button>
            <p id={submitHintId} className="text-xs text-[#1a1a1a]/75 leading-relaxed">
              {submitHint}
            </p>
          </div>
        )}
      </form>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 sm:p-5 font-mono text-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a] space-y-4"
    >
      <div className="pb-3 border-b-2 border-[#1a1a1a]/15">
        <h2 id={headingId} className="text-base font-black tracking-tight">
          Book this resource
        </h2>
        <p className="text-xs text-[#1a1a1a]/75 mt-1">
          {approval.label}: {approval.description}
        </p>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {body}
    </section>
  );
}
