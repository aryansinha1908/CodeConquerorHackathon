import React, { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

// Magic UI's NumberTicker (magicui.design, MIT), in JavaScript: counts up to `value` the first time
// it scrolls into view. The markup holds the final number (what a screen reader reads, and what
// shows without JavaScript or with reduced motion); only the visible copy counts.

export function NumberTicker({ value, duration = 1.6, className }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduce = useReducedMotion();
  const final = Number(value).toLocaleString('en-IN');

  useEffect(() => {
    if (!inView || reduce || !ref.current) return undefined;
    const controls = animate(0, Number(value), {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        if (ref.current) ref.current.textContent = Math.round(latest).toLocaleString('en-IN');
      },
    });
    return () => controls.stop();
  }, [inView, reduce, value, duration]);

  return (
    <span className={cn('tabular-nums', className)}>
      <span ref={ref} aria-hidden="true">
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
