import React from 'react';
import { cn } from '../../lib/utils';
import { MagicCard } from './MagicCard';

// Magic UI's BentoGrid and BentoCard (magicui.design, MIT), in JavaScript and the app's style: a
// grid of feature cards of different widths, each with a small visual at the top. Cards carry
// MagicCard's pointer spotlight.

export function BentoGrid({ children, className }) {
  return <div className={cn('grid w-full grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3', className)}>{children}</div>;
}

export function BentoCard({ icon: Icon, title, description, visual, accent = '#183d2d', className, headingLevel = 'h3' }) {
  const Heading = headingLevel;
  return (
    <MagicCard
      className={cn(
        'flex flex-col rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a] transition-shadow hover:shadow-[6px_6px_0_#1a1a1a]',
        className
      )}
    >
      <div className="flex h-full flex-col">
        {visual && (
          <div className="relative h-44 overflow-hidden border-b-2 border-[#1a1a1a] bg-[#f5f0e8]">{visual}</div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-5">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-[#1a1a1a] text-white"
                style={{ backgroundColor: accent }}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <Heading className="text-sm font-black tracking-tight">{title}</Heading>
          </div>
          <p className="text-xs leading-relaxed text-[#1a1a1a]/80">{description}</p>
        </div>
      </div>
    </MagicCard>
  );
}
