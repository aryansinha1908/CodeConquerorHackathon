import React from 'react';

const LABELS = ['Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
const COLORS = [
  'bg-[#e74c3c]',   // 1 — red
  'bg-[#e67e22]',   // 2 — orange
  'bg-[#f1c40f]',   // 3 — yellow
  'bg-[#27ae60]',   // 4 — green
  'bg-[#1abc9c]',   // 5 — teal
];

/**
 * Password strength bar.
 * strength: 0–4 (from lib/schemas/auth.js passwordStrength())
 */
export function PasswordStrengthBar({ strength }) {
  if (strength === 0) return null;
  const label = LABELS[strength - 1] ?? 'Unknown';
  const color = COLORS[strength - 1] ?? COLORS[0];

  return (
    <div className="flex flex-col gap-1" aria-live="polite" aria-label={`Password strength: ${label}`}>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={[
              'h-1.5 flex-1 rounded-full transition-all duration-300',
              i < strength ? color : 'bg-[#1a1a1a]/15',
            ].join(' ')}
          />
        ))}
      </div>
      <p className="text-xs font-mono font-semibold text-[#1a1a1a]/60">
        Strength: <span className="text-[#1a1a1a]">{label}</span>
      </p>
    </div>
  );
}

