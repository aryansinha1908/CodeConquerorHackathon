import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../../lib/utils';

/** A plain explanation box: why a form isn't offered, or what happens next (frontend.md §1). */
export function Notice({ icon: Icon = Info, title, children, tone = 'neutral', className }) {
  const tones = {
    neutral: 'border-[#1a1a1a] bg-[#f5f0e8]',
    success: 'border-[#0b6e4f] bg-[#f0faf5]',
    warning: 'border-[#e67e22] bg-[#fef9f3]',
  };
  return (
    <div className={cn('p-4 rounded-lg border-2 text-sm flex items-start gap-3 font-mono text-[#1a1a1a]', tones[tone] ?? tones.neutral, className)}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-2 min-w-0">
        {title && <p className="font-bold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
