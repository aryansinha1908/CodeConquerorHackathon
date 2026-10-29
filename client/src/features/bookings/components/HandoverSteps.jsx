import React from 'react';
import { CheckCircle2, ImageOff, RotateCcw, XCircle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { PhotoUploader } from '../../../components/PhotoUploader';
import { formatIstShortDateTime } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { CONDITION_OVERALL, ITEM_NOTE_MAX, REPORT_NOTES_MAX } from '../api';
import { ReportPhotos } from './ConditionReports';
import { HANDOVER_STEPS, LAST_STEP } from './handoverForm';
import { sectionHeadingClass } from './styles';

// The three steps of the check-in / check-out wizard (frontend.md §6.2, §7 ConditionReportForm):
// ① the checklist, ② photos, ③ overall condition and notes. Mobile-first: every control is at
// least 44 px tall, and the radios are large tiles (frontend.md §1 principle 3, §10.3).

const OVERALL_HELP = {
  good: 'Works and looks as expected.',
  minor_issue: 'Small wear or a cosmetic mark; still usable.',
  damaged: 'Broken, unsafe or missing parts.',
};

const OVERALL_BADGES = {
  good: { variant: 'green', label: 'Good condition' },
  minor_issue: { variant: 'amber', label: 'Minor issue' },
  damaged: { variant: 'red', label: 'Damaged' },
};

const tileClass =
  'flex items-center gap-3 min-h-[48px] px-4 py-2 rounded-lg border-2 border-[#1a1a1a] bg-white cursor-pointer ' +
  'shadow-[2px_2px_0_#1a1a1a] transition-colors select-none ' +
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#c0392b] has-[:focus-visible]:ring-offset-2';

const textFieldClass = (invalid) =>
  cn(
    'w-full px-4 py-2.5 min-h-[44px] text-sm rounded-lg border-2 bg-white font-mono text-[#1a1a1a]',
    'placeholder:text-[#1a1a1a]/50 focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
    invalid ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
  );

function FieldError({ id, children, alert = false }) {
  if (!children) return null;
  return (
    <p id={id} role={alert ? 'alert' : undefined} className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
      <span aria-hidden="true">✕</span> {children}
    </p>
  );
}

/** "1. Checklist · 2. Photos · 3. Condition" with the current step marked (aria-current="step"). */
export function StepProgress({ step }) {
  return (
    <ol aria-label="Progress" className="grid grid-cols-3 gap-2 text-xs font-bold">
      {HANDOVER_STEPS.map((s) => {
        const current = s.step === step;
        const done = s.step < step;
        return (
          <li
            key={s.id}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'rounded-md border-2 px-1 sm:px-2 py-2 text-center uppercase sm:tracking-wider break-words',
              current
                ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                : done
                  ? 'bg-[#f0faf5] text-[#183d2d] border-[#183d2d]'
                  : 'bg-white text-[#1a1a1a]/70 border-[#1a1a1a]/30'
            )}
          >
            <span className="sr-only">Step </span>
            {s.step}. {s.label}
            {done && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The step's heading: "Step 2 of 3: Photos". It takes focus when the step opens. */
export function StepHeading({ step, title, headingRef, children }) {
  return (
    <div className="space-y-1">
      <h2 ref={headingRef} tabIndex={-1} className={sectionHeadingClass}>
        <span className="text-[#c0392b]">
          Step {step} of {LAST_STEP}:
        </span>{' '}
        {title}
      </h2>
      {children && <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">{children}</p>}
    </div>
  );
}

function ChecklistItem({ prefix, index, label, answer, errors, reference, referenceLabel, dispatch }) {
  const okId = `${prefix}-items-${index}-ok`;
  const notOkId = `${prefix}-items-${index}-notok`;
  const noteId = `${prefix}-items-${index}-note`;
  const errorId = `${prefix}-items-${index}-error`;
  const noteErrorId = `${prefix}-items-${index}-note-error`;
  const noteHelpId = `${prefix}-items-${index}-note-help`;
  const okError = errors[`items.${index}.ok`] ?? errors[`items.${index}`];
  const noteError = errors[`items.${index}.note`];
  const ok = answer?.ok;
  const note = answer?.note ?? '';
  const name = `${prefix}-item-${index}`;
  const describedBy = [okError && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <li className={cn('rounded-xl border-2 bg-white p-4 shadow-[3px_3px_0_#1a1a1a]', okError ? 'border-[#c0392b]' : 'border-[#1a1a1a]')}>
      <fieldset className="space-y-3 min-w-0">
        <legend className="text-sm font-bold break-words">
          {index + 1}. {label}
        </legend>
        {reference && (
          <p className="text-xs text-[#1a1a1a]/70 flex items-start gap-1.5 -mt-1">
            {reference.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#1e7e45]" aria-hidden="true" />
            ) : (
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#c0392b]" aria-hidden="true" />
            )}
            <span className="break-words">
              {referenceLabel}: {reference.ok ? 'OK' : 'Not OK'}
              {reference.note ? ` — ${reference.note}` : ''}
            </span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label htmlFor={okId} className={cn(tileClass, 'has-[:checked]:bg-[#183d2d] has-[:checked]:text-white')}>
            <input
              id={okId}
              type="radio"
              name={name}
              checked={ok === true}
              onChange={() => dispatch({ type: 'answer', index, label, ok: true })}
              aria-describedby={describedBy}
              className="w-5 h-5 shrink-0 accent-[#1e7e45]"
            />
            <span className="text-sm font-bold">OK</span>
          </label>
          <label htmlFor={notOkId} className={cn(tileClass, 'has-[:checked]:bg-[#a93226] has-[:checked]:text-white')}>
            <input
              id={notOkId}
              type="radio"
              name={name}
              checked={ok === false}
              onChange={() => dispatch({ type: 'answer', index, label, ok: false })}
              aria-describedby={describedBy}
              className="w-5 h-5 shrink-0 accent-[#a93226]"
            />
            <span className="text-sm font-bold">Not OK</span>
          </label>
        </div>
        <FieldError id={errorId}>{okError}</FieldError>
        <div className="flex flex-col gap-1">
          {/* A "Not OK" needs a note (frontend.md §9); an OK item may have one. */}
          <label htmlFor={noteId} className="text-xs font-bold">
            {ok === false ? "What's wrong with it?" : 'Note (optional)'}
          </label>
          <input
            id={noteId}
            type="text"
            value={note}
            maxLength={ITEM_NOTE_MAX}
            onChange={(event) => dispatch({ type: 'note', index, label, note: event.target.value })}
            aria-required={ok === false ? 'true' : undefined}
            aria-invalid={noteError ? 'true' : undefined}
            aria-describedby={[noteHelpId, noteError && noteErrorId].filter(Boolean).join(' ')}
            className={textFieldClass(Boolean(noteError))}
          />
          <p id={noteHelpId} className="text-[11px] text-[#1a1a1a]/70">
            {ok === false ? 'Required: say what is wrong so the manager knows. ' : ''}At most {ITEM_NOTE_MAX} characters.
          </p>
          <FieldError id={noteErrorId}>{noteError}</FieldError>
        </div>
      </fieldset>
    </li>
  );
}

/**
 * ① Every checklist item OK or not, with an optional note. `reference` (check-out only) is the
 * check-in answer per label, shown under each item. `itemsErrors` are the server's messages on
 * the list itself (the checklist changed since the page loaded).
 */
export function ChecklistStep({
  prefix,
  checklist,
  answers,
  errors,
  itemsErrors = [],
  reference,
  referenceLabel = 'At check-in',
  dispatch,
  headingRef,
  onReload,
  reloading = false,
}) {
  const missing = checklist.filter((label) => answers[label]?.ok !== true && answers[label]?.ok !== false).length;
  const unanswered = Object.keys(errors).some((path) => /^items\.\d+(\.ok)?$/.test(path));
  return (
    <div className="space-y-4">
      <StepHeading step={1} title="Checklist" headingRef={headingRef}>
        Go through each item and mark it OK or not OK. Add a note where something is off.
      </StepHeading>
      {itemsErrors.length > 0 && (
        <div role="alert" className="p-4 bg-[#fff5f5] border-2 border-[#c0392b] rounded-lg text-sm space-y-2">
          <p className="font-bold text-[#c0392b]">The checklist has changed since this page loaded</p>
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            {itemsErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          {onReload && (
            <Button type="button" variant="outline" size="sm" className="bg-white min-h-[44px]" onClick={onReload} loading={reloading}>
              {!reloading && <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
              Load the current checklist
            </Button>
          )}
        </div>
      )}
      {unanswered && missing > 0 && (
        <p role="alert" className="text-sm font-bold text-[#c0392b]">
          Answer every item before you go on ({missing} left).
        </p>
      )}
      {checklist.length === 0 ? (
        <p className="text-sm rounded-lg border-2 border-dashed border-[#1a1a1a]/40 bg-[#f5f0e8] p-4">
          This resource has no checklist. Go on to the photos.
        </p>
      ) : (
        <ol className="space-y-3">
          {checklist.map((label, index) => (
            <ChecklistItem
              key={label}
              prefix={prefix}
              index={index}
              label={label}
              answer={answers[label]}
              errors={errors}
              reference={reference?.[label]}
              referenceLabel={referenceLabel}
              dispatch={dispatch}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The check-in report the check-out compares with: its photos, overall condition and notes.
 * `query` is the timeline query (loading and error states); `report` the latest check-in report.
 */
export function CheckInReference({ report, query, subject }) {
  return (
    <section
      aria-labelledby="checkin-reference-heading"
      className="rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df] p-4 space-y-3"
    >
      <h3 id="checkin-reference-heading" className="text-sm font-bold">
        At check-in, for reference
      </h3>
      {query?.isPending ? (
        <div aria-busy="true" className="grid grid-cols-3 gap-2 max-w-sm">
          <span className="sr-only">Loading the check-in photos…</span>
          <Skeleton className="aspect-square" />
          <Skeleton className="aspect-square" />
          <Skeleton className="aspect-square" />
        </div>
      ) : query?.isError && !report ? (
        <ErrorState
          error={query.error}
          title="Couldn't load the check-in photos"
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      ) : !report ? (
        <p className="text-sm">There&apos;s no check-in report to compare with.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {OVERALL_BADGES[report.overall] && (
              <Badge variant={OVERALL_BADGES[report.overall].variant} size="sm">
                {OVERALL_BADGES[report.overall].label}
              </Badge>
            )}
            {formatIstShortDateTime(report.at) && (
              <span className="text-[#1a1a1a]/80">
                <time dateTime={String(report.at)}>{formatIstShortDateTime(report.at)} IST</time>
                {report.by ? ` · by ${String(report.by)}` : ''}
              </span>
            )}
          </div>
          {Array.isArray(report.photos) && report.photos.length > 0 ? (
            <ReportPhotos photos={report.photos} phaseLabel="Check-in" subject={subject} />
          ) : (
            <p className="text-xs flex items-center gap-1.5">
              <ImageOff className="w-4 h-4" aria-hidden="true" />
              No photos were taken at check-in.
            </p>
          )}
          {report.notes && (
            <p className="text-xs bg-white border-l-4 border-[#1a1a1a] px-3 py-2 rounded-r-md break-words">
              <span className="font-bold">Notes at check-in: </span>“{String(report.notes)}”
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** ② Photos through PhotoUploader (optional); on check-out, the check-in photos first. */
export function PhotosStep({
  checkOut,
  photos,
  onPhotos,
  onBusyChange,
  error,
  subject,
  headingRef,
  reference,
  referenceQuery,
}) {
  const phaseLabel = checkOut ? 'Check-out' : 'Check-in';
  return (
    <div className="space-y-4">
      <StepHeading step={2} title="Photos" headingRef={headingRef}>
        {checkOut
          ? 'Optional. Photograph the item as you leave it, from the same angles as at check-in.'
          : "Optional. Photograph the item as you found it, so damage that was already there isn't put down to you."}
      </StepHeading>
      {checkOut && <CheckInReference report={reference} query={referenceQuery} subject={subject} />}
      <PhotoUploader
        value={photos}
        onChange={onPhotos}
        label={`${phaseLabel} photos`}
        photoLabel={`${phaseLabel} photo`}
        subject={subject}
        error={error}
        onBusyChange={onBusyChange}
      />
    </div>
  );
}

/** ③ The overall condition (required), notes (optional) and a summary of what will be sent. */
export function ConditionStep({ prefix, overall, notes, errors, summary, photoCount, checkOut, dispatch, headingRef }) {
  const overallErrorId = `${prefix}-overall-error`;
  const notesId = `${prefix}-notes`;
  const notesHelpId = `${prefix}-notes-help`;
  const notesErrorId = `${prefix}-notes-error`;
  const notesLength = typeof notes === 'string' ? notes.trim().length : 0;
  return (
    <div className="space-y-5">
      <StepHeading step={3} title="Condition" headingRef={headingRef}>
        {checkOut
          ? 'How are you leaving it? This is compared with the check-in when the manager checks the return.'
          : 'How did you find it? This is the starting point the return is compared with.'}
      </StepHeading>

      <fieldset className="space-y-2" aria-describedby={errors.overall ? overallErrorId : undefined}>
        <legend className="text-sm font-bold mb-1">Overall condition</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {CONDITION_OVERALL.map((option) => {
            const optionId = `${prefix}-overall-${option.value}`;
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className={cn(tileClass, 'items-start py-3', 'has-[:checked]:bg-[#f0faf5] has-[:checked]:border-[#183d2d] has-[:checked]:shadow-[3px_3px_0_#183d2d]')}
              >
                <input
                  id={optionId}
                  type="radio"
                  name={`${prefix}-overall`}
                  value={option.value}
                  checked={overall === option.value}
                  onChange={() => dispatch({ type: 'overall', value: option.value })}
                  className="w-5 h-5 mt-0.5 shrink-0 accent-[#183d2d]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="block text-xs text-[#1a1a1a]/70">{OVERALL_HELP[option.value]}</span>
                </span>
              </label>
            );
          })}
        </div>
        <FieldError id={overallErrorId} alert>
          {errors.overall}
        </FieldError>
        {overall === 'good' && summary.notOk > 0 && (
          <p className="text-xs text-[#a04000]">
            You marked {summary.notOk} {summary.notOk === 1 ? 'item' : 'items'} as not OK. Check that
            &ldquo;Good condition&rdquo; is right.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={notesId} className="text-sm font-bold">
          Notes (optional)
        </label>
        <textarea
          id={notesId}
          value={notes}
          rows={4}
          maxLength={REPORT_NOTES_MAX}
          onChange={(event) => dispatch({ type: 'notes', value: event.target.value })}
          placeholder={checkOut ? 'e.g. Bed slightly scratched' : 'Anything the manager should know'}
          aria-invalid={errors.notes ? 'true' : undefined}
          aria-describedby={[notesHelpId, errors.notes && notesErrorId].filter(Boolean).join(' ')}
          className={textFieldClass(Boolean(errors.notes))}
        />
        <p id={notesHelpId} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
          <span>At most {REPORT_NOTES_MAX} characters.</span>
          <span aria-hidden="true" className="tabular-nums shrink-0">
            {notesLength}/{REPORT_NOTES_MAX}
          </span>
        </p>
        <FieldError id={notesErrorId} alert>
          {errors.notes}
        </FieldError>
      </div>

      <div className="rounded-lg border-2 border-[#1a1a1a]/30 bg-[#f5f0e8] p-3 text-xs space-y-1">
        <p className="font-bold uppercase tracking-wider">What will be sent</p>
        <p>
          Checklist:{' '}
          {summary.total === 0
            ? 'no items'
            : summary.notOk
              ? `${summary.total - summary.notOk} of ${summary.total} OK, ${summary.notOk} not OK`
              : `all ${summary.total} OK`}
        </p>
        <p>Photos: {photoCount ? `${photoCount} of 3` : 'none'}</p>
      </div>
    </div>
  );
}
