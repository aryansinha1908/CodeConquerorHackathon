import React from 'react';
import { cn } from '../../lib/utils';

// Aceternity UI's Infinite Moving Cards (ui.aceternity.com), in JavaScript and the app's style: a
// row of cards drifting sideways, faded at both ends, pausing on hover, on focus inside and while
// `paused`. The second copy that makes the loop seamless is hidden from screen readers. Under
// prefers-reduced-motion nothing moves: the cards wrap into rows, once.

const SPEEDS = { fast: '30s', normal: '55s', slow: '90s' };

export function InfiniteMovingCards({ items, renderItem, getKey, direction = 'left', speed = 'normal', paused = false, className, label }) {
  const row = (copy) => (
    <ul
      aria-hidden={copy > 0 || undefined}
      className={cn(
        'flex w-max shrink-0 gap-4 pr-4 animate-marquee',
        'motion-reduce:animate-none motion-reduce:w-auto motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:pr-0',
        copy > 0 && 'motion-reduce:hidden',
        'group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]',
        paused && '[animation-play-state:paused]',
        direction === 'right' && '[animation-direction:reverse]'
      )}
    >
      {items.map((item) => (
        <li key={`${copy}-${getKey(item)}`} className="shrink-0">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        'group relative flex overflow-hidden',
        '[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] motion-reduce:[mask-image:none]',
        className
      )}
      style={{ '--duration': SPEEDS[speed] ?? SPEEDS.normal, '--gap': '0rem' }}
    >
      {row(0)}
      {row(1)}
    </div>
  );
}
