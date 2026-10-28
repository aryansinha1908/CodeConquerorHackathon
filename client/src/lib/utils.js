/** Simple className merger (no clsx dep needed for this project) */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/** Format seconds as MM:SS */
export function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

