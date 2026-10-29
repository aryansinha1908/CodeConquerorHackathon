import React, { forwardRef, useId } from 'react';
import { cn } from '../../../lib/utils';

/**
 * A labelled textarea with a character counter (frontend.md §10.3: a <label>, the hint and the error
 * linked with aria-describedby, the error announced). The counter counts the trimmed text, as the
 * server does; `maxLength` stops typing past the limit.
 */
export const TextAreaField = forwardRef(function TextAreaField(
  { label, value = '', onChange, error, hint, maxLength, required = false, rows = 4, className, ...props },
  ref
) {
  const ids = useId();
  const fieldId = `${ids}-field`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const length = typeof value === 'string' ? value.trim().length : 0;
  return (
    <div className={cn('flex flex-col gap-1 font-mono text-[#1a1a1a]', className)}>
      <label htmlFor={fieldId} className="text-sm font-bold tracking-tight">
        {label}
        {required ? '' : ' (optional)'}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        rows={rows}
        maxLength={maxLength}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, error && errorId].filter(Boolean).join(' ')}
        className={cn(
          'w-full px-4 py-2.5 text-sm rounded-lg border-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
          error ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
        )}
        {...props}
      />
      <p id={hintId} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
        <span>{hint}</span>
        {maxLength && (
          <span aria-hidden="true" className="shrink-0 tabular-nums">
            {length}/{maxLength}
          </span>
        )}
      </p>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
          <span aria-hidden="true">✕</span> {error}
        </p>
      )}
    </div>
  );
});
