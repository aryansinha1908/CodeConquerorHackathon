import React from 'react';
import { motion } from 'framer-motion';
import { enter, fadeUp } from '../../lib/motion';

/**
 * AuthLayout — Hacktoberfest-themed split layout.
 *
 * Left panel: dark forest green with pixel-art geometric decorations.
 * Right panel: cream background with the form card.
 */
export function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row font-mono">
      {/* ── Skip to content ── */}
      <a href="#auth-form" className="skip-link">
        Skip to form
      </a>

      {/* ── LEFT: Brand panel ───────────────────────────────────────────────── */}
      <aside
        className="
          relative flex flex-col justify-between
          bg-[#183d2d] text-white overflow-hidden
          px-8 py-10 lg:w-2/5 lg:min-h-screen
          border-b-4 lg:border-b-0 lg:border-r-4 border-[#1a1a1a]
        "
        aria-hidden="true"
      >
        {/* Geometric pixel decorations — top-left */}
        <div className="absolute top-0 left-0 w-40 h-40 pointer-events-none select-none">
          <PixelBlock className="absolute top-4 left-4 w-6 h-6 bg-[#c0392b]" />
          <PixelBlock className="absolute top-4 left-12 w-6 h-6 bg-[#c0392b]" />
          <PixelBlock className="absolute top-4 left-20 w-6 h-6 bg-[#c0392b]" />
          <PixelBlock className="absolute top-12 left-4 w-6 h-6 bg-[#c0392b]" />
          <PixelBlock className="absolute top-12 left-12 w-6 h-6 bg-white/10" />
          <PixelBlock className="absolute top-20 left-4 w-6 h-6 bg-white/20" />
          <PixelBlock className="absolute top-20 left-12 w-6 h-6 bg-white/10" />
          <PixelBlock className="absolute top-28 left-4 w-6 h-6 bg-white/10" />
        </div>

        {/* Geometric pixel decorations — bottom-right */}
        <div className="absolute bottom-0 right-0 w-48 h-64 pointer-events-none select-none">
          <PixelBlock className="absolute bottom-16 right-4 w-8 h-24 bg-[#c0392b]" />
          <PixelBlock className="absolute bottom-8 right-14 w-8 h-32 bg-[#c0392b]" />
          <PixelBlock className="absolute bottom-4 right-24 w-8 h-16 bg-[#c0392b]/60" />
        </div>

        {/* Faint grid background */}
        <div className="absolute inset-0 hf-pixel-grid opacity-30 pointer-events-none" />

        {/* Logo / wordmark */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#c0392b] border-2 border-white/30 rounded-lg flex items-center justify-center font-bold text-lg">
              CC
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-white/60">NIT Jamshedpur</p>
              <p className="text-lg font-bold leading-tight">CampusCommons</p>
            </div>
          </div>
        </div>

        {/* Tagline */}
        <motion.div variants={fadeUp} {...enter} className="relative z-10 flex-1 flex flex-col justify-center py-8">
          <div className="flex gap-1.5 mb-6">
            <ColorDot color="bg-[#c0392b]" />
            <ColorDot color="bg-[#e67e22]" />
            <ColorDot color="bg-[#f1c40f]" />
          </div>
          <h2 className="text-3xl lg:text-4xl font-black leading-tight mb-4">
            Share resources,<br />
            <span className="text-[#c0392b]">build campus.</span>
          </h2>
          <p className="text-white/70 text-sm leading-relaxed max-w-xs">
            Book equipment, spaces and computing resources at NIT JSR —
            with fair-use limits and full accountability.
          </p>

          {/* Feature pills */}
          <ul className="mt-8 flex flex-col gap-2.5" aria-label="Key features">
            {[
              '✓ Verified NIT JSR members only',
              '✓ Explainable eligibility checks',
              '✓ Full booking audit trail',
              '✓ Fair weekly usage caps',
            ].map((f) => (
              <li
                key={f}
                className="text-xs font-bold text-white/80 flex items-center gap-2"
              >
                {f}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Footer */}
        <p className="relative z-10 text-xs text-white/40 mt-4">
          An independent prototype · Not affiliated with NIT JSR
        </p>
      </aside>

      {/* ── RIGHT: Form panel ───────────────────────────────────────────────── */}
      <main
        className="
          flex-1 flex items-center justify-center
          bg-[#f5f0e8]/85 px-4 py-12
        "
        id="auth-form"
      >
        <div className="w-full max-w-md">
          {/* Card */}
          <motion.div
            variants={fadeUp}
            {...enter}
            className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 shadow-[4px_4px_0px_0px_#1a1a1a]"
          >
            {/* Header */}
            <header className="mb-7">
              <h1 className="text-2xl font-black text-[#1a1a1a] leading-tight mb-1">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-[#1a1a1a]/60">{subtitle}</p>
              )}
            </header>

            {/* Slot for form content */}
            {children}
          </motion.div>

          {/* Bottom note */}
          <p className="text-center text-xs text-[#1a1a1a]/50 mt-4 font-mono">
            Only <span className="font-bold">@nitjsr.ac.in</span> emails are accepted
          </p>
        </div>
      </main>
    </div>
  );
}

function PixelBlock({ className }) {
  return <div className={['rounded-sm', className].join(' ')} />;
}

function ColorDot({ color }) {
  return <div className={['w-3 h-3 rounded-sm', color].join(' ')} />;
}

