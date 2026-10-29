import React, { useState } from 'react';
import { CalendarX2, Copy, Plus, Trash2 } from 'lucide-react';
import { fromIstInputValue } from '../../../lib/time';
import { ChoiceCards, FieldError, FormSection, IconButton, SmallButton } from './FormBits';
import {
  BLACKOUT_REASON_MAX,
  DAY_NAMES,
  SLOT_OPTIONS,
  WEEKDAYS,
  WEEK_ORDER,
  addBlackout,
  addWindow,
  copyDay,
  copyDayNotice,
  describeOpenHours,
  fieldDomId,
  removeBlackout,
  removeWindow,
  updateBlackout,
  updateWindow,
  windowsOfDay,
} from './listingForm';
import { hintClass, inputClass, labelClass } from './styles';
import { useFocusAfterRender } from './useFocusAfterRender';
import { useNow } from '../components/useNow';

// Availability (frontend.md §6.3; api.md "Listing form": availability): the weekly opening hours
// in IST with as many windows a day as the unit needs, one-off closures with a reason, and the slot
// length bookings snap to. Row paths are the server's ("availability.weekly.3.close"), so an error
// from either side lands on its row.

function WindowRow({ window: w, number, dayName, errors, onChange, onRemove }) {
  const base = `availability.weekly.${w.index}`;
  const openId = fieldDomId(`${base}.open`);
  const closeId = fieldDomId(`${base}.close`);
  const openError = errors[`${base}.open`];
  const closeError = errors[`${base}.close`];
  const rowError = errors[base];
  const context = `${dayName}, window ${number}`;
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={openId} className="text-xs font-bold">
            Opens<span className="sr-only"> ({context})</span>
          </label>
          <input
            id={openId}
            type="time"
            step={60}
            value={w.open}
            onChange={(event) => onChange({ open: event.target.value })}
            aria-invalid={openError || rowError ? 'true' : undefined}
            aria-describedby={openError ? `${openId}-error` : undefined}
            className={`${inputClass(openError || rowError)} w-[8.5rem]`}
          />
        </div>
        <span aria-hidden="true" className="pb-3 font-bold">
          –
        </span>
        <div className="flex flex-col gap-1">
          <label htmlFor={closeId} className="text-xs font-bold">
            Closes<span className="sr-only"> ({context})</span>
          </label>
          <input
            id={closeId}
            type="time"
            step={60}
            value={w.close}
            onChange={(event) => onChange({ close: event.target.value })}
            aria-invalid={closeError || rowError ? 'true' : undefined}
            aria-describedby={closeError ? `${closeId}-error` : undefined}
            className={`${inputClass(closeError || rowError)} w-[8.5rem]`}
          />
        </div>
        <IconButton icon={Trash2} tone="danger" label={`Remove ${context}`} onClick={onRemove} />
      </div>
      <FieldError id={`${openId}-error`} message={openError} />
      <FieldError id={`${closeId}-error`} message={closeError} />
      <FieldError id={`${fieldDomId(base)}-error`} message={rowError} />
    </li>
  );
}

