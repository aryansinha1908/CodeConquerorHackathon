import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Bell, Camera, CheckCircle2, ListOrdered, QrCode, ScrollText, ShieldCheck, Sparkles } from 'lucide-react';
import { BentoCard, BentoGrid } from '../../components/magicui/BentoGrid';
import { AnimatedList } from '../../components/magicui/AnimatedList';
import { ACTIVITY_DEMO, CHECKLIST_DEMO } from './homeContent';
import { useMotionPause } from './motionPause';

// What ShareX does, as a Magic UI bento grid: six cards, each with a small live picture of the
// feature. The pictures are decorative (hidden from screen readers); each card's text says it all.

const reveal = (i) => ({
  initial: { opacity: 0, x: -10 },
  whileInView: { opacity: 1, x: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { delay: 0.15 + i * 0.18, duration: 0.3 },
});

function ChecklistVisual() {
  return (
    <ul aria-hidden="true" className="absolute inset-0 flex flex-col justify-center gap-1.5 px-6">
      {CHECKLIST_DEMO.map((rule, i) => (
        <motion.li key={rule} {...reveal(i)} className="flex items-center gap-2 rounded-md border-2 border-[#1a1a1a] bg-white px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0_#1a1a1a]">
          <CheckCircle2 className="h-4 w-4 text-[#1e7e45]" />
          {rule}
        </motion.li>
      ))}
    </ul>
  );
}

function WaitlistVisual() {
  const people = [
    { label: 'Held', tone: 'bg-[#183d2d] text-white' },
    { label: '#1', tone: 'bg-[#f1c40f]' },
    { label: '#2', tone: 'bg-white' },
    { label: '#3', tone: 'bg-white' },
  ];
  return (
    <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center gap-2 px-4">
      {people.map((p, i) => (
        <motion.div
          key={p.label}
          {...reveal(i)}
          className={`flex h-16 w-14 flex-col items-center justify-center rounded-lg border-2 border-[#1a1a1a] text-xs font-black shadow-[2px_2px_0_#1a1a1a] ${p.tone}`}
        >
          <span className="h-5 w-5 rounded-full border-2 border-current opacity-70" />
          <span className="mt-1">{p.label}</span>
        </motion.div>
      ))}
    </div>
  );
}

// A fixed, made-up pattern: it looks like a QR code without being one.
const QR_CELLS = '1110101011100111001010110010111011000101101010011100101001110010111010111100011011100101101100'
  .split('')
  .slice(0, 81);

function QrVisual() {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center gap-5">
      <div className="grid grid-cols-9 gap-[3px] rounded-lg border-2 border-[#1a1a1a] bg-white p-2.5 shadow-[3px_3px_0_#1a1a1a]">
        {QR_CELLS.map((cell, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: (i % 9) * 0.04 + Math.floor(i / 9) * 0.03 }}
            className={`h-2.5 w-2.5 ${cell === '1' ? 'bg-[#1a1a1a]' : 'bg-transparent'}`}
          />
        ))}
      </div>
      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]/70">Code</p>
        <p className="font-mono text-lg font-black tracking-[0.25em]">K7Q-2MX</p>
        <p className="text-[10px] font-bold text-[#1e7e45]">Verified at pickup ✓</p>
      </div>
    </div>
  );
}

// A question typed out (Magic UI's typing effect), then two picks with reasons.
function AskVisual() {
  const question = 'something to print a phone case';
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const { paused } = useMotionPause();
  const [typedCount, setTyped] = useState(0);
  // One letter at a time, stopping at the end.
  useEffect(() => {
    if (!inView || reduce || typedCount >= question.length) return undefined;
    const id = setTimeout(() => setTyped((n) => n + 1), 45);
    return () => clearTimeout(id);
  }, [inView, reduce, typedCount]);
  // Under reduced motion the question is simply there.
  const typed = reduce ? question.length : typedCount;
  const done = typed >= question.length;
  return (
    <div ref={ref} aria-hidden="true" className="absolute inset-0 flex flex-col justify-center gap-2 px-5">
      <div className="flex items-center gap-2 rounded-lg border-2 border-[#1a1a1a] bg-white px-3 py-2 text-xs shadow-[2px_2px_0_#1a1a1a]">
        <Sparkles className="h-4 w-4 shrink-0 text-[#a93226]" />
        <span className="truncate font-mono">
          {question.slice(0, typed)}
          <span className={`ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-[#1a1a1a] ${paused ? '' : 'motion-safe:animate-pulse'}`} />
        </span>
      </div>
      {['FDM 3D Printer: prints a phone case in PLA', 'CO₂ Laser Cutter: cuts an acrylic case back'].map((pick, i) => (
        <motion.div
          key={pick}
          initial={{ opacity: 0, y: 6 }}
          animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
          transition={{ delay: 0.2 + i * 0.25 }}
          className="rounded-md border-2 border-[#1a1a1a] bg-[#fdf3c4] px-3 py-1.5 text-[11px] font-bold"
        >
          {pick}
        </motion.div>
      ))}
    </div>
  );
}

