import React from 'react';
import { cn } from '../../lib/utils';

// Magic UI's Marquee (magicui.design, MIT), in JavaScript and the app's styles: the children scroll
// sideways forever, repeated so the row never runs out. It pauses on hover, while something in it has
// focus, and while `paused` (the page's pause button). Under prefers-reduced-motion it doesn't move:
// the items wrap onto as many lines as they need, once. The copies are hidden from screen readers, so
// the content is read once.

export function Marquee({ children, reverse = false, repeat = 3, duration = '40s', gap = '1rem', paused = false, className, label }) {
  return (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      className={cn('group flex overflow-hidden motion-reduce:[mask-image:none]', className)}
      style={{ '--duration': duration, '--gap': gap, gap }}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          className={cn(
            'flex shrink-0 items-stretch justify-around gap-(--gap) animate-marquee',
            'motion-reduce:animate-none motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:justify-start motion-reduce:gap-y-2',
            i > 0 && 'motion-reduce:hidden',
            'group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]',
            paused && '[animation-play-state:paused]',
            reverse && '[animation-direction:reverse]'
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
