import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';

/**
 * Hacktoberfest-themed Input.
 * Pass `error` (string) to show the error state.
 * Pass `label` and `id` for accessible label binding.
 */
export const Input = forwardRef(function Input(
  { label, error, hint, id, className, containerClassName, ...props },
  ref
) {
  const inputId = id ?? `input-${Math.random().toString(36).slice(2)}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-bold font-mono text-[#1a1a1a] tracking-tight"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-describedby={
          [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined
        }
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'w-full px-4 py-2.5 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white',
          'font-mono placeholder:text-[#1a1a1a]/40 text-[#1a1a1a]',
          'focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
          'transition-colors',
          error && 'border-[#c0392b] bg-[#fff5f5]',
          className
        )}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-[#1a1a1a]/60">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
          <span aria-hidden="true">✕</span> {error}
        </p>
      )}
    </div>
  );
});

