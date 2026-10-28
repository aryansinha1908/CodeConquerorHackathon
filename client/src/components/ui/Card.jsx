import React from 'react';
import { cn } from '../../lib/utils';

export function Card({
  children,
  className,
  variant = 'default',
  hover = false,
  ...props
}) {
  // Colours come only from the variant: cn() doesn't resolve conflicts, so a bg-*, text-* or
  // border-colour class in `className` competes with the variant's by stylesheet order (bg-white
  // beats every bg-[#…], so a tint passed that way renders white).
  const variants = {
    default: 'bg-white text-[#1a1a1a] border-[#1a1a1a]',
    cream: 'bg-[#ede8df] text-[#1a1a1a] border-[#1a1a1a]',
    forest: 'bg-[#183d2d] text-white border-white/40',
    dark: 'bg-[#1a1a1a] text-[#f5f0e8] border-[#f5f0e8]/30',
    // Status tints: a light background with the status colour as the border.
    success: 'bg-[#f0faf5] text-[#1a1a1a] border-[#183d2d]',
    warning: 'bg-[#fef9f3] text-[#1a1a1a] border-[#e67e22]',
    danger: 'bg-[#fff5f5] text-[#1a1a1a] border-[#c0392b]',
  };

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-6 font-mono transition-all duration-150',
        'shadow-[4px_4px_0px_0px_#1a1a1a]',
        hover && 'hover:shadow-[6px_6px_0px_0px_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px]',
        variants[variant] ?? variants.default,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...props }) {
  return (
    <div
      className={cn(
        'border-b-2 border-[#1a1a1a]/15 pb-4 mb-4 flex items-center justify-between gap-4',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className, ...props }) {
  return (
    <h3
      className={cn(
        'text-base md:text-lg font-bold font-mono tracking-tight text-[#1a1a1a]',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

