import React from 'react';
import { ChevronDown } from 'lucide-react';

// The account button's look, shared by the header's account menu (UserMenu, lazy-loaded with
// Headless UI) and its stand-in while that loads (AppLayout's UserMenuFallback). Kept out of
// UserMenu.jsx so the stand-in doesn't pull Headless UI into the first load.

// One class set per size: overriding w-8 or text-[11px] with another class on the same element would
// leave the winner to the stylesheet's order (cn() only joins strings).
const AVATAR_SIZES = {
  sm: 'w-8 h-8 text-[11px] rounded-md',
  md: 'w-10 h-10 text-sm rounded-md',
  lg: 'w-16 h-16 text-xl rounded-xl',
};

/** The avatar square with the user's initials. size: sm (header), md (menus), lg (/profile). */
export function Avatar({ initials, size = 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={`${AVATAR_SIZES[size] ?? AVATAR_SIZES.sm} shrink-0 border-2 border-[#1a1a1a] bg-[#c0392b] text-white font-black flex items-center justify-center`}
    >
      {initials}
    </span>
  );
}

/** The button's face, shared with the fallback so the swap doesn't shift the header. */
export function AccountButtonFace({ view }) {
  return (
    <>
      <Avatar initials={view.initials} />
      <span className="hidden sm:flex flex-col items-start min-w-0 text-left">
        <span className="text-xs font-bold truncate max-w-[140px] leading-tight">{view.name}</span>
        <span className="text-[10px] text-[#1a1a1a]/70 truncate max-w-[140px] leading-tight">{view.subtitle}</span>
      </span>
      <ChevronDown className="hidden sm:block w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    </>
  );
}

export const accountButtonClass =
  'flex items-center gap-2 p-1 sm:pr-2.5 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]';
