import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

// Magic UI's ShimmerButton (magicui.design, MIT), as a router link in the app's style: a band of light
// sweeps across it every few seconds. The sweep is decorative; it stops while `paused` and under
// prefers-reduced-motion. Its focus outline is yellow: the global red one doesn't show on the dark
// sections it sits in.

export function ShimmerLink({ to, children, className, paused = false, ...props }) {
  return (
    <Link
      to={to}
      className={cn(
        'group relative isolate inline-flex items-center justify-center gap-2 overflow-hidden',
        'px-5 py-2.5 min-h-[44px] rounded-md border-2 border-[#1a1a1a] bg-[#c0392b] text-white text-sm font-bold font-mono',
        'shadow-[3px_3px_0_#1a1a1a] transition-[box-shadow,translate] hover:shadow-[1px_1px_0_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
        'focus-visible:outline-[#f1c40f]! focus-visible:outline-offset-[3px]!',
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/3 bg-linear-to-r from-transparent via-white/45 to-transparent animate-shimmer-sweep motion-reduce:hidden',
          paused && 'hidden'
        )}
      />
      {children}
    </Link>
  );
}
