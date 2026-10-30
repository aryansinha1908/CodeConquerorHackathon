import React, { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { FAQS } from './homeContent';

// Common questions, as an accordion: one answer open at a time, each a button (aria-expanded,
// aria-controls) over its region. The answer's height animates open and shut.

function Question({ item, open, onToggle, id }) {
  const panelId = `${id}-panel`;
  const buttonId = `${id}-button`;
  return (
    <li className="rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[3px_3px_0_#1a1a1a]">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-black tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
        >
          {item.q}
          <motion.span animate={{ rotate: open ? 45 : 0 }} className="shrink-0" aria-hidden="true">
            <Plus className="h-4 w-4" />
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <p className="px-4 pb-4 text-xs leading-relaxed text-[#1a1a1a]/85">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function FaqSection() {
  const id = useId();
  const [open, setOpen] = useState(0);
  return (
    <section aria-labelledby="faq-heading" className="grid gap-6 lg:grid-cols-[1fr_2fr]">
      <div className="space-y-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-[#183d2d]">Questions</span>
        <h2 id="faq-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
          Good to know
        </h2>
        <p className="text-xs text-[#1a1a1a]/75">Every rule in full is on the How it works page.</p>
      </div>
      <ul className="space-y-3">
        {FAQS.map((item, i) => (
          <Question key={item.q} item={item} id={`${id}-${i}`} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
        ))}
      </ul>
    </section>
  );
}
