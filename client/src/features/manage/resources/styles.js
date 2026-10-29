import { cn } from '../../../lib/utils';

// Class strings the listing form's components share (kept out of the .jsx files, which export only
// components so fast refresh keeps working).

/** A text-like control: 44 px tall, red border and tint while it has an error. */
export const inputClass = (error) =>
  cn(
    'w-full px-3 py-2.5 text-sm rounded-lg border-2 bg-white font-mono text-[#1a1a1a] min-h-[44px]',
    'placeholder:text-[#1a1a1a]/40 focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
    error ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
  );

export const labelClass = 'text-sm font-bold tracking-tight text-[#1a1a1a]';
export const hintClass = 'text-xs text-[#1a1a1a]/70';

/** A text link in the app's forest green. */
export const textLinkClass =
  'font-bold underline underline-offset-2 text-[#183d2d] hover:text-[#c0392b] rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]';
