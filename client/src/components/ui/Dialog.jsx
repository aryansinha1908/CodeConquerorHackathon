import React, { useEffect, useRef } from 'react';
import {
  Description,
  Dialog as HeadlessDialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { dialogIn } from '../../lib/motion';
import { cn } from '../../lib/utils';

/**
 * The app's modal dialog (frontend.md §10.3). Headless UI traps focus, closes on Esc and returns
 * focus to the element that opened it; the panel is labelled by `title` (and described by
 * `description`). Put data-autofocus on the element that should take focus first, else it is the
 * close button.
 *
 * - `busy`: while true (a request is running) Esc, the backdrop and the close button do nothing.
 * - `returnFocusRef`: where focus goes when the dialog closes and the element that opened it is
 *   gone (a row that left the list after a decision), instead of falling to <body>.
 * - `wide`: a wider panel (side-by-side photos, a long form).
 *
 * The backdrop fades and the panel zooms in slightly (framer-motion, as Headless UI documents:
 * `as={motion.div}`); closing is immediate.
 */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  wide = false,
  busy = false,
  returnFocusRef,
  className,
}) {
  const close = () => {
    if (!busy) onClose?.();
  };

  // Headless UI gives focus back to the opener on close. When the opener has left the page, focus
  // would land on <body>: send it to returnFocusRef instead.
  const wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || !returnFocusRef) return undefined;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) returnFocusRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, returnFocusRef]);

  return (
    <HeadlessDialog open={open} onClose={close} className="relative z-50">
      <DialogBackdrop
        as={motion.div}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.15 } }}
        className="fixed inset-0 bg-[#1a1a1a]/60"
      />
      <div className="fixed inset-0 w-screen overflow-y-auto p-4">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel
            as={motion.div}
            {...dialogIn}
            aria-busy={busy || undefined}
            className={cn(
              'w-full bg-white border-2 border-[#1a1a1a] rounded-xl shadow-[6px_6px_0_#1a1a1a] font-mono text-[#1a1a1a]',
              wide ? 'max-w-3xl' : 'max-w-lg',
              className
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#1a1a1a]/15 px-5 py-4">
              <div className="min-w-0">
                {eyebrow && (
                  <p className="text-[10px] uppercase font-bold text-[#c0392b] tracking-widest">
                    {eyebrow}
                  </p>
                )}
                <DialogTitle className="text-lg font-black tracking-tight break-words">
                  {title}
                </DialogTitle>
                {description && (
                  <Description className="mt-1 text-xs text-[#1a1a1a]/70 leading-relaxed">
                    {description}
                  </Description>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                aria-disabled={busy || undefined}
                className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border-2 border-[#1a1a1a] bg-white hover:bg-[#ede8df] aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="px-5 py-5">{children}</div>
          </DialogPanel>
        </div>
      </div>
    </HeadlessDialog>
  );
}
