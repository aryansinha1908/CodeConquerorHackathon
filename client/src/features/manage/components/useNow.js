import { useEffect, useState } from 'react';

/**
 * The current time in epoch milliseconds, refreshed every `intervalMs` (default 30 s, the manage
 * lists' poll), so "starts in 20 min" and the overdue highlight move on without a reload. Render
 * stays pure: the clock is read in state, never during render.
 */
export function useNow(intervalMs = 30 * 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
