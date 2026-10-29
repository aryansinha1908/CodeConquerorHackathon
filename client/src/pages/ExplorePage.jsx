import React, { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Compass, Cpu, Sparkles } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Pagination } from '../components/ui/Pagination';
import { ResourceCardSkeleton } from '../components/ui/Skeleton';
import { pageCount } from '../lib/paging';
import {
  hasExploreFilters,
  readExploreFilters,
  useOrgUnits,
  useResources,
  writeExploreFilters,
} from '../features/resources/api';
import { ResourceCard } from '../features/resources/components/ResourceCard';
import { ResourceFilters } from '../features/resources/components/ResourceFilters';

// /explore (frontend.md §6.2): search, filters and the resource grid on GET /resources, the unit
// filter on GET /org-units. The filters and the page live in the URL (?q, category, unit,
// eligibleOnly=true, page), so a filtered list can be linked and survives a reload.

function resultText(total, filters) {
  const count = `${total} ${total === 1 ? 'resource' : 'resources'}`;
  if (filters.eligibleOnly) return `${count} you can book`;
  return hasExploreFilters(filters) ? `${count} match` : `${count} on campus`;
}

export default function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readExploreFilters(searchParams);
  const resultsRef = useRef(null);
  const resultsHeadingRef = useRef(null);

  const list = useResources(filters);
  const units = useOrgUnits();

  const update = useCallback(
    (patch, { replace = false } = {}) =>
      setSearchParams((current) => writeExploreFilters(current, patch), { replace }),
    [setSearchParams]
  );
  const reset = () => setSearchParams(new URLSearchParams());
  // The empty state's "Clear filters" goes away with the filters: focus the results heading
  // instead of letting focus fall to <body>.
  const resetFromResults = () => {
    reset();
    resultsHeadingRef.current?.focus();
  };

  const items = Array.isArray(list.data?.data) ? list.data.data : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta);
  const filtered = hasExploreFilters(filters);

  // A filter change can leave the page past the end (the list shrank): go to the last page.
  const settled = list.isSuccess && !list.isPlaceholderData;
  useEffect(() => {
    if (settled && filters.page > pages) {
      setSearchParams((current) => writeExploreFilters(current, { page: pages }), { replace: true });
    }
  }, [settled, filters.page, pages, setSearchParams]);

  const goToPage = (page) => {
    update({ page });
    resultsRef.current?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <div className="space-y-8 font-mono text-[#1a1a1a]">
      <section className="relative overflow-hidden rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d] text-white p-6 md:p-8 shadow-[6px_6px_0_#1a1a1a]">
        <div aria-hidden="true" className="absolute top-0 right-0 w-32 h-32 pointer-events-none select-none opacity-20">
          <div className="absolute top-3 right-3 w-6 h-6 bg-[#c0392b]" />
          <div className="absolute top-3 right-11 w-6 h-6 bg-white" />
          <div className="absolute top-11 right-3 w-6 h-6 bg-[#f1c40f]" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <p className="mb-3">
            <span className="px-2.5 py-0.5 rounded border border-white/40 bg-[#c0392b] text-[10px] font-black tracking-widest uppercase">
              Campus catalogue
            </span>
          </p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight leading-tight mb-3">
            Explore campus resources
          </h1>
          <p className="text-xs sm:text-sm text-white/90 leading-relaxed mb-5">
            Printers, workstations, lab instruments, tools and rooms across NIT Jamshedpur. Each one
            shows who can book it, what you still need, and when it&apos;s free.
          </p>
          <ul className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
            <li className="px-3 py-1.5 rounded-lg border border-white/30 bg-white/10 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#f1c40f]" aria-hidden="true" />
              Live availability (IST)
            </li>
            <li className="px-3 py-1.5 rounded-lg border border-white/30 bg-white/10 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#1abc9c]" aria-hidden="true" />
              Eligibility checks with fix links
            </li>
          </ul>
        </div>
      </section>

      <ResourceFilters
        filters={filters}
        onChange={update}
        onReset={reset}
        hasFilters={filtered}
        units={Array.isArray(units.data?.data) ? units.data.data : []}
        unitsLoading={units.isPending}
        unitsError={units.isError ? units.error : null}
        onRetryUnits={() => units.refetch()}
      />

      <section aria-labelledby="explore-results-heading" className="space-y-4" ref={resultsRef}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="explore-results-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-lg font-black tracking-tight focus:outline-none"
          >
            {list.isSuccess ? resultText(total, filters) : 'Resources'}
          </h2>
          {list.isFetching && list.data && (
            <span className="text-xs font-bold text-[#1a1a1a]/75">Updating…</span>
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {list.isSuccess && !list.isFetching ? `${resultText(total, filters)}.` : ''}
        </p>

        {meta?.capped && (
          <p className="text-xs p-3 rounded-lg border-2 border-[#e67e22] bg-[#fef9f3]">
            More than 200 resources matched, so only the first 200 were checked against your
            eligibility. Narrow the search to see the rest.
          </p>
        )}

        {list.isPending && (
          <ul aria-busy="true" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <li className="sr-only">Loading resources…</li>
            {[0, 1, 2].map((n) => (
              <li key={n}>
                <ResourceCardSkeleton />
              </li>
            ))}
          </ul>
        )}

        {list.isError && !list.data && (
          <ErrorState
            error={list.error}
            title="Couldn't load the resources"
            onRetry={() => list.refetch()}
            retrying={list.isFetching}
          />
        )}

        {list.isSuccess && items.length === 0 && (
          <EmptyState
            icon={Compass}
            title={filtered ? 'Nothing matches these filters' : 'No resources listed yet'}
            description={
              filters.eligibleOnly
                ? 'Nothing here is bookable for you with these filters. Untick "Only show what I can book" to see everything, then open a resource to see what you still need.'
                : filtered
                  ? 'Try another search word, or clear the filters.'
                  : "When a unit lists a resource, it shows up here."
            }
            actionLabel={filtered ? 'Clear filters' : undefined}
            onAction={filtered ? resetFromResults : undefined}
          />
        )}

        {items.length > 0 && (
          <>
            <ul
              aria-busy={list.isFetching || undefined}
              className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${list.isPlaceholderData ? 'opacity-60' : ''}`}
            >
              {items.map((resource) => (
                <li key={resource._id}>
                  <ResourceCard resource={resource} />
                </li>
              ))}
            </ul>
            <Pagination
              page={filters.page}
              pageCount={pages}
              onPageChange={goToPage}
              busy={list.isPlaceholderData}
              label="Resource pages"
            />
          </>
        )}
      </section>
    </div>
  );
}
