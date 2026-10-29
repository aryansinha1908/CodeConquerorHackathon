import React, { forwardRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { focusById, focusPathFor } from './focus';
import { fieldDomId, problemsText } from './listingForm';

// The listing form's error summary: every problem, from the client's checks or the server's 400
// details, in form order, each a link that moves focus to its control. It takes focus after a
// refused submit, which is when it is read. It is a named region, not a live one: its messages
// follow every keystroke ("now 1"), and a live summary would be read out again on each change.

export const ErrorSummary = forwardRef(function ErrorSummary({ items, other = [], action = 'saving' }, ref) {
  const count = items.length + other.length;
  if (!count) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-labelledby="listing-error-summary-heading"
      className="p-4 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
    >
      <h3 id="listing-error-summary-heading" className="font-black text-[#a93226] flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        Fix {problemsText(count)} before {action}
      </h3>
      <ul className="mt-2 space-y-1 list-disc pl-5">
        {items.map((item) => {
          const target = fieldDomId(focusPathFor(item.path));
          return (
            <li key={item.path}>
              <a
                href={`#${target}`}
                onClick={(event) => {
                  if (focusById(target)) event.preventDefault();
                }}
                className="underline underline-offset-2 text-[#1a1a1a] hover:text-[#a93226] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] rounded-sm"
              >
                <span className="font-bold">{item.label}:</span> {item.message}
              </a>
            </li>
          );
        })}
        {other.map((item) => (
          <li key={`${item.path}:${item.message}`}>
            <span className="font-bold">{item.path}:</span> {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
});
