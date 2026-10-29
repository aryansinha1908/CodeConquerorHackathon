import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { fieldDomId, problemsText } from './listingForm';
import { hintClass, inputClass, labelClass } from './styles';

// The listing form's building blocks. Every control's id comes from fieldDomId(path), the path the
// schema and the server name it by, so the error summary links to it and focus can be sent there.
// Errors are linked with aria-describedby; they are announced once, by the summary, not per field.

const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined;

/** The message under a control (not an alert: the summary announces the errors). */
export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-semibold text-[#c0392b] flex items-start gap-1">
      <span aria-hidden="true">✕</span>
      <span>{message}</span>
    </p>
  );
}

/** One of the form's sections: a landmark with an h3, and "2 problems" on it while it has errors. */
export function FormSection({ id, title, description, errorCount = 0, changed = false, children }) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-4 rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a] space-y-5"
    >
      <div className="border-b-2 border-[#1a1a1a]/15 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} tabIndex={-1} className="text-lg font-black tracking-tight focus:outline-none">
            {title}
          </h3>
          {errorCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase px-2 py-0.5 rounded-md border-2 border-[#c0392b] text-[#a93226] bg-[#fff5f5]">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              {problemsText(errorCount)}
            </span>
          )}
          {changed && (
            <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-md border-2 border-[#1a1a1a] bg-[#fdf3c4]">
              Changed
            </span>
          )}
        </div>
        {description && <p className={cn(hintClass, 'mt-1 leading-relaxed max-w-2xl')}>{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A labelled text (or number, time, …) input for one field path. */
export function TextField({ path, label, hint, error, value, onChange, required = false, className, ...props }) {
  const id = fieldDomId(path);
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  return (
    <div className={cn('flex flex-col gap-1 min-w-0', className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required ? '' : <span className="font-normal text-[#1a1a1a]/70"> (optional)</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(hintId, errorId)}
        className={inputClass(error)}
        {...props}
      />
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** A labelled textarea with a character counter. */
export function TextAreaField({ path, label, hint, error, value, onChange, maxLength, rows = 4, required = false }) {
  const id = fieldDomId(path);
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : null;
  const length = String(value ?? '').trim().length;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className={labelClass}>
        {label}
        {required ? '' : <span className="font-normal text-[#1a1a1a]/70"> (optional)</span>}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        className={inputClass(error)}
      />
      <p id={hintId} className={cn(hintClass, 'flex justify-between gap-2')}>
        <span>{hint}</span>
        <span className="shrink-0 tabular-nums">
          {length}/{maxLength}
          <span className="sr-only"> characters</span>
        </span>
      </p>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/**
 * Radio choices as cards ({ value, label, description }) in a fieldset; the fieldset carries the
 * path's id so the summary can send focus to it, and the checked radio is the one to tab to.
 */
export function ChoiceCards({ path, legend, hint, error, options, value, onChange, columns = 2, name }) {
  const id = fieldDomId(path);
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={describedBy(hintId, errorId)}
      aria-invalid={error ? 'true' : undefined}
      className="min-w-0 space-y-2 focus:outline-none"
    >
      <legend className={labelClass}>{legend}</legend>
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      <div className={cn('grid grid-cols-1 gap-2', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                'flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer min-h-[44px]',
                'has-[:checked]:bg-[#f0faf5] has-[:checked]:border-[#183d2d] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#c0392b]',
                error ? 'border-[#c0392b]' : 'border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
              )}
            >
              <input
                id={optionId}
                type="radio"
                name={name ?? id}
                value={String(option.value)}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="mt-1 w-4 h-4 accent-[#183d2d] shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold">{option.label}</span>
                {option.description && (
                  <span className="block text-xs text-[#1a1a1a]/70 leading-snug">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

/** A tick box with its label (and an optional second line). */
export function Checkbox({ id, checked, onChange, label, detail, describedBy: extra }) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-2 p-2 rounded-lg border-2 border-transparent hover:border-[#1a1a1a]/30 cursor-pointer min-h-[44px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#c0392b]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={extra}
        className="mt-0.5 w-4 h-4 accent-[#183d2d] shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold break-words">{label}</span>
        {detail && <span className="block text-xs text-[#1a1a1a]/70 leading-snug break-words">{detail}</span>}
      </span>
    </label>
  );
}

/** A small secondary button for list editing (add, copy, move, remove). */
export function SmallButton({ className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-md border-2 border-[#1a1a1a] bg-white',
        'text-xs font-bold font-mono hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-1',
        'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** A square icon-only button; `label` is its accessible name. */
export function IconButton({ label, icon: Icon, className, tone = 'default', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-md border-2 border-[#1a1a1a] bg-white',
        'hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-1',
        'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed',
        tone === 'danger' && 'text-[#a93226]',
        className
      )}
      {...props}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}
