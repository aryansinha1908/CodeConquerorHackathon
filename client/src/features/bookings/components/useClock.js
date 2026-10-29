import { useEffect, useState } from 'react';
import { toDate } from '../../../lib/time';

// Time for the booking pages: "starts in 2 h" stays true while the page is open, and a page waiting
// for the check-in window asks the server again once it opens (allowedActions is computed at fetch).

const MAX_WAIT = 24 * 60 * 60 * 1000;

/** The current time in ms, updated every `intervalMs` (default 30 s). */
export function useNow(intervalMs = 30 * 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Calls `refetch` just after `at` (an instant within the next 24 h); nothing for null or the past. */
export function useRefetchAt(at, refetch) {
  const time = toDate(at)?.getTime() ?? null;
  useEffect(() => {
    if (time == null) return undefined;
    const wait = time - Date.now();
    if (wait <= 0 || wait > MAX_WAIT) return undefined;
    const timer = setTimeout(() => refetch?.(), wait + 1000);
    return () => clearTimeout(timer);
  }, [time, refetch]);
}
