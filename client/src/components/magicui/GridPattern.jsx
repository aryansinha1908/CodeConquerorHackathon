import React, { useId } from 'react';
import { cn } from '../../lib/utils';

// Magic UI's GridPattern (magicui.design, MIT), in JavaScript: a fine square grid drawn with an SVG
// pattern, in `currentColor`, behind a section. Decorative only.

export function GridPattern({ size = 32, className }) {
  // useId gives characters a url(#…) reference can't hold.
  const id = `grid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg aria-hidden="true" className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}>
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M.5 ${size}V.5H${size}`} fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
