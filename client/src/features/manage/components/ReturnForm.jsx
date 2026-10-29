import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, CheckCircle2, ClipboardCopy, XCircle } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Select } from '../../../components/ui/Select';
import { PhotoUploader } from '../../../components/PhotoUploader';
import { cn } from '../../../lib/utils';
import {
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  ITEM_NOTE_MAX,
  REPORT_NOTES_MAX,
} from '../../bookings/api';
import {
  emptyChecks,
  firstErrorField,
  returnErrorsFrom,
  returnInput,
  validateReturn,
} from './manageView';

// The manager's side of POST /bookings/:id/confirm-return (api.md "Bookings"; frontend.md §6.3):
// their own checklist, an optional note and photos, then "All good" (outcome ok: the booking
// completes) or "Report issue" (outcome issue with an incident: the booking is flagged until the
// incident is resolved). Every rule is checked here first and again by the server, whose field
// errors land beside the same fields.

const SEVERITY_HINTS = {
  low: 'Cosmetic or minor; still usable.',
  medium: 'Needs attention or a repair soon.',
  high: 'Unsafe or unusable. Only an admin can resolve it.',
};

const textareaClass = (invalid) =>
  cn(
    'w-full px-4 py-2.5 text-sm rounded-lg border-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
    invalid ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
  );

function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
      <span aria-hidden="true">✕</span> {children}
    </p>
  );
}

// An OK / Not OK pair of radios, styled as two toggles of at least 44 px.
function Toggle({ name, value, checked, onChange, tone, icon: Icon, children, field, describedBy }) {
  return (
    <label
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] rounded-md border-2 text-sm font-bold cursor-pointer',
        'focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2 transition-colors',
        checked ? `${tone} text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]` : 'bg-white border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
        data-field={field}
        aria-describedby={describedBy}
      />
      <Icon className="w-4 h-4" aria-hidden="true" />
      {children}
    </label>
  );
}

/**
 * Props:
 * - `checklist`: the resource's checklist labels (GET /bookings/:id resource.checklist).
 * - `checkOut`: the borrower's check-out report, to copy their answers as a starting point.
 * - `subject`: the resource title, for the photos' alt text.
 * - `pending` / `pendingOutcome`: the confirm-return request is running (and for which outcome).
 * - `error`: its normalised error; field errors show beside the fields, the rest above the buttons.
 * - `onSubmit(input)`: the useConfirmReturn variables without the id.
 * - `initialIssueOpen`: start with the incident fields shown.
 */
