import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { snapshotSummary } from './manageView';

/**
 * A booking's eligibilitySnapshot [{ rule, passed, message }]: the 12 rules as they stood when the
 * request was made (or promoted). Collapsed to one line when every hard rule passed; open when one
 * failed. A taken slot (AVAILABILITY, the only soft rule) is a waitlist, not a failure.
 */
export function EligibilitySnapshot({ snapshot, className }) {
  const summary = snapshotSummary(snapshot);
  if (!summary.total) {
    return (
      <p className={cn('text-xs text-[#1a1a1a]/70', className)}>No eligibility check was recorded.</p>
    );
  }
  const allHardPassed = summary.hardFailed.length === 0;
  return (
    <details className={cn('group text-xs', className)} open={!allHardPassed}>
      <summary className="cursor-pointer py-1 font-bold flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]">
        {allHardPassed ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1e7e45]" aria-hidden="true" />
        ) : (
          <XCircle className="w-4 h-4 shrink-0 text-[#c0392b]" aria-hidden="true" />
        )}
        <span>
          Eligibility when requested: {summary.passed} of {summary.total} rules passed
          {summary.hardFailed.length > 0 &&
            ` · ${summary.hardFailed.length} failed`}
          {summary.slotTaken && ' · slot was taken'}
        </span>
      </summary>
      <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {summary.items.map((item, index) => {
          const Icon = item.passed ? CheckCircle2 : item.soft ? AlertTriangle : XCircle;
          const tone = item.passed ? 'text-[#1e7e45]' : item.soft ? 'text-[#a04000]' : 'text-[#c0392b]';
          const state = item.passed ? 'Passed' : item.soft ? 'Taken' : 'Failed';
          return (
            <li key={`${item.rule}-${index}`} className="flex gap-1.5 min-w-0">
              <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', tone)} aria-hidden="true" />
              <span className="min-w-0 break-words">
                <span className="font-bold">
                  <span className="sr-only">{state}: </span>
                  {item.label}
                </span>
                {item.message && <span className="text-[#1a1a1a]/70"> · {item.message}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
