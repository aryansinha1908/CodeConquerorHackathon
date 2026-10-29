import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { cn } from '../../../lib/utils';
import { totalOf } from './counts';
import { StaggerItem } from '../../../components/Motion';

/**
 * One dashboard count (frontend.md §6.3): the number of items waiting in a list, as a link to that
 * list. `query` is the React Query result of its limit=1 page; `noun(count)` words the number for
 * screen readers ("3 slots waiting"). While it loads the number is a placeholder; a failed request
 * shows its message, request id and "Try again" below the link (a button can't sit inside a link).
 */
export function CountCard({ id, to, title, description, icon: Icon, query, noun, linkLabel }) {
  const count = totalOf(query.data);
  const failed = query.isError && count === null;
  const headingId = `dashboard-${id}-heading`;
  const busy = query.isPending && query.fetchStatus !== 'idle';
  const attention = typeof count === 'number' && count > 0;

  return (
    <StaggerItem className="flex flex-col gap-2 min-w-0">
      <Link
        to={to}
        aria-labelledby={headingId}
        aria-describedby={`dashboard-${id}-description`}
        className={cn(
          'group flex-1 flex flex-col gap-3 p-5 rounded-xl border-2 border-[#1a1a1a] font-mono transition-all',
          'shadow-[4px_4px_0_#1a1a1a] hover:shadow-[2px_2px_0_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
          attention ? 'bg-[#fffbea]' : 'bg-white'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'w-10 h-10 shrink-0 rounded-lg border-2 border-[#1a1a1a] flex items-center justify-center',
              attention ? 'bg-[#f1c40f]' : 'bg-[#ede8df]'
            )}
          >
            {Icon && <Icon className="w-5 h-5" />}
          </span>
          <ArrowRight
            className="w-5 h-5 text-[#1a1a1a]/60 group-hover:text-[#1a1a1a] transition-colors"
            aria-hidden="true"
          />
        </div>
        <h3 id={headingId} className="text-sm font-black tracking-tight">
          {title}
          {/* The number, read with the title as the link's name: "Requests to review: 3 slots waiting". */}
          {typeof count === 'number' && <span className="sr-only">: {noun(count)}</span>}
          {busy && <span className="sr-only">: loading</span>}
          {failed && <span className="sr-only">: couldn&apos;t load the count</span>}
        </h3>
        <div aria-hidden="true" className="min-h-[44px] flex items-end">
          {busy ? (
            <Skeleton className="h-10 w-16" />
          ) : (
            <span className="text-4xl font-black tabular-nums leading-none">{count ?? '—'}</span>
          )}
        </div>
        <p id={`dashboard-${id}-description`} className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          {description}
        </p>
        <span className="text-xs font-bold text-[#183d2d] underline underline-offset-2 group-hover:text-[#c0392b]">
          {linkLabel}
        </span>
      </Link>
      {failed && (
        <ErrorState
          error={query.error}
          title="Couldn't load this count"
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
          className="text-xs"
        />
      )}
    </StaggerItem>
  );
}
