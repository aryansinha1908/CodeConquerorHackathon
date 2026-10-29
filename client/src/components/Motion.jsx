import React from 'react';
import { motion } from 'framer-motion';
import { enter, fadeUp, stagger } from '../lib/motion';

// Lists whose items come in one after another (lib/motion.js). Drop-in replacements for <ul>/<ol>
// and <li>: every other prop (className, aria-*, role, ref) passes through. A StaggerItem only
// animates inside a StaggerList, which drives it; items added later (a new page of results) enter
// with the same rise.

export function StaggerList({ as = 'ul', step = 0.05, delay = 0, children, ...props }) {
  const Component = as === 'ol' ? motion.ol : as === 'div' ? motion.div : motion.ul;
  return (
    <Component variants={stagger(step, delay)} {...enter} {...props}>
      {children}
    </Component>
  );
}

export function StaggerItem({ as = 'li', children, ...props }) {
  const Component = as === 'div' ? motion.div : as === 'section' ? motion.section : motion.li;
  return (
    <Component variants={fadeUp} {...props}>
      {children}
    </Component>
  );
}

/** A block that rises in on mount: a page section, a card. */
export function FadeUp({ as = 'div', delay = 0, children, ...props }) {
  const Component = as === 'section' ? motion.section : motion.div;
  return (
    <Component
      initial="hidden"
      animate="show"
      variants={{
        hidden: fadeUp.hidden,
        show: { ...fadeUp.show, transition: { ...fadeUp.show.transition, delay } },
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
