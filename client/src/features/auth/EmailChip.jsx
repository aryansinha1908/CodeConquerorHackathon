import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * The "Detected: UG · CSE · 2024" chip that appears under the email field
 * when the email matches the student roll-number pattern.
 */
export function EmailChip({ text }) {
  const isFaculty = text.startsWith('Faculty');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={text}
      className={[
        'inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full border-2 text-xs font-bold font-mono',
        'animate-[fadeSlideIn_0.2s_ease-out]',
        isFaculty
          ? 'bg-blue-50 border-blue-400 text-blue-800'
          : 'bg-[#183d2d] border-[#1a1a1a] text-white shadow-[2px_2px_0_#1a1a1a]',
      ].join(' ')}
    >
      <Sparkles size={12} aria-hidden="true" />
      {text}
    </div>
  );
}