export function ReturnForm({
  checklist,
  checkOut,
  subject,
  pending = false,
  pendingOutcome,
  error,
  onSubmit,
  initialIssueOpen = false,
}) {
  const ids = useId();
  const formRef = useRef(null);
  const issueButtonRef = useRef(null);
  const focusRef = useRef(null); // a data-field to focus after the next render

  const [checks, setChecks] = useState(() => emptyChecks(checklist));
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [issueOpen, setIssueOpen] = useState(initialIssueOpen);
  const [incident, setIncident] = useState({ type: '', severity: '', description: '' });
  const [errors, setErrors] = useState({});
  const [hold, setHold] = useState('');
  // Server field errors the user has edited since: hidden until the next answer.
  const [edited, setEdited] = useState({ error: null, keys: [] });

  const server = returnErrorsFrom(error);
  const editedKeys = edited.error === error ? edited.keys : [];
  const serverFields = Object.fromEntries(
    Object.entries(server.fields).filter(([key]) => !editedKeys.includes(key))
  );
  const fieldErrors = { ...serverFields, ...errors };
  const errorCount = Object.keys(fieldErrors).length;
  const hasServerFields = Object.keys(server.fields).length > 0;
  const checklistChanged = Array.isArray(error?.details) && error.details.some((d) => d?.path === 'items');

  // After each render: focus the field asked for (the first with an error, the incident type), or,
  // when a new server answer has field errors, the first of those.
  const seenError = useRef(error);
  useEffect(() => {
    let key = focusRef.current;
    focusRef.current = null;
    if (error !== seenError.current) {
      seenError.current = error;
      key = key ?? firstErrorField(returnErrorsFrom(error).fields, checks.length);
    }
    if (key) formRef.current?.querySelector(`[data-field="${key}"]`)?.focus();
  });

  const clear = (key) => {
    if (errors[key] || errors.outcome) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        delete next.outcome;
        return next;
      });
    }
    if (server.fields[key]) {
      setEdited((current) => ({
        error,
        keys: [...(current.error === error ? current.keys : []), key],
      }));
    }
  };

  const setCheck = (index, patch) => {
    setChecks((current) => current.map((check, i) => (i === index ? { ...check, ...patch } : check)));
    clear(`items.${index}`);
    if ('note' in patch || patch.ok === true) clear(`items.${index}.note`);
  };

  const markAllOk = () => {
    setChecks((current) => current.map((check) => ({ ...check, ok: true })));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !/^items\.\d+$/.test(key)))
    );
  };

  // The borrower's check-out answers for the same labels, as a starting point to correct.
  const checkOutItems = Array.isArray(checkOut?.items) ? checkOut.items : [];
  const canCopy = checks.some((check) => checkOutItems.some((item) => item?.label === check.label));
  const copyCheckOut = () => {
    setChecks((current) =>
      current.map((check) => {
        const theirs = checkOutItems.find((item) => item?.label === check.label);
        return theirs
          ? { ...check, ok: theirs.ok === true, note: typeof theirs.note === 'string' ? theirs.note : '' }
          : check;
      })
    );
    setErrors({});
  };

  const answered = checks.filter((check) => check.ok === true || check.ok === false).length;

  const submit = (outcome) => {
    if (pending) return;
    if (photosBusy) {
      setHold('Wait for the photos to finish uploading, then try again.');
      return;
    }
    setHold('');
    const found = validateReturn({ outcome, checks, note, incident });
    setErrors(found);
    const first = firstErrorField(found, checks.length);
    if (first) {
      focusRef.current = first;
      return;
    }
    onSubmit?.(returnInput({ outcome, checks, photos, note, incident }));
  };

  const toggleIssue = () => {
    if (issueOpen) {
      setIssueOpen(false);
      return;
    }
    setIssueOpen(true);
    focusRef.current = 'incident.type';
  };
  const closeIssue = () => {
    setIssueOpen(false);
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('incident.')))
    );
    issueButtonRef.current?.focus();
  };

  const busy = pending || photosBusy;
  const noteId = `${ids}-note`;
  const descriptionId = `${ids}-description`;
  const issueId = `${ids}-issue`;
  const summaryId = `${ids}-summary`;
  const descriptionLength = incident.description.trim().length;

  return (
    <form
      ref={formRef}
      noValidate
      // Enter in a text field must not confirm a return: only the two buttons decide.
      onSubmit={(event) => event.preventDefault()}
      className="space-y-6"
      aria-describedby={errorCount ? summaryId : undefined}
    >
      {/* One announcement for the whole form; each field shows its own line too. */}
      <div role="alert" id={summaryId}>
        {errorCount > 0 && (
          <p className="p-3 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] text-sm font-bold text-[#c0392b] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {errorCount === 1 ? 'One thing to fix before you confirm.' : `${errorCount} things to fix before you confirm.`}
              {hasServerFields && error?.requestId && (
                <span className="block mt-0.5 text-xs font-normal text-[#1a1a1a]/70 break-all">
                  ref: {error.requestId}
                </span>
              )}
            </span>
          </p>
        )}
      </div>

      {/* ── The manager's checklist ── */}
      <fieldset className="space-y-3 min-w-0">
        <legend className="text-base font-black tracking-tight">Your checklist</legend>
        <p className="text-xs text-[#1a1a1a]/70 -mt-1">
          {checks.length
            ? `Inspect each item yourself. ${answered} of ${checks.length} answered; a "not OK" needs a note.`
            : 'This resource has no checklist. Add a note or photos if something needs recording.'}
        </p>
        {checks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="bg-white min-h-[44px]" onClick={markAllOk}>
              <CheckCheck className="w-4 h-4" aria-hidden="true" />
              Mark all OK
            </Button>
            {canCopy && (
              <Button type="button" variant="outline" size="sm" className="bg-white min-h-[44px]" onClick={copyCheckOut}>
                <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
                Start from the check-out answers
              </Button>
            )}
          </div>
        )}
        <ol className="space-y-3">
          {checks.map((check, index) => {
            const itemError = fieldErrors[`items.${index}`];
            const noteError = fieldErrors[`items.${index}.note`];
            const errorId = `${ids}-item-${index}-error`;
            const itemNoteId = `${ids}-item-${index}-note`;
            const itemNoteErrorId = `${ids}-item-${index}-note-error`;
            return (
              <li
                key={check.label}
                className={cn(
                  'rounded-lg border-2 p-3 space-y-2',
                  itemError || noteError ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]/30 bg-white'
                )}
              >
                <fieldset className="min-w-0">
                  <legend className="text-sm font-bold break-words mb-2">{check.label}</legend>
                  <div className="flex gap-2 max-w-sm">
                    <Toggle
                      name={`${ids}-item-${index}`}
                      value="ok"
                      checked={check.ok === true}
                      onChange={() => setCheck(index, { ok: true })}
                      tone="bg-[#1e7e45]"
                      icon={CheckCircle2}
                      field={`items.${index}`}
                      describedBy={itemError ? errorId : undefined}
                    >
                      OK
                    </Toggle>
                    <Toggle
                      name={`${ids}-item-${index}`}
                      value="not_ok"
                      checked={check.ok === false}
                      onChange={() => setCheck(index, { ok: false })}
                      tone="bg-[#c0392b]"
                      icon={XCircle}
                      describedBy={itemError ? errorId : undefined}
                    >
                      Not OK
                    </Toggle>
                  </div>
                  <FieldError id={errorId}>{itemError}</FieldError>
                </fieldset>
                {(check.ok === false || noteError) && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor={itemNoteId} className="text-xs font-bold">
                      What&apos;s wrong with it?
                    </label>
                    <input
                      id={itemNoteId}
                      type="text"
                      value={check.note}
                      maxLength={ITEM_NOTE_MAX}
                      onChange={(event) => setCheck(index, { note: event.target.value })}
                      data-field={`items.${index}.note`}
                      aria-invalid={noteError ? 'true' : undefined}
                      aria-describedby={noteError ? itemNoteErrorId : undefined}
                      aria-required="true"
                      className={cn(
                        'w-full px-3 py-2 min-h-[44px] text-sm rounded-lg border-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
                        noteError ? 'border-[#c0392b]' : 'border-[#1a1a1a]'
                      )}
                    />
                    <FieldError id={itemNoteErrorId}>{noteError}</FieldError>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {server.other.length > 0 && (
          <ul className="text-xs font-semibold text-[#c0392b] space-y-0.5">
            {server.other.map((message) => (
              <li key={message}>✕ {message}</li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* ── Note and photos ── */}
      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-sm font-bold tracking-tight">
          Return note (optional)
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            clear('note');
          }}
          rows={3}
          maxLength={REPORT_NOTES_MAX}
          data-field="note"
          aria-invalid={fieldErrors.note ? 'true' : undefined}
          aria-describedby={[`${noteId}-help`, fieldErrors.note && `${noteId}-error`].filter(Boolean).join(' ')}
          className={textareaClass(Boolean(fieldErrors.note))}
        />
        <p id={`${noteId}-help`} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
          <span>Kept in the booking&apos;s history with your decision.</span>
          <span aria-hidden="true" className="shrink-0 tabular-nums">
            {note.trim().length}/{REPORT_NOTES_MAX}
          </span>
        </p>
        <FieldError id={`${noteId}-error`}>{fieldErrors.note}</FieldError>
      </div>

      <div data-field="photos" tabIndex={-1} className="focus:outline-none">
        <PhotoUploader
          value={photos}
          onChange={(next) => {
            setPhotos(next);
            clear('photos');
          }}
          onBusyChange={setPhotosBusy}
          label="Return photos"
          hint="Up to 3 photos. They're saved with your return check, and added to the incident if you report one."
          photoLabel="Return photo"
          subject={subject}
          error={fieldErrors.photos}
          disabled={pending}
        />
      </div>

      {/* ── Decision ── */}
      <div className="space-y-3 pt-4 border-t-2 border-[#1a1a1a]/15">
        <h4 className="text-base font-black tracking-tight">Your decision</h4>
        <FieldError id={`${ids}-outcome-error`}>{fieldErrors.outcome}</FieldError>
        <p className="text-sm font-semibold text-[#a04000]" role="status">
          {hold}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            type="button"
            variant="forest"
            size="lg"
            data-field="outcome"
            loading={pending && pendingOutcome === 'ok'}
            aria-disabled={busy || undefined}
            aria-describedby={fieldErrors.outcome ? `${ids}-outcome-error` : undefined}
            onClick={() => submit('ok')}
          >
            {!(pending && pendingOutcome === 'ok') && <CheckCircle2 className="w-5 h-5" aria-hidden="true" />}
            {pending && pendingOutcome === 'ok' ? 'Confirming…' : 'All good'}
          </Button>
          <Button
            ref={issueButtonRef}
            type="button"
            variant={issueOpen ? 'danger' : 'outline'}
            size="lg"
            className={issueOpen ? '' : 'bg-white'}
            aria-expanded={issueOpen}
            aria-controls={issueId}
            aria-disabled={pending || undefined}
            onClick={toggleIssue}
          >
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            Report issue
          </Button>
        </div>
        <p className="text-xs text-[#1a1a1a]/70">
          &ldquo;All good&rdquo; completes the booking. &ldquo;Report issue&rdquo; opens an incident and flags
          the booking until the incident is resolved.
        </p>

        <div id={issueId} hidden={!issueOpen}>
          {issueOpen && (
            <fieldset className="mt-2 space-y-4 rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] p-4 min-w-0">
              <legend className="px-1 text-sm font-black tracking-tight text-[#c0392b]">The issue</legend>
              <Select
                id={`${ids}-type`}
                label="What kind of issue?"
                value={incident.type}
                onChange={(event) => {
                  setIncident((current) => ({ ...current, type: event.target.value }));
                  clear('incident.type');
                }}
                error={fieldErrors['incident.type']}
                data-field="incident.type"
                aria-required="true"
              >
                <option value="" disabled>
                  Choose a type
                </option>
                {INCIDENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>

              <fieldset className="min-w-0" aria-describedby={fieldErrors['incident.severity'] ? `${ids}-severity-error` : undefined}>
                <legend className="text-sm font-bold tracking-tight mb-2">How serious is it?</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {INCIDENT_SEVERITIES.map((severity, index) => {
                    const checked = incident.severity === severity.value;
                    return (
                      <label
                        key={severity.value}
                        className={cn(
                          'flex flex-col gap-0.5 px-3 py-2 min-h-[44px] rounded-md border-2 cursor-pointer text-sm',
                          'focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2',
                          checked ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]' : 'bg-white border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                        )}
                      >
                        <input
                          type="radio"
                          name={`${ids}-severity`}
                          value={severity.value}
                          checked={checked}
                          onChange={() => {
                            setIncident((current) => ({ ...current, severity: severity.value }));
                            clear('incident.severity');
                          }}
                          className="sr-only"
                          data-field={index === 0 ? 'incident.severity' : undefined}
                        />
                        <span className="font-bold">{severity.label}</span>
                        <span className={cn('text-xs', checked ? 'text-white/85' : 'text-[#1a1a1a]/70')}>
                          {SEVERITY_HINTS[severity.value]}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FieldError id={`${ids}-severity-error`}>{fieldErrors['incident.severity']}</FieldError>
              </fieldset>

              <div className="flex flex-col gap-1">
                <label htmlFor={descriptionId} className="text-sm font-bold tracking-tight">
                  What happened?
                </label>
                <textarea
                  id={descriptionId}
                  value={incident.description}
                  onChange={(event) => {
                    const value = event.target.value;
                    setIncident((current) => ({ ...current, description: value }));
                    clear('incident.description');
                  }}
                  rows={4}
                  maxLength={INCIDENT_DESCRIPTION_MAX}
                  data-field="incident.description"
                  aria-required="true"
                  aria-invalid={fieldErrors['incident.description'] ? 'true' : undefined}
                  aria-describedby={[
                    `${descriptionId}-help`,
                    fieldErrors['incident.description'] && `${descriptionId}-error`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  className={textareaClass(Boolean(fieldErrors['incident.description']))}
                />
                <p id={`${descriptionId}-help`} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
                  <span>
                    {INCIDENT_DESCRIPTION_MIN}–{INCIDENT_DESCRIPTION_MAX} characters. The borrower and the
                    unit&apos;s managers see it.
                  </span>
                  <span aria-hidden="true" className="shrink-0 tabular-nums">
                    {descriptionLength}/{INCIDENT_DESCRIPTION_MAX}
                  </span>
                </p>
                <FieldError id={`${descriptionId}-error`}>{fieldErrors['incident.description']}</FieldError>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#c0392b]/30">
                <Button type="button" variant="ghost" size="lg" onClick={closeIssue} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="lg"
                  loading={pending && pendingOutcome === 'issue'}
                  aria-disabled={busy || undefined}
                  onClick={() => submit('issue')}
                >
                  {pending && pendingOutcome === 'issue' ? 'Reporting…' : 'Report the issue'}
                </Button>
              </div>
            </fieldset>
          )}
        </div>
      </div>

      {!hasServerFields && (
        <ErrorState error={error} title="The return wasn't confirmed">
          {checklistChanged
            ? 'The checklist may have changed meanwhile: reload the page to get the current one.'
            : null}
        </ErrorState>
      )}
    </form>
  );
}
