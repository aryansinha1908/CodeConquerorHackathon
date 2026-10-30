import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, QrCode, Search, X } from 'lucide-react';
import { FadeUp } from '../../components/Motion';
import { Button } from '../../components/ui/Button';
import { Spotlight } from '../../components/aceternity/Spotlight';
import { MovingBorder } from '../../components/aceternity/MovingBorder';
import { TextGenerateEffect } from '../../components/aceternity/TextGenerateEffect';
import { GridPattern } from '../../components/magicui/GridPattern';
import { ShimmerLink } from '../../components/magicui/ShimmerLink';
import { WordRotate } from '../../components/magicui/WordRotate';
import { HERO_WORDS, QUICK_SEARCH_TAGS } from './homeContent';
import { useMotionPause } from './motionPause';

// The home page's hero: what ShareX is (a rotating word for what you can book), the search box (to
// Explore; a signed-out visitor is asked to log in first, then lands on the results), quick searches
// and the main call to action. Aceternity's Spotlight and Magic UI's grid behind it; on wide screens
// an example booking card shows what a member sees.

const tagClass =
  'inline-flex items-center px-3 py-1.5 min-h-[40px] rounded border border-white/25 bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1c40f]';

// An example of a booking as a member sees it: decorative, so hidden from screen readers.
function ExampleBooking() {
  const checks = ['Account verified', 'Badge: 3D Printing Basics', 'Inside opening hours'];
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0, y: 16, rotate: 2 }}
      animate={{ opacity: 1, y: 0, rotate: 2 }}
      transition={{ delay: 0.4, duration: 0.5 }}
      className="hidden lg:block"
    >
      <div className="rounded-xl border-2 border-[#1a1a1a] bg-[#f5f0e8] p-4 text-[#1a1a1a] shadow-[6px_6px_0_#1a1a1a] space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#c0392b]">Example booking</p>
            <p className="text-base font-black tracking-tight">FDM 3D Printer</p>
            <p className="text-[11px] text-[#1a1a1a]/70">Design and Innovation Centre · Tue 10:00–12:00</p>
          </div>
          <span className="rounded-md border-2 border-[#1a1a1a] bg-[#1e7e45] px-2 py-0.5 text-[10px] font-black uppercase text-white">
            Approved
          </span>
        </div>
        <ul className="space-y-1.5">
          {checks.map((check, i) => (
            <motion.li
              key={check}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8 + i * 0.25 }}
              className="flex items-center gap-2 text-xs"
            >
              <CheckCircle2 className="h-4 w-4 text-[#1e7e45]" />
              {check}
            </motion.li>
          ))}
        </ul>
        <div className="flex items-center gap-3 rounded-lg border-2 border-[#1a1a1a] bg-white p-2.5">
          <QrCode className="h-10 w-10 shrink-0" />
          <div>
            <p className="text-[11px] font-black">Pass for pickup</p>
            <p className="font-mono text-sm font-black tracking-[0.3em]">K7Q-2MX</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function HeroSection({ user }) {
  const navigate = useNavigate();
  const { paused } = useMotionPause();
  const [query, setQuery] = useState('');

  const search = (event) => {
    event.preventDefault();
    const text = query.trim();
    navigate(text ? `/explore?q=${encodeURIComponent(text)}` : '/explore');
  };
  const quick = (tag) =>
    navigate(tag.category ? `/explore?category=${encodeURIComponent(tag.category)}` : `/explore?q=${encodeURIComponent(tag.q)}`);

  return (
    <FadeUp
      as="section"
      aria-labelledby="home-hero-heading"
      className="relative isolate overflow-hidden rounded-2xl border-2 border-[#1a1a1a] bg-[#183d2d] p-6 text-white shadow-[6px_6px_0_#1a1a1a] sm:p-10"
    >
      <GridPattern className="text-white/[0.07]" />
      <Spotlight className="-top-40 left-0 md:-top-24 md:left-40" fill="#f1c40f" />

      <div className="relative z-10 grid items-center gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-white/30 bg-[#c0392b] px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_#1a1a1a] sm:text-xs">
              NIT Jamshedpur · Resource sharing
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/90">
              <span className={`h-2 w-2 rounded-full bg-[#1abc9c] ${paused ? '' : 'motion-safe:animate-pulse'}`} aria-hidden="true" />
              Live availability in IST
            </span>
          </div>

          <h1 id="home-hero-heading" className="text-3xl font-black leading-[1.08] tracking-tight sm:text-5xl">
            Book campus
            <br />
            <WordRotate words={HERO_WORDS} paused={paused} className="text-[#f1c40f]" />
            <br />
            in a few clicks.
          </h1>

          <TextGenerateEffect
            className="max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base"
            words="Departments and central facilities share their equipment, computing and rooms with verified students and faculty. Every request is checked against the resource's rules before you send it, and no slot is ever booked twice."
          />

          <MovingBorder paused={paused} className="max-w-2xl shadow-[3px_3px_0_#1a1a1a]" innerClassName="bg-[#183d2d]">
            <form onSubmit={search} role="search" aria-label="Search resources" className="flex flex-col gap-2 p-1.5 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1a1a1a]/60" aria-hidden="true" />
                <label htmlFor="home-search" className="sr-only">
                  What do you need?
                </label>
                <input
                  id="home-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="3D printer, oscilloscope, lathe…"
                  className="w-full rounded-lg border-2 border-[#1a1a1a] bg-white py-3 pl-10 pr-10 font-mono text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/50 focus:outline-none focus:ring-2 focus:ring-[#f1c40f] [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear the search"
                    className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[#1a1a1a]/60 hover:text-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <Button type="submit" variant="primary" size="md" className="min-h-[46px] shrink-0 px-6 text-sm">
                Find &amp; book
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </MovingBorder>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-bold text-white/70">Quick searches:</span>
            {QUICK_SEARCH_TAGS.map((tag) => (
              <button key={tag.label} type="button" onClick={() => quick(tag)} className={tagClass}>
                {tag.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {user ? (
              <ShimmerLink to="/explore" paused={paused}>
                Explore resources
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ShimmerLink>
            ) : (
              <ShimmerLink to="/register" paused={paused}>
                Create your account
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ShimmerLink>
            )}
            <Link
              to="/how-it-works"
              className="inline-flex min-h-[44px] items-center px-2 text-sm font-bold text-white underline underline-offset-4 hover:text-[#f1c40f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1c40f] rounded"
            >
              How it works
            </Link>
          </div>
        </div>

        <ExampleBooking />
      </div>
    </FadeUp>
  );
}
