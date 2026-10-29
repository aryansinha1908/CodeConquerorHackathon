import React from 'react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export function EmptyState({
  icon: Icon,
  emoji = '📦',
  title = 'No records found',
  description = 'Try adjusting your search filters or check back later.',
  actionLabel,
  onAction,
  className,
}) {
  return (
    <div
      className={cn(
        'rounded-xl border-2 border-dashed border-[#1a1a1a]/40 bg-[#f5f0e8]/50 p-8 text-center font-mono',
        'flex flex-col items-center justify-center gap-3',
        className
      )}
    >
      <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[3px_3px_0_#1a1a1a] flex items-center justify-center text-2xl mb-1">
        {Icon ? <Icon className="w-6 h-6 text-[#1a1a1a]" /> : emoji}
      </div>
      <h4 className="text-base font-bold text-[#1a1a1a] tracking-tight">{title}</h4>
      <p className="text-xs text-[#1a1a1a]/70 max-w-sm leading-relaxed">{description}</p>
      {actionLabel && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAction}
          className="mt-2 text-xs min-h-[40px]"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

