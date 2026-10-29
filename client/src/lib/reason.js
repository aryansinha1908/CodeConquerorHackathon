// The reason or note sent with a booking decision (api.md "Bookings"): reject and waitlist need a
// reason; cancel needs one from a manager or admin, not from the borrower; approve takes an optional
// note. Each is at most 500 characters after trimming, and blank text counts as not sent. A required
// reason is at least 10 characters (frontend.md §7 ReasonDialog, §9: "10–500 characters,
// required"), so "no" isn't one; an optional note has no minimum. The server checks the rest again.

export const REASON_MAX_LENGTH = 500;
export const REASON_MIN_LENGTH = 10;

/**
 * The textarea's text → { value, error }. `value` is the trimmed text ('' when blank and not
 * required); `error` is null or the message to show beside the field. `minLength` defaults to 10
 * for a required reason and 1 for an optional note.
 */
export function readReason(
  text,
  { required = true, minLength = required ? REASON_MIN_LENGTH : 1, maxLength = REASON_MAX_LENGTH } = {}
) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    return required ? { value, error: 'Give a reason.' } : { value, error: null };
  }
  if (value.length < minLength) {
    return { value, error: `Use at least ${minLength} characters.` };
  }
  if (value.length > maxLength) {
    return { value, error: `Use at most ${maxLength} characters (now ${value.length}).` };
  }
  return { value, error: null };
}
