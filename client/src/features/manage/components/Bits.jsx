import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '../../../components/ui/Skeleton';
import { cn } from '../../../lib/utils';

// Small pieces the three manager pages share.

// A <Link> styled as a Button: a <button> inside an <a> is two nested controls for a screen reader.
const LINK_BUTTON_VARIANTS = {
  forest: 'bg-[#183d2d] text-white shadow-[3px_3px_0_#1a1a1a]',
  primary: 'bg-[#c0392b] text-white shadow-[3px_3px_0_#1a1a1a]',
  outline: 'bg-white text-[#1a1a1a] shadow-[3px_3px_0_#1a1a1a]',
};

export function LinkButton({ to, variant = 'outline', className, children, ...props }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-md border-2 border-[#1a1a1a]',
        'text-sm font-bold font-mono tracking-tight transition-all',
        'hover:shadow-[1px_1px_0_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
        LINK_BUTTON_VARIANTS[variant] ?? LINK_BUTTON_VARIANTS.outline,
        className
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

/** One label/value pair of a <dl>. */
export function Field({ label, children, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/70">{label}</dt>
      <dd className="text-xs font-bold text-[#1a1a1a] break-words">{children}</dd>
    </div>
  );
}

/** A loading list: `rows` card-shaped placeholders and a line for screen readers. */
export function ListSkeleton({ label, rows = 2 }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, n) => (
        <div
          key={n}
          className="rounded-xl border-2 border-[#1a1a1a] p-4 bg-white shadow-[4px_4px_0_#1a1a1a] space-y-3"
        >
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-9 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A polite live region for "Approved …" style updates after a mutation (frontend.md §10.3). */
export function LiveRegion({ children }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {children}
    </p>
  );
}