function WeeklyHours({ weekly, errors, setWeekly }) {
  const focusLater = useFocusAfterRender();
  const listError = errors['availability.weekly'];
  const listId = fieldDomId('availability.weekly');
  const summary = describeOpenHours(weekly);

  const add = (day) => {
    const next = addWindow(weekly, day);
    const known = new Set(weekly.map((w) => w.key));
    const index = next.findIndex((w) => !known.has(w.key));
    setWeekly(next);
    if (index !== -1) focusLater(fieldDomId(`availability.weekly.${index}.open`));
  };
  const remove = (w) => {
    setWeekly(removeWindow(weekly, w.key));
    focusLater(`add-window-${w.day}`);
  };
  // Copying a closed Monday would close the other days: only offered once Monday has hours.
  const mondayOpen = windowsOfDay(weekly, 1).length > 0;
  // What the last copy did, said in a status line: { text, weekly } while the hours are still the
  // ones it made (any later change hides it).
  const [copied, setCopied] = useState(null);
  const copyMonday = (days, label) => {
    if (!mondayOpen) return;
    const next = copyDay(weekly, 1, days);
    setWeekly(next);
    setCopied({ text: copyDayNotice(weekly, 1, days, label), weekly: next });
  };

  return (
    <fieldset
      id={listId}
      tabIndex={-1}
      aria-describedby={[`${listId}-hint`, listError && `${listId}-error`].filter(Boolean).join(' ')}
      className="min-w-0 space-y-3 focus:outline-none"
    >
      <legend className={labelClass}>Opening hours (IST)</legend>
      <p id={`${listId}-hint`} className={hintClass}>
        Add several windows to a day for a break, e.g. 09:00–13:00 and 14:00–17:00. A day with no
        window is closed. Copying Monday replaces the hours of the days it copies to. Now:{' '}
        <span className="font-bold">{summary}</span>.
      </p>
      <div className="flex flex-wrap gap-2">
        <SmallButton aria-disabled={!mondayOpen || undefined} onClick={() => copyMonday(WEEKDAYS, 'Tuesday–Friday')}>
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          Copy Monday to Tuesday–Friday
        </SmallButton>
        <SmallButton aria-disabled={!mondayOpen || undefined} onClick={() => copyMonday(WEEK_ORDER, 'every day')}>
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          Copy Monday to every day
        </SmallButton>
      </div>
      <p role="status" className="text-xs font-bold text-[#183d2d]">
        {copied?.weekly === weekly ? copied.text : ''}
      </p>
      <FieldError id={`${listId}-error`} message={listError} />

      <ul className="divide-y-2 divide-[#1a1a1a]/10 border-2 border-[#1a1a1a]/20 rounded-lg">
        {WEEK_ORDER.map((day) => {
          const windows = windowsOfDay(weekly, day);
          const headingId = `weekly-day-${day}`;
          return (
            <li key={day} className="p-3">
              <div role="group" aria-labelledby={headingId} className="flex flex-col md:flex-row md:items-start gap-2 md:gap-4">
                <h4 id={headingId} className="text-sm font-black w-28 shrink-0 md:pt-2">
                  {DAY_NAMES[day]}
                </h4>
                <div className="flex-1 min-w-0 space-y-2">
                  {windows.length === 0 ? (
                    <p className="text-xs text-[#1a1a1a]/70 md:pt-3">Closed</p>
                  ) : (
                    <ol className="space-y-2" aria-label={`${DAY_NAMES[day]} opening windows`}>
                      {windows.map((w, n) => (
                        <WindowRow
                          key={w.key}
                          window={w}
                          number={n + 1}
                          dayName={DAY_NAMES[day]}
                          errors={errors}
                          onChange={(patch) => setWeekly(updateWindow(weekly, w.key, patch))}
                          onRemove={() => remove(w)}
                        />
                      ))}
                    </ol>
                  )}
                  <SmallButton id={`add-window-${day}`} onClick={() => add(day)}>
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    {windows.length ? 'Add another window' : 'Open this day'}
                    <span className="sr-only"> on {DAY_NAMES[day]}</span>
                  </SmallButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {summary === 'closed all week' && (
        <p className="text-xs font-bold text-[#a04000]">
          Closed all week: members can&apos;t book it until you add opening hours.
        </p>
      )}
    </fieldset>
  );
}

function Closures({ blackouts, errors, setBlackouts, now }) {
  const focusLater = useFocusAfterRender();
  const listId = fieldDomId('availability.blackouts');
  const listError = errors['availability.blackouts'];

  const add = () => {
    const next = addBlackout(blackouts);
    setBlackouts(next);
    focusLater(fieldDomId(`availability.blackouts.${next.length - 1}.start`));
  };
  const remove = (key) => {
    setBlackouts(removeBlackout(blackouts, key));
    focusLater('add-closure');
  };

  return (
    <fieldset
      id={listId}
      tabIndex={-1}
      aria-describedby={[`${listId}-hint`, listError && `${listId}-error`].filter(Boolean).join(' ')}
      className="min-w-0 space-y-3 focus:outline-none"
    >
      <legend className={labelClass}>Closures</legend>
      <p id={`${listId}-hint`} className={hintClass}>
        One-off times it can&apos;t be booked, inside the usual hours: holidays, servicing, exams. Dates
        and times are IST.
      </p>
      <FieldError id={`${listId}-error`} message={listError} />
      {blackouts.length === 0 ? (
        <p className="text-xs text-[#1a1a1a]/70 flex items-center gap-1.5">
          <CalendarX2 className="w-4 h-4" aria-hidden="true" />
          No closures planned.
        </p>
      ) : (
        <ol className="space-y-3">
          {blackouts.map((b, i) => {
            const base = `availability.blackouts.${i}`;
            const ids = {
              start: fieldDomId(`${base}.start`),
              end: fieldDomId(`${base}.end`),
              reason: fieldDomId(`${base}.reason`),
            };
            const err = {
              start: errors[`${base}.start`],
              end: errors[`${base}.end`],
              reason: errors[`${base}.reason`],
              row: errors[base],
            };
            const end = fromIstInputValue(b.end);
            const past = end && new Date(end).getTime() < now;
            const name = `Closure ${i + 1}`;
            return (
              <li key={b.key} className="p-3 rounded-lg border-2 border-[#1a1a1a]/20 space-y-2">
                <div role="group" aria-label={name} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-wider">
                      {name}
                      {past && <span className="ml-2 font-bold normal-case text-[#1a1a1a]/70">(already over)</span>}
                    </p>
                    <IconButton icon={Trash2} tone="danger" label={`Remove ${name}`} onClick={() => remove(b.key)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={ids.start} className="text-xs font-bold">
                        Starts (IST)
                      </label>
                      <input
                        id={ids.start}
                        type="datetime-local"
                        value={b.start}
                        onChange={(event) => setBlackouts(updateBlackout(blackouts, b.key, { start: event.target.value }))}
                        aria-invalid={err.start ? 'true' : undefined}
                        aria-describedby={err.start ? `${ids.start}-error` : undefined}
                        className={inputClass(err.start)}
                      />
                      <FieldError id={`${ids.start}-error`} message={err.start} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={ids.end} className="text-xs font-bold">
                        Ends (IST)
                      </label>
                      <input
                        id={ids.end}
                        type="datetime-local"
                        value={b.end}
                        onChange={(event) => setBlackouts(updateBlackout(blackouts, b.key, { end: event.target.value }))}
                        aria-invalid={err.end ? 'true' : undefined}
                        aria-describedby={err.end ? `${ids.end}-error` : undefined}
                        className={inputClass(err.end)}
                      />
                      <FieldError id={`${ids.end}-error`} message={err.end} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={ids.reason} className="text-xs font-bold">
                      Reason <span className="font-normal text-[#1a1a1a]/70">(optional, members see it)</span>
                    </label>
                    <input
                      id={ids.reason}
                      value={b.reason}
                      maxLength={BLACKOUT_REASON_MAX}
                      placeholder="Diwali holiday"
                      onChange={(event) => setBlackouts(updateBlackout(blackouts, b.key, { reason: event.target.value }))}
                      aria-invalid={err.reason ? 'true' : undefined}
                      aria-describedby={err.reason ? `${ids.reason}-error` : undefined}
                      className={inputClass(err.reason)}
                    />
                    <FieldError id={`${ids.reason}-error`} message={err.reason} />
                  </div>
                  <FieldError id={`${fieldDomId(base)}-error`} message={err.row} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <SmallButton id="add-closure" onClick={add}>
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Add a closure
      </SmallButton>
    </fieldset>
  );
}

export function AvailabilitySection({ form, update, errors, errorCount, changed }) {
  const now = useNow(60 * 1000);
  return (
    <FormSection
      id="section-availability"
      title="Availability"
      description="When it can be booked. Bookings have to fit the opening hours and avoid the closures."
      errorCount={errorCount}
      changed={changed}
    >
      <WeeklyHours
        weekly={form.weekly}
        errors={errors}
        setWeekly={(weekly) => update((f) => ({ ...f, weekly }))}
      />
      <Closures
        blackouts={form.blackouts}
        errors={errors}
        now={now}
        setBlackouts={(blackouts) => update((f) => ({ ...f, blackouts }))}
      />
      <ChoiceCards
        path="availability.slotMinutes"
        legend="Slot length"
        hint="Bookings start and end on these steps, e.g. 10:00, 10:30, 11:00 for 30 minutes."
        options={SLOT_OPTIONS}
        value={form.slotMinutes}
        onChange={(slotMinutes) => update((f) => ({ ...f, slotMinutes }))}
        error={errors['availability.slotMinutes']}
        columns={3}
      />
    </FormSection>
  );
}
