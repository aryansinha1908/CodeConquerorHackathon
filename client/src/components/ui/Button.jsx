import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Hacktoberfest-themed Button.
 *
 * variant: 'primary' | 'outline' | 'ghost' | 'danger'
 * size:    'sm' | 'md' | 'lg'
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  loading,
  ...props
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-bold font-mono tracking-tight ' +
    'border-2 border-[#1a1a1a] transition-all duration-150 ' +
    'active:translate-x-[2px] active:translate-y-[2px] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2';

  const variants = {
    primary:
      'bg-[#c0392b] text-white shadow-[3px_3px_0px_0px_#1a1a1a] hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
    outline:
      'bg-transparent text-[#1a1a1a] shadow-[3px_3px_0px_0px_#1a1a1a] hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
    ghost:
      'bg-transparent text-[#1a1a1a] border-transparent shadow-none hover:bg-[#1a1a1a]/10',
    danger:
      'bg-[#e74c3c] text-white shadow-[3px_3px_0px_0px_#1a1a1a] hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
    forest:
      'bg-[#183d2d] text-white shadow-[3px_3px_0px_0px_#1a1a1a] hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-md',
    md: 'px-5 py-2.5 text-sm rounded-md',
    lg: 'px-7 py-3.5 text-base rounded-md min-h-[44px]',
  };

  return (
    <button
      className={cn(base, variants[variant] ?? variants.primary, sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}

