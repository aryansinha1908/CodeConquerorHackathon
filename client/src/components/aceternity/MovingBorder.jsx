import React from 'react';
import { cn } from '../../lib/utils';

// Aceternity UI's Moving Border (ui.aceternity.com), in JavaScript and the app's colours: a short
// band of colour runs round the edge of whatever it wraps. A spinning conic gradient behind the
// content shows only in the gap around it. It stops while `paused`, and under prefers-reduced-motion.

export function MovingBorder({ children, className, innerClassName, duration = '6s', paused = false }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl p-[3px]', className)} style={{ '--duration': duration }}>
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[260%] -translate-x-1/2 -translate-y-1/2">
        <div
          className={cn(
            'h-full w-full animate-border-spin motion-reduce:animate-none',
            'bg-[conic-gradient(from_0deg,transparent_0deg,#f1c40f_30deg,#c0392b_70deg,transparent_110deg,transparent_360deg)]',
            paused && '[animation-play-state:paused]'
          )}
        />
      </div>
      <div className={cn('relative rounded-[10px]', innerClassName)}>{children}</div>
    </div>
  );
}
