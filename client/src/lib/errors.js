// Helpers for lib/http.js's normalised error { status, code, message, details, retryAfter,
// requestId } (frontend.md §8.3; api.md "Error codes").

/**
 * A VALIDATION_ERROR's details [{ path, message }] → { [path]: message } for the form fields
 * (frontend.md §8.3). The first message for a path wins. Paths are as the server sends them:
 * 'reason', 'items.2.note', 'photos.0'. Anything else → {}.
 */
export function fieldErrorsFrom(err) {
  if (err?.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return {};
  const fields = {};
  for (const detail of err.details) {
    const path = typeof detail?.path === 'string' ? detail.path : null;
    if (path && !(path in fields)) fields[path] = String(detail.message ?? 'Invalid value.');
  }
  return fields;
}

/** Whether a network failure (no response at all) caused the error. */
export function isNetworkError(err) {
  return Boolean(err) && (err.status === 0 || err.status == null) && err.code === 'UNKNOWN';
}

/**
 * The sentence to show for an error: the server's message (written for the user), a plain
 * sentence for a network failure, and the wait for a 429.
 */
export function errorMessage(err) {
  if (!err) return '';
  if (isNetworkError(err)) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  const base = err.message || 'Something went wrong.';
  if (err.code === 'RATE_LIMITED' && err.retryAfter) {
    return `${base} Try again in ${err.retryAfter} s.`;
  }
  return base;
}

/** A toast line (frontend.md §8.3): "Something went wrong. (ref a1b2c3)". */
export function errorToastText(err) {
  const text = errorMessage(err) || 'Something went wrong.';
  return err?.requestId ? `${text} (ref ${err.requestId})` : text;
}

/** Whether asking again may work: a network failure, a 429, or a 5xx. A 4xx needs a change first. */
export function isRetryable(err) {
  if (!err) return false;
  if (isNetworkError(err)) return true;
  return err.status === 429 || err.status >= 500;
}

/**
 * React Query `retry` for reads: once more for a network failure or a 5xx, never for a 4xx (a
 * 404 or 403 won't change by asking again, and the page should say so at once).
 */
export function retryReads(failureCount, err) {
  return failureCount < 1 && isRetryable(err) && err?.status !== 429;
}
