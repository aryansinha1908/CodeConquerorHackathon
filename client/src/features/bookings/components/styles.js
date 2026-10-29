import { cn } from '../../../lib/utils';

// A <Link> that looks like components/ui/Button: a <button> inside an <a> would be two nested
// controls for a screen reader (as in VerificationPage). At least 44 px tall: these are the
// check-in and check-out entry points, used on a phone next to the machine (frontend.md §10.3).

const base =
  'inline-flex items-center justify-center gap-2 font-bold font-mono tracking-tight border-2 border-[#1a1a1a] ' +
  'px-5 py-2.5 min-h-[44px] text-sm rounded-md transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2';

const raised =
  'shadow-[3px_3px_0px_0px_#1a1a1a] hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]';

const variants = {
  primary: `bg-[#c0392b] text-white ${raised}`,
  forest: `bg-[#183d2d] text-white ${raised}`,
  outline: `bg-white text-[#1a1a1a] ${raised}`,
};

export function linkButtonClass(variant = 'outline', className) {
  return cn(base, variants[variant] ?? variants.outline, className);
}

// A plain text link in the app's style.
export const textLinkClass =
  'font-bold text-[#183d2d] underline underline-offset-2 hover:text-[#c0392b] rounded ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-1';

// A heading that takes focus programmatically (tabIndex -1) shows no ring: it isn't a control.
export const pageHeadingClass = 'text-2xl font-black text-[#1a1a1a] tracking-tight break-words focus:outline-none';
export const sectionHeadingClass =
  'text-base md:text-lg font-bold font-mono tracking-tight text-[#1a1a1a] focus:outline-none';
export const eyebrowClass = 'text-xs uppercase font-bold text-[#c0392b] tracking-widest block mb-1';
