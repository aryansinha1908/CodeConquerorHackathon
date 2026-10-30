import React from 'react';
import { Timeline } from '../../components/aceternity/Timeline';
import { LIFECYCLE } from './homeContent';

// The booking lifecycle, from sign-up to the last incident, as Aceternity's scroll timeline.

const items = LIFECYCLE.map((step) => ({
  title: step.title,
  content: (
    <div className="rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a]">
      <p className="text-sm leading-relaxed text-[#1a1a1a]/85">{step.body}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="In short">
        {step.tags.map((tag) => (
          <li key={tag} className="rounded border border-[#1a1a1a] bg-[#f5f0e8] px-2 py-0.5 text-[11px] font-bold">
            {tag}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

export function LifecycleSection() {
  return (
    <section aria-labelledby="how-it-works-heading" className="space-y-4">
      <div className="mx-auto max-w-2xl space-y-1 text-center">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-[#c0392b]">From sign-up to return</span>
        <h2 id="how-it-works-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
          How ShareX takes the friction out of booking
        </h2>
        <p className="text-xs text-[#1a1a1a]/75">
          Six steps, each checked, recorded and explained. The full rules are on the How it works page.
        </p>
      </div>
      <Timeline items={items} />
    </section>
  );
}
