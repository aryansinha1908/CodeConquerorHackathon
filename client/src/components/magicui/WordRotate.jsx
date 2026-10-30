import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

// Magic UI's WordRotate (magicui.design, MIT), in JavaScript: one word at a time, each sliding in
// over the last. Every word sits invisibly in the same grid cell, so the space is always that of the
// widest one and nothing around it moves. It turns only while on screen and not `paused`; under
// prefers-reduced-motion the first word simply stays. Screen readers get the whole list once.

export function WordRotate({ words, interval = 2400, paused = false, className }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce || paused || !inView || words.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [reduce, paused, inView, words.length, interval]);

  return (
    <span ref={ref} className={cn('relative inline-grid', className)}>
      <span className="sr-only">{words.join(', ')}</span>
      {words.map((word) => (
        <span key={word} aria-hidden="true" className="invisible col-start-1 row-start-1">
          {word}
        </span>
      ))}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={words[index]}
          aria-hidden="true"
          className="col-start-1 row-start-1"
          initial={{ opacity: 0, y: '-35%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '35%' }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
