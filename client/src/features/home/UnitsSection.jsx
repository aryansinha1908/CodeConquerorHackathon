import React from 'react';
import { Link } from 'react-router-dom';
import { MagicCard } from '../../components/magicui/MagicCard';
import { InfiniteMovingCards } from '../../components/aceternity/InfiniteMovingCards';
import { StaggerItem, StaggerList } from '../../components/Motion';
import { UNITS, USE_CASES } from './homeContent';
import { useMotionPause } from './motionPause';

// Some of the units on ShareX and what they lend (Magic UI's pointer spotlight on each card), then
// what people book things for, drifting by (Aceternity's infinite moving cards).

export function UnitsSection() {
  return (
    <section aria-labelledby="facilities-heading" className="space-y-4">
      <div className="flex flex-col justify-between gap-2 border-b-2 border-[#1a1a1a]/15 pb-2 sm:flex-row sm:items-baseline">
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-[#b9470b]">Departments and central facilities</span>
          <h2 id="facilities-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
            Participating NIT Jamshedpur units
          </h2>
        </div>
        <span className="text-xs text-[#1a1a1a]/70">Each unit sets its own rules · one login for all</span>
      </div>
      <StaggerList className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {UNITS.map((unit) => (
          <StaggerItem key={unit.code}>
            <MagicCard className="h-full rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df]/70 shadow-[4px_4px_0_#1a1a1a]">
              <div className="flex h-full flex-col justify-between gap-3 p-5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded border border-[#1a1a1a] bg-white px-2 py-0.5 text-xs font-black text-[#183d2d]">{unit.code}</span>
                    <span className="rounded border border-[#1a1a1a]/30 bg-white/80 px-2 py-0.5 text-[10px] font-bold">{unit.badge}</span>
                  </div>
                  <h3 className="pt-1 text-sm font-black tracking-tight">{unit.name}</h3>
                  <p className="text-xs leading-relaxed text-[#1a1a1a]/80">{unit.focus}</p>
                </div>
                <Link
                  to={`/explore?q=${encodeURIComponent(unit.q)}`}
                  className="inline-flex min-h-[40px] items-center self-start rounded text-xs font-bold text-[#183d2d] underline hover:text-[#c0392b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                >
                  See what it lends →<span className="sr-only"> ({unit.name})</span>
                </Link>
              </div>
            </MagicCard>
          </StaggerItem>
        ))}
      </StaggerList>
    </section>
  );
}

function UseCaseCard({ item }) {
  return (
    <div className="flex h-full w-[260px] flex-col justify-between gap-3 rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[3px_3px_0_#1a1a1a] sm:w-[300px]">
      <p className="text-sm font-black leading-snug tracking-tight">{item.task}</p>
      <p className="text-[11px] text-[#1a1a1a]/75">
        <span className="font-bold text-[#183d2d]">{item.resource}</span> · {item.unit}
      </p>
    </div>
  );
}

export function UseCasesSection() {
  const { paused } = useMotionPause();
  return (
    <section aria-labelledby="use-cases-heading" className="space-y-4">
      <div className="max-w-2xl space-y-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-[#c0392b]">What people book for</span>
        <h2 id="use-cases-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
          From a club project to a final-year lab
        </h2>
      </div>
      <InfiniteMovingCards
        label="Examples of what people book resources for"
        items={USE_CASES}
        getKey={(item) => item.task}
        renderItem={(item) => <UseCaseCard item={item} />}
        speed="slow"
        paused={paused}
        className="py-2"
      />
    </section>
  );
}
