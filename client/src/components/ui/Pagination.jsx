import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

/**
 * Previous / "Page 2 of 5" / Next for a list + meta (api.md "Values": meta { page, limit, total };
 * lib/paging.js pageCount turns meta into `pageCount`). Renders nothing for a single page.
 *
 * The buttons are aria-disabled, never disabled, at the ends and while `busy` (the next page is
 * loading): disabling the button just pressed would drop a keyboard user's focus to <body>
 * (frontend.md §10.3). The page text is a polite live region, so the new page is announced.
 */
export function Pagination({ page, pageCount, onPageChange, busy = false, label = 'Pages', className }) {
  const pages = Math.max(1, Number(pageCount) || 1);
  if (pages <= 1) return null;
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const go = (next) => {
    if (busy || next < 1 || next > pages || next === current) return;
    onPageChange?.(next);
  };

  return (
    <nav aria-label={label} className={cn('flex items-center justify-between gap-3 pt-2', className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="bg-white min-h-[44px]"
        aria-disabled={current <= 1 || busy}
        onClick={() => go(current - 1)}
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Previous
      </Button>
      <span className="text-xs font-bold font-mono text-[#1a1a1a]" aria-live="polite">
        Page {current} of {pages}
        {busy && <span className="sr-only"> (loading)</span>}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="bg-white min-h-[44px]"
        aria-disabled={current >= pages || busy}
        onClick={() => go(current + 1)}
      >
        Next
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
