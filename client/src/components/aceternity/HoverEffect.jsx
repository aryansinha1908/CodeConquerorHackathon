import React, { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';

// Aceternity UI's Card Hover Effect (ui.aceternity.com), in JavaScript and the app's style: a
// coloured block slides behind whichever card the pointer (or keyboard focus) is on. renderItem
// draws each card; the block is decorative.

export function HoverEffect({ items, renderItem, getKey, className }) {
  const layoutId = `hover-${useId()}`;
  const [active, setActive] = useState(null);
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {items.map((item, index) => (
        <div
          key={getKey(item)}
          className="relative block h-full w-full p-2"
          onMouseEnter={() => setActive(index)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(index)}
          onBlur={() => setActive(null)}
        >
          <AnimatePresence>
            {active === index && (
              <motion.span
                aria-hidden="true"
                layoutId={layoutId}
                className="absolute inset-0 block rounded-2xl border-2 border-[#1a1a1a] bg-[#f1c40f]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.15 } }}
              />
            )}
          </AnimatePresence>
          <div className="relative z-10 h-full">{renderItem(item)}</div>
        </div>
      ))}
    </div>
  );
}
