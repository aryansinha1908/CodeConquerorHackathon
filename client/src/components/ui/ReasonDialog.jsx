import React, { useId, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { ErrorState } from './ErrorState';
import { fieldErrorsFrom } from '../../lib/errors';
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH, readReason } from '../../lib/reason';

/**
 * The form inside ReasonDialog; exported for the tests and for pages that show it inline.
 * onSubmit(value) gets the trimmed text ('' when it is optional and left blank). A required reason
 * is 10–500 characters (frontend.md §7) unless `minLength` says otherwise; an optional note has no
 * minimum.
 */
export function ReasonForm({
  label = 'Reason',
  hint,
  required = true,
  minLength = required ? REASON_MIN_LENGTH : 1,
  maxLength = REASON_MAX_LENGTH,
  templates = [],
  initialValue = '',
  submitLabel = 'Submit',
  pendingLabel,
  variant = 'primary',
  pending = false,
  error = null,
  errorTitle = "That didn't go through",
  onSubmit,
  onCancel,
}) {
  const ids = useId();
  const textareaRef = useRef(null);
  const [text, setText] = useState(initialValue);
  const [localError, setLocalError] = useState(null);

  // The server names the field `reason` (reject, waitlist, cancel) or `note` (approve).
  const serverFields = fieldErrorsFrom(error);
  const serverFieldError = serverFields.reason ?? serverFields.note ?? null;
  const fieldError = localError ?? serverFieldError;
  const fieldId = `${ids}-reason`;
  const helpId = `${ids}-reason-help`;
  const errorId = `${ids}-reason-error`;
  const length = text.trim().length;
  const help =
    hint ??
    (required
      ? `Required, ${minLength}–${maxLength} characters. The member sees it.`
      : `Optional, at most ${maxLength} characters.`);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (pending) return;
    const { value, error: problem } = readReason(text, { required, minLength, maxLength });
    setLocalError(problem);
    if (problem) {
      textareaRef.current?.focus();
      return;
    }
    onSubmit?.(value);
  };

  const pick = (template) => {
    setText(template);
    setLocalError(null);
    textareaRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-sm font-bold tracking-tight">
          {label}
          {required ? '' : ' (optional)'}
        </label>
        {templates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1" role="group" aria-label="Common reasons">
            {templates.map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => pick(template)}
                className="text-[11px] text-left px-2 py-1.5 min-h-[32px] rounded-md border-2 border-[#1a1a1a]/40 bg-white hover:border-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
              >
                {template}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          id={fieldId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (localError) setLocalError(null);
          }}
          rows={4}
          maxLength={maxLength}
          required={required}
          aria-required={required || undefined}
          aria-invalid={fieldError ? 'true' : undefined}
          aria-describedby={[helpId, fieldError && errorId].filter(Boolean).join(' ')}
          data-autofocus
          className={`w-full px-4 py-2.5 text-sm rounded-lg border-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1 ${
            fieldError ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
          }`}
        />
        <p id={helpId} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
          <span>{help}</span>
          <span aria-hidden="true" className="shrink-0 tabular-nums">
            {length}/{maxLength}
          </span>
        </p>
        {fieldError && (
          <p
            id={errorId}
            role="alert"
            className="text-xs font-semibold text-[#c0392b] flex items-center gap-1"
          >
            <span aria-hidden="true">✕</span> {fieldError}
          </p>
        )}
      </div>

      {!serverFieldError && <ErrorState error={error} title={errorTitle} />}

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#1a1a1a]/15">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={pending}>
          Go back
        </Button>
        <Button type="submit" variant={variant} size="lg" loading={pending}>
          {pending ? (pendingLabel ?? submitLabel) : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Asks for the reason behind reject, waitlist or cancel (frontend.md §7; api.md "Bookings": reason
 * required unless `required={false}`, 10–500 characters). Pass the mutation's state as
 * `pending` and `error`: a VALIDATION_ERROR on `reason`/`note` shows beside the field, anything
 * else above the buttons. The dialog can't be closed while pending; close it yourself on success.
 * `templates` are quick picks the user can edit. Other props as in Dialog and ReasonForm.
 */
export function ReasonDialog({
  open,
  onClose,
  title,
  eyebrow,
  description,
  returnFocusRef,
  ...formProps
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={formProps.pending}
      title={title}
      eyebrow={eyebrow}
      description={description}
      returnFocusRef={returnFocusRef}
    >
      {/* Mounted only while open, so each opening starts from an empty field. */}
      {open && <ReasonForm {...formProps} onCancel={onClose} />}
    </Dialog>
  );
}
