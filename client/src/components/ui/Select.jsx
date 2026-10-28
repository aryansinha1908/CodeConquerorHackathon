import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

export const Select = forwardRef(function Select(
  { label, error, hint, id, options = [], className, containerClassName, children, ...props },
  ref
) {
  const selectId = id ?? `select-${Math.random().toString(36).slice(2)}`;
  const errorId = `${selectId}-error`;
  const hintId = `${selectId}-hint`;

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-bold font-mono text-[#1a1a1a] tracking-tight"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-describedby={
            [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined
          }
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            'w-full appearance-none px-4 py-2.5 pr-10 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white',
            'font-mono text-[#1a1a1a] cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
            'transition-colors',
            error && 'border-[#c0392b] bg-[#fff5f5]',
            className
          )}
          {...props}
        >
          {children
            ? children
            : options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[#1a1a1a]">
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-[#1a1a1a]/60 font-mono">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-[#c0392b] flex items-center gap-1 font-mono">
          <span aria-hidden="true">✕</span> {error}
        </p>
      )}
    </div>
  );
});

