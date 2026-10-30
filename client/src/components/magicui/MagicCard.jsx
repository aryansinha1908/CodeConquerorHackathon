import React from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { cn } from '../../lib/utils';

// Magic UI's MagicCard (magicui.design, MIT), in JavaScript and the app's style: a soft spotlight
// follows the pointer across the card. The light is decorative; the card is an ordinary box.

export function MagicCard({ children, className, gradientColor = 'rgba(241, 196, 15, 0.28)', gradientSize = 240 }) {
  const x = useMotionValue(-gradientSize);
  const y = useMotionValue(-gradientSize);
  const background = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${x}px ${y}px, ${gradientColor}, transparent 100%)`;
  return (
    <div
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        x.set(event.clientX - rect.left);
        y.set(event.clientY - rect.top);
      }}
      onPointerLeave={() => {
        x.set(-gradientSize);
        y.set(-gradientSize);
      }}
      className={cn('group relative overflow-hidden', className)}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
