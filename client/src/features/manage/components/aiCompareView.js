// The AI photo comparison's pure helpers (AiCompareCard.jsx), apart so the card's file exports
// components only.
import { errorMessage, isRetryable } from '../../../lib/errors';

/** The booking statuses the comparison is offered for: the item is back (or out and flagged). */
export const COMPARE_STATUSES = ['checked_out', 'completed', 'flagged'];

/** How many photos a condition report from the timeline has. */
export const photoCount = (report) =>
  Array.isArray(report?.photos) ? report.photos.filter((p) => typeof p?.publicId === 'string' && p.publicId).length : 0;

export const SEVERITY_VIEW = {
  none: { variant: 'slateLight', label: 'No change' },
  minor: { variant: 'amber', label: 'Minor' },
  major: { variant: 'red', label: 'Major' },
};

const DAILY = new Set(['USER_DAILY', 'POOL_DAILY', 'GLOBAL_DAILY']);

/**
 * Whether asking again can help: a network failure, a 429 or a 5xx (isRetryable), but not once
 * today's AI requests are used up. A 403 or 409 needs something to change first.
 */
export const canRetryCompare = (err) =>
  isRetryable(err) && !(err?.code === 'AI_QUOTA_EXCEEDED' && DAILY.has(err?.details?.reason));

/** The verdict badge: no verdict on photos Gemini couldn't compare. */
export function verdictView(comparison) {
  if (comparison?.comparable === false) return { variant: 'slate', label: "Couldn't compare", tone: 'unclear' };
  return comparison?.newDamageLikely
    ? { variant: 'red', label: 'Possible new damage', tone: 'damage' }
    : { variant: 'green', label: 'No new damage spotted', tone: 'clear' };
}

/**
 * A failed comparison → what to tell the manager. The server's AI messages are written for the
 * search ("Regular search still works"), so the quota and availability ones are said here.
 */
export function compareErrorText(err) {
  if (err?.code === 'AI_QUOTA_EXCEEDED') {
    const reason = err.details?.reason;
    if (DAILY.has(reason)) return 'Today’s AI requests are used up; they come back at midnight (IST). Compare the photos above yourself.';
    if (reason === 'BURST') return 'Wait a few seconds between AI requests, then try again.';
    return 'AI is busy right now. Try again in a minute, or compare the photos above yourself.';
  }
  if (err?.code === 'AI_UNAVAILABLE') {
    return /photos couldn't be loaded/i.test(err.message ?? '')
      ? err.message
      : 'AI can’t compare the photos right now. Compare them above yourself.';
  }
  return errorMessage(err);
}
