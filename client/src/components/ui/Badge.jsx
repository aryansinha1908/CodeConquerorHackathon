import React from 'react';
import { cn } from '../../lib/utils';

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  className,
  icon: Icon,
  ...props
}) {
  // Every pair is at least 4.5:1 (frontend.md §10.3). White on amber (#e67e22) is 2.85:1 and on
  // the old steel blue (#2980b9) 4.3:1, so amber carries dark text and blue is a shade deeper.
  // The booking statuses (lib/bookingStatus.js, frontend.md §10.2) use green to overdue.
  const variants = {
    forest: 'bg-[#183d2d] text-white border-[#1a1a1a]',
    red: 'bg-[#c0392b] text-white border-[#1a1a1a]',
    amber: 'bg-[#e67e22] text-[#1a1a1a] border-[#1a1a1a]',
    gold: 'bg-[#f1c40f] text-[#1a1a1a] border-[#1a1a1a]',
    blue: 'bg-[#2471a3] text-white border-[#1a1a1a]',
    teal: 'bg-[#1abc9c] text-[#1a1a1a] border-[#1a1a1a]',
    violet: 'bg-[#8e44ad] text-white border-[#1a1a1a]',
    neutral: 'bg-[#ede8df] text-[#1a1a1a] border-[#1a1a1a]',
    dark: 'bg-[#1a1a1a] text-white border-[#1a1a1a]',
    outline: 'bg-transparent text-[#1a1a1a] border-[#1a1a1a]',
    green: 'bg-[#1e7e45] text-white border-[#1a1a1a]',
    emerald: 'bg-[#0b6e4f] text-white border-[#1a1a1a]',
    slate: 'bg-[#5d6d7e] text-white border-[#1a1a1a]',
    slateLight: 'bg-[#d5dbe1] text-[#1a1a1a] border-[#1a1a1a]',
    orange: 'bg-[#b9470b] text-white border-[#1a1a1a]',
    rose: 'bg-[#be185d] text-white border-[#1a1a1a]',
    overdue: 'bg-white text-[#c0392b] border-[#c0392b]',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-bold font-mono tracking-tight uppercase border-2 rounded-md',
        'shadow-[1.5px_1.5px_0px_0px_#1a1a1a] select-none',
        variants[variant] ?? variants.neutral,
        sizes[size] ?? sizes.md,
        className
      )}
      {...props}
    >
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}

