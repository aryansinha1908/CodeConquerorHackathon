import React from 'react';
import { Building2, Pause, Play } from 'lucide-react';
import { Marquee } from '../../components/magicui/Marquee';
import { NumberTicker } from '../../components/magicui/NumberTicker';
import { StaggerItem, StaggerList } from '../../components/Motion';
import { FACTS, UNIT_NAMES } from './homeContent';
import { useMotionPause } from './motionPause';

// Under the hero: the units on ShareX scrolling by (Magic UI's Marquee), with the page's pause button
// for everything that moves, then four facts that count up into view (Magic UI's NumberTicker). The
// facts are how ShareX works, not usage numbers.

export function UnitMarquee() {
  const { paused, setPaused } = useMotionPause();
  const Icon = paused ? Play : Pause;
  return (
    <div className="-mx-4 flex items-center gap-2 border-y-2 border-[#1a1a1a] bg-[#1a1a1a] py-1.5 pr-2 text-white sm:mx-0 sm:rounded-xl sm:border-2">
      <Marquee
        label="Units on ShareX"
        duration="55s"
        gap="2.5rem"
        paused={paused}
        className="min-w-0 flex-1 py-1.5 pl-4 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)] motion-reduce:pr-2"
      >
        {UNIT_NAMES.map((name) => (
          <span key={name} className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-bold uppercase tracking-widest">
            <Building2 className="h-3.5 w-3.5 text-[#f1c40f]" aria-hidden="true" />
            {name}
          </span>
        ))}
      </Marquee>
      {/* Nothing loops under reduced motion, so there is nothing to pause. */}
      <button
        type="button"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
        className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border-2 px-3 text-[11px] font-black uppercase tracking-wider transition-colors focus-visible:outline-[#f1c40f]! motion-reduce:hidden ${
          paused ? 'border-[#f1c40f] bg-[#f1c40f] text-[#1a1a1a]' : 'border-white/30 bg-white/10 text-white hover:bg-white/20'
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        Pause<span className="sr-only sm:not-sr-only"> animations</span>
      </button>
    </div>
  );
}

export function FactsSection() {
  return (
    <section aria-labelledby="facts-heading">
      <h2 id="facts-heading" className="sr-only">
        ShareX in numbers
      </h2>
      <StaggerList className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {FACTS.map((fact) => (
          <StaggerItem key={`${fact.value}-${fact.note}`}>
            <div className="h-full rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a]">
              <p className="text-4xl font-black tracking-tight sm:text-5xl" style={{ color: fact.color }}>
                <NumberTicker value={fact.value} />
              </p>
              <p className="mt-1 text-xs font-black uppercase tracking-wider">{fact.label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-[#1a1a1a]/70">{fact.note}</p>
            </div>
          </StaggerItem>
        ))}
      </StaggerList>
    </section>
  );
}
