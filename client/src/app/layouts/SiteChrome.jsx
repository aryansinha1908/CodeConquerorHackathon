import React from 'react';
import { Link } from 'react-router-dom';

// The brand and the footer, shared by the app's layout and the public one (the landing page at `/`
// for signed-out visitors), so the two look the same.

/** "SX · NIT Jamshedpur · ShareX", linking to the landing page. */
export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 group shrink-0">
      <div className="w-9 h-9 bg-[#c0392b] border-2 border-[#1a1a1a] rounded-lg shadow-[2px_2px_0_#1a1a1a] flex items-center justify-center font-black text-white text-base transition-transform group-hover:-translate-y-0.5">
        SX
      </div>
      <div className="hidden sm:block">
        <span className="text-xs tracking-widest text-[#1a1a1a]/60 uppercase block leading-none">NIT Jamshedpur</span>
        <span className="text-base font-black text-[#1a1a1a] tracking-tight block">ShareX</span>
      </div>
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-[#1a1a1a] bg-[#183d2d] text-white py-6 mt-12">
      <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#1abc9c] animate-pulse inline-block" />
          <span className="tracking-widest uppercase font-bold text-white/90">SHAREX // NIT JAMSHEDPUR</span>
        </div>
        <div className="text-white/60 text-center md:text-right">
          <Link
            to="/how-it-works"
            className="font-bold text-white underline hover:text-[#f1c40f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-sm"
          >
            HOW IT WORKS
          </Link>
          <span className="mx-2 text-white/30">|</span>
          <span>UNITS: DIC · CENTRAL WORKSHOP · CSE LABS · MECH LABS</span>
          <span className="mx-2 text-white/30">|</span>
          <span className="text-[#f1c40f]">IST TIME ENGINE</span>
        </div>
      </div>
    </footer>
  );
}
