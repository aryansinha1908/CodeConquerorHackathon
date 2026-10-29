import React, { forwardRef, useId } from 'react';
import { cn } from '../../../lib/utils';

/**
 * A required single choice as native radios in a fieldset (frontend.md §10.3: a legend, arrow keys
 * between options, the error announced and linked with aria-describedby). Each option is a large
 * card: { value, label, description?, disabled?, note? }. A disabled option stays readable and says
 * why in `note`. The ref goes to the first enabled radio, to move focus there on a failed submit.
 */
export const ChoiceGroup = forwardRef(function ChoiceGroup(
  { legend, name, options = [], value, onChange, error, hint, columns = 2, disabled = false, className },
  ref
) {
  const ids = useId();
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const grid = columns === 3 ? 'sm:grid-cols-3' : columns === 1 ? '' : 'sm:grid-cols-2';

  return (
    <fieldset className={cn('min-w-0 space-y-2 font-mono text-[#1a1a1a]', className)} aria-describedby={describedBy}>
      <legend className="text-sm font-bold tracking-tight">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-xs text-[#1a1a1a]/70 -mt-1">
          {hint}
        </p>
      )}
      <div className={cn('grid grid-cols-1 gap-2', grid)}>
        {options.map((option, index) => {
          const id = `${ids}-${option.value}`;
          const checked = value === option.value;
          const off = disabled || option.disabled;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'relative flex items-start gap-3 rounded-lg border-2 p-3 min-h-[44px] cursor-pointer transition-colors',
                'focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2',
                checked ? 'border-[#1a1a1a] bg-[#ede8df] shadow-[2px_2px_0_#1a1a1a]' : 'border-[#1a1a1a]/40 bg-white hover:border-[#1a1a1a]',
                error && !checked && 'border-[#c0392b]',
                off && 'opacity-60 cursor-not-allowed hover:border-[#1a1a1a]/40'
              )}
            >
              <input
                ref={index === firstEnabled ? ref : undefined}
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={off}
                onChange={() => onChange?.(option.value)}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={[describedBy, option.description && `${id}-desc`].filter(Boolean).join(' ') || undefined}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#183d2d]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold">{option.label}</span>
                {option.description && (
                  <span id={`${id}-desc`} className="block text-xs text-[#1a1a1a]/70 leading-relaxed">
                    {option.description}
                  </span>
                )}
                {off && option.note && <span className="block text-xs text-[#a04000] mt-0.5">{option.note}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
          <span aria-hidden="true">✕</span> {error}
        </p>
      )}
    </fieldset>
  );
});
