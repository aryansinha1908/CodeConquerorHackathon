import { useEffect, useState } from 'react';

// Small hooks of the resource pages. Kept out of the component files, which may export only
// components (fast refresh), and out of render: reading the clock during render is impure, so the
// clock is read in timer callbacks.

/** The current time in epoch ms, read again every `intervalMs` (default a minute; 0 = never). */
export function useNow(intervalMs = 60 * 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return undefined;
    const tick = () => setNow(Date.now());
    // Starting (or speeding up) the clock reads it straight away, not only after one interval.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

/**
 * Whole seconds left until `until` (epoch ms), counting down once a second and stopping at 0. 0
 * when `until` is null or past.
 */
export function useSecondsUntil(until) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return undefined;
    let timer = null;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= until && timer) clearInterval(timer);
    };
    const first = setTimeout(tick, 0);
    timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/**
 * `value` once it has stayed the same for `delay` ms. Pass a primitive (a string key), so an equal
 * value doesn't restart the wait.
 */
export function useDebouncedValue(value, delay = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
