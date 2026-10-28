import React from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';

/**
 * The admin console's dialog: Headless UI traps focus, closes on Esc and returns focus to the
 * trigger (frontend.md §10.3). `onClose` may refuse (e.g. while a decision is being saved).
 * Put data-autofocus on the element that should get focus first; else it is the close button.
 */
export function AdminDialog({ open, onClose, title, eyebrow, children, wide = false }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-[#1a1a1a]/60" />
      <div className="fixed inset-0 w-screen overflow-y-auto p-4">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel
            className={`w-full ${
              wide ? 'max-w-3xl' : 'max-w-lg'
            } bg-white border-2 border-[#1a1a1a] rounded-xl shadow-[6px_6px_0_#1a1a1a] font-mono text-[#1a1a1a]`}
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
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-lg border-2 border-[#1a1a1a] bg-white hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="px-5 py-5">{children}</div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
