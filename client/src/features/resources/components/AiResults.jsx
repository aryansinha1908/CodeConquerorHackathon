import React from 'react';
import { Sparkles } from 'lucide-react';
import { StaggerItem, StaggerList } from '../../../components/Motion';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ResourceCardSkeleton } from '../../../components/ui/Skeleton';
import { errorMessage } from '../../../lib/errors';
import { filterAiPicks } from '../api';
import { DAILY_REASONS, pickCount } from './aiSearchView';
import { ResourceCard } from './ResourceCard';

// Explore's AI search results (frontend.md FC-06): the resources Gemini picked for the question in
// ?ask, best first, each with Gemini's reason and whether the viewer can book it, narrowed on this
// device by the category, unit and "only what I can book" filters. The picks are a suggestion: the
// resource page's checks decide. `search` is useAiSearch(question). A question that came with a link
// waits for "Ask Gemini" (`confirmed`), so a link can't spend someone's AI requests. A quota or
// availability failure doesn't land here: the page falls back to the keyword search
// (AiFallbackNote). The page's live region announces the states; the heading takes focus when a
// retry removes the button that was pressed.

const HEADING_ID = 'explore-ai-heading';
const focusHeading = () => document.getElementById(HEADING_ID)?.focus();

/**
 * Above the keyword results when the AI search couldn't run: why, and that keywords stand in. The
 * retry stays focusable while it runs (aria-disabled, not disabled, which would drop focus).
 */
export function AiFallbackNote({ error, question, onRetry, retrying = false }) {
  const daily = DAILY_REASONS.has(error?.details?.reason);
  return (
    <div className="text-xs p-3 rounded-lg border-2 border-[#e67e22] bg-[#fef9f3] space-y-2">
      <p className="font-bold">{errorMessage(error)}</p>
      <p>
        Showing a keyword search for &ldquo;<span className="break-words">{question}</span>&rdquo; instead.
      </p>
      {!daily && onRetry && (
        <Button
          type="button"
          variant="outline"
          size="md"
          className="bg-white min-h-[40px]"
          aria-disabled={retrying || undefined}
          onClick={() => {
            if (!retrying) onRetry();
          }}
        >
          {retrying ? 'Asking…' : 'Ask Gemini again'}
        </Button>
      )}
    </div>
  );
}

export function AiResults({ question, search, filters, confirmed = true, onConfirm, onClearFilters, onUseKeywords }) {
  const data = search.data?.data;
  const all = Array.isArray(data?.items) ? data.items : [];
  const picks = filterAiPicks(all, filters);
  const hidden = all.length - picks.length;
  const heading = !confirmed ? 'Ask Gemini?' : search.isSuccess ? pickCount(picks.length) : 'Asking Gemini…';

  return (
    <section aria-labelledby={HEADING_ID} aria-busy={search.isFetching || undefined} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 id={HEADING_ID} tabIndex={-1} className="text-lg font-black tracking-tight focus:outline-none">
            {heading}
          </h2>
          <p className="text-xs text-[#1a1a1a]/80 break-words">For &ldquo;{question}&rdquo;</p>
        </div>
        {confirmed && data?.cached && (
          <span className="text-xs font-bold text-[#1a1a1a]/75">Answered before: no AI request used</span>
        )}
      </div>

      {!confirmed && (
        <div className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[4px_4px_0_#1a1a1a] space-y-3 text-xs">
          <p>
            This link asks Google Gemini the question above. Asking uses one of your AI requests for
            today (the same question asked before is usually free). Check the question first: it came with
            the link, not from you.
          </p>
          <Button type="button" variant="primary" size="md" className="min-h-[40px]" onClick={onConfirm}>
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            Ask Gemini
          </Button>
        </div>
      )}

      {confirmed && search.isPending && (
        <>
          <p className="text-xs">Gemini is reading the catalogue. This takes a few seconds.</p>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((n) => (
              <li key={n}>
                <ResourceCardSkeleton />
              </li>
            ))}
          </ul>
        </>
      )}

      {confirmed && search.isError && (
        <ErrorState
          error={search.error}
          title="Couldn't ask Gemini"
          onRetry={() => {
            // The error box goes away while the retry runs: keep focus on the heading.
            focusHeading();
            search.refetch();
          }}
          retrying={search.isFetching}
        />
      )}

      {confirmed && search.isSuccess && all.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="Nothing in the catalogue fits"
          description="Try describing it another way (what you want to make, measure or do), or search by keyword."
          actionLabel="Search by keyword"
          onAction={onUseKeywords}
        />
      )}

      {confirmed && search.isSuccess && all.length > 0 && picks.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title={`Your filters hide all ${all.length} ${all.length === 1 ? 'pick' : 'picks'}`}
          description="The category, unit and “only what I can book” filters apply to Gemini’s picks too."
          actionLabel="Clear filters"
          onAction={onClearFilters}
        />
      )}

      {confirmed && picks.length > 0 && (
        <>
          <StaggerList className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {picks.map((resource) => (
              <StaggerItem key={resource._id}>
                <ResourceCard resource={resource} reason={resource.reason} eligible={resource.eligible} />
              </StaggerItem>
            ))}
          </StaggerList>
          {hidden > 0 && (
            <p className="text-xs flex flex-wrap items-center gap-x-2">
              {hidden} more {hidden === 1 ? 'pick is' : 'picks are'} hidden by your filters.
              <Button type="button" variant="ghost" size="sm" className="min-h-[40px] underline" onClick={onClearFilters}>
                Clear filters
              </Button>
            </p>
          )}
        </>
      )}

      {confirmed && search.isSuccess && all.length > 0 && (
        <p className="text-[11px] text-[#1a1a1a]/75">
          Picked by Google Gemini from the catalogue: a suggestion. Each resource&apos;s page checks your
          eligibility and the times for real.
          {data?.capped && ' Gemini looked at the first 150 resources by title; search by keyword to see the rest.'}
        </p>
      )}
    </section>
  );
}
