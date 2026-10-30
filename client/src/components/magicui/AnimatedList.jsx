import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

// Magic UI's AnimatedList (magicui.design, MIT), in JavaScript: items arrive one at a time, the
// newest on top, like a stream of notifications; then the stream starts over. It runs only while on
// screen and not `paused`. Decorative (hidden from screen readers): the card around it says in words
// what it shows. Under prefers-reduced-motion every item shows at once and nothing moves.

export function AnimatedList({ items, renderItem, delay = 1800, paused = false, className }) {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: '0px 0px -20% 0px' });
  const reduce = useReducedMotion();
  const [count, setCount] = useState(1);

  useEffect(() => {
    if (!inView || reduce || paused) return undefined;
    const id = setInterval(() => setCount((c) => (c >= items.length ? 1 : c + 1)), delay);
    return () => clearInterval(id);
  }, [inView, reduce, paused, items.length, delay]);

  const shown = (reduce ? items : items.slice(0, count)).slice().reverse();
  return (
    <div ref={ref} aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      <AnimatePresence initial={false}>
        {shown.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, scale: 0.92, y: -14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 350, damping: 32 }}
          >
            {renderItem(item)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