function PhotoVisual() {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center gap-3 px-4">
      {['Pickup', 'Return'].map((label, i) => (
        <motion.div key={label} {...reveal(i)} className="relative h-24 w-28 rounded-lg border-2 border-[#1a1a1a] bg-[#d8d4cc] shadow-[2px_2px_0_#1a1a1a]">
          <div className="absolute inset-x-3 bottom-4 h-5 rounded-sm bg-[#9aa3ad]" />
          <div className="absolute left-1/2 top-3 h-6 w-10 -translate-x-1/2 rounded bg-[#e8662a]" />
          {i === 1 && <div className="absolute inset-x-5 bottom-6 h-[3px] rotate-[-8deg] bg-[#1a1a1a]" />}
          <span className="absolute -bottom-2.5 left-1.5 rounded border border-[#1a1a1a] bg-white px-1.5 text-[9px] font-black uppercase">{label}</span>
        </motion.div>
      ))}
      <motion.span
        {...reveal(2)}
        className="absolute right-3 top-3 rounded-md border-2 border-[#1a1a1a] bg-[#c0392b] px-2 py-0.5 text-[10px] font-black uppercase text-white shadow-[2px_2px_0_#1a1a1a]"
      >
        AI: possible new damage
      </motion.span>
    </div>
  );
}

function ActivityVisual() {
  const { paused } = useMotionPause();
  return (
    <div className="absolute inset-0 overflow-hidden px-5 py-3">
      <AnimatedList
        items={ACTIVITY_DEMO}
        paused={paused}
        renderItem={(item) => (
          <div className="flex items-center gap-2.5 rounded-lg border-2 border-[#1a1a1a] bg-white px-3 py-2 shadow-[2px_2px_0_#1a1a1a]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: item.color }}>
              <Bell className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-black">{item.title}</span>
              <span className="block truncate text-[10px] text-[#1a1a1a]/70">{item.detail}</span>
            </span>
          </div>
        )}
      />
    </div>
  );
}

export function FeaturesSection() {
  return (
    <section aria-labelledby="features-heading" className="space-y-6">
      <div className="max-w-2xl space-y-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-[#c0392b]">What you get</span>
        <h2 id="features-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
          Booking that explains itself
        </h2>
        <p className="text-sm text-[#1a1a1a]/75">
          Fair rules you can read, a queue you can trust, and a record of every handover.
        </p>
      </div>
      <BentoGrid>
        <BentoCard
          className="lg:col-span-2"
          icon={ShieldCheck}
          accent="#1e7e45"
          title="Know before you book"
          description="Every resource lists who can book it. When you pick a slot, 12 rules run on it before you send the request (verification, member type, badges, opening hours, your weekly hours and more). Each one that fails is explained, most with how to fix it."
          visual={<ChecklistVisual />}
        />
        <BentoCard
          icon={ListOrdered}
          accent="#b9470b"
          title="A fair queue"
          description="A held slot goes to the earliest request. Join the waitlist and, if it frees up, the next person in line who still meets the rules moves up and is told."
          visual={<WaitlistVisual />}
        />
        <BentoCard
          icon={QrCode}
          accent="#2471a3"
          title="A pass for the counter"
          description="Show a QR pass that refreshes every minute, or read out its 6-character code. The unit scans it and opens the next step; it proves the booking, and the unit checks your college ID."
          visual={<QrVisual />}
        />
        <BentoCard
          className="lg:col-span-2"
          icon={Sparkles}
          accent="#a93226"
          title="Ask in your own words"
          description="Describe what you need and AI picks the resources that fit, each with a reason, marked by whether you can book it. Your question and the catalogue go to Google Gemini without your name, email or roll number. 5 AI requests a day (shared with the photo comparison); asking the same thing again within a day is free."
          visual={<AskVisual />}
        />
        <BentoCard
          icon={Camera}
          accent="#183d2d"
          title="Photo-proof handovers"
          description="A checklist at pickup and at return, with up to three photos each time. When both have photos, the unit can ask AI to compare them; it only suggests, a person decides."
          visual={<PhotoVisual />}
        />
        <BentoCard
          className="lg:col-span-2"
          icon={ScrollText}
          accent="#8e44ad"
          title="Every step on record"
          description="Decisions, scans, handovers and incidents are written to your booking’s timeline and an audit log that can’t be edited, and the people involved are notified as it happens."
          visual={<ActivityVisual />}
        />
      </BentoGrid>
    </section>
  );
}
