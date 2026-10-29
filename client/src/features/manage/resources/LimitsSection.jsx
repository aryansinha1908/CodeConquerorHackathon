import React from 'react';
import { formatDuration } from '../../../lib/time';
import { FormSection, TextField } from './FormBits';
import { LIMIT_FIELDS } from './listingForm';

// Limits (frontend.md §6.3; api.md "Listing form": limits): whole numbers, each optional. An empty
// box is "no limit". The minutes read back as hours and days so 240 is plainly 4 h.

function readBack(field, value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Empty: no limit.';
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) return null;
  if (field.unit === 'minutes') return `= ${formatDuration(n)}.`;
  if (field.unit === 'hours') return `= ${n} h a week.`;
  if (field.unit === 'days') return `= ${n} ${n === 1 ? 'day' : 'days'}.`;
  return `= at most ${n} at a time.`;
}

export function LimitsSection({ form, update, errors, errorCount, changed }) {
  const set = (key) => (value) => update((f) => ({ ...f, limits: { ...f.limits, [key]: value } }));
  return (
    <FormSection
      id="section-limits"
      title="Limits"
      description="Fair-use rules every booking is checked against. Leave a box empty for no limit."
      errorCount={errorCount}
      changed={changed}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {LIMIT_FIELDS.map((field) => {
          const value = form.limits[field.key];
          const back = readBack(field, value);
          return (
            <TextField
              key={field.key}
              path={`limits.${field.key}`}
              label={`${field.label} (${field.unit})`}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              step={1}
              value={value}
              onChange={set(field.key)}
              hint={back ? `${field.hint} ${back}` : field.hint}
              error={errors[`limits.${field.key}`]}
            />
          );
        })}
      </div>
    </FormSection>
  );
}
