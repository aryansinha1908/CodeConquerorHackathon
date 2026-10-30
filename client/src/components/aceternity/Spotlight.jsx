import React, { useId } from 'react';
import { cn } from '../../lib/utils';

// Aceternity UI's Spotlight (ui.aceternity.com), in JavaScript: a wide, blurred beam of light that
// fades in across a dark section. Decorative. Under prefers-reduced-motion it is simply there.

export function Spotlight({ className, fill = 'white' }) {
  const id = `spotlight-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 3787 2842"
      fill="none"
      className={cn(
        'pointer-events-none absolute z-0 h-[169%] w-[138%] opacity-0 lg:w-[84%]',
        // Without the animation, its end state: in place and visible.
        'animate-spotlight motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:[transform:translate(-50%,-40%)]',
        className
      )}
    >
      <g filter={`url(#${id})`}>
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity="0.21"
        />
      </g>
      <defs>
        <filter id={id} x="0.86" y="0.84" width="3785.16" height="2840.26" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="blur" />
        </filter>
      </defs>
    </svg>
  );
}
