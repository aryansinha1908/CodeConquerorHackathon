import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Compass, Cpu, Sparkles } from 'lucide-react';
import { FadeUp, StaggerItem, StaggerList } from '../components/Motion';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Pagination } from '../components/ui/Pagination';
import { ResourceCardSkeleton } from '../components/ui/Skeleton';
import { errorMessage } from '../lib/errors';
import { pageCount } from '../lib/paging';
import { aiKeys, normaliseQuestion } from '../features/ai/api';
import {
  SEARCH_MAX_LENGTH,
  hasExploreFilters,
  readAskQuestion,
  readExploreFilters,
  useAiSearch,
  useOrgUnits,
  useResources,
  writeAskQuestion,
  writeExploreFilters,
} from '../features/resources/api';
import { AiFallbackNote, AiResults } from '../features/resources/components/AiResults';
import { aiAnnouncement } from '../features/resources/components/aiSearchView';
import { ResourceCard } from '../features/resources/components/ResourceCard';
import { ResourceFilters } from '../features/resources/components/ResourceFilters';

// /explore (frontend.md §6.2): search, filters and the resource grid on GET /resources, the unit
// filter on GET /org-units. The filters and the page live in the URL (?q, category, unit,
// eligibleOnly=true, page), so a filtered list can be linked and survives a reload.
//
// "Ask in your own words" (frontend.md FC-06) puts the question in ?ask (and drops ?q): the AI search
// (POST /resources/ai-search) replaces the list, with the other filters applied to its picks. When
// the AI can't answer (429 AI_QUOTA_EXCEEDED, 503 AI_UNAVAILABLE) the page says why and runs the
// keyword search with the same words instead. A question that arrives with a link (or a reload) is
// asked only after "Ask Gemini", unless its answer is already cached here: a link can't spend
// someone's AI requests or put words they didn't choose in front of them.

function resultText(total, filters) {
  const count = `${total} ${total === 1 ? 'resource' : 'resources'}`;
  if (filters.eligibleOnly) return `${count} you can book`;
  return hasExploreFilters(filters) ? `${count} match` : `${count} on campus`;
}

export default function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = readExploreFilters(searchParams);
  const ask = readAskQuestion(searchParams);
  const resultsRef = useRef(null);
  const resultsHeadingRef = useRef(null);

  // A question in the URL (asked, a link, Back) means the AI box. Without one, the switch alone opens
  // it, for a question not asked yet. React Router applies a URL change in a transition, so the URL
  // is read, never copied into state: a copy would turn the box back on for the render in between.
  const [askOpen, setAskOpen] = useState(false);
  const askMode = Boolean(ask) || askOpen;
  // Asked from this page's box, or answered before (in the cache): then it runs without a click.
  const queryClient = useQueryClient();
  const [askedHere, setAskedHere] = useState('');
  const confirmed =
    Boolean(ask) && (askedHere === normaliseQuestion(ask) || queryClient.getQueryData(aiKeys.search(ask)) !== undefined);
  const ai = useAiSearch(ask, { enabled: confirmed });
  const fallbackError = confirmed ? (ai.data?.fallback ?? null) : null;
  const aiFallback = Boolean(fallbackError);
  const showAi = Boolean(ask) && !aiFallback;
  const filters = aiFallback ? { ...urlFilters, q: ask.slice(0, SEARCH_MAX_LENGTH) } : urlFilters;

  const list = useResources(filters, { enabled: !showAi });
  const units = useOrgUnits();

  // Focus moved once its target is on screen: the keyword box after the URL's transition lands, the
  // AI heading after a retry's answer replaces the fallback note (and the button that was pressed).
  const searchInputRef = useRef(null);
  const focusSearchRef = useRef(false);
  const focusAiHeadingRef = useRef(false);
  useEffect(() => {
    if (focusSearchRef.current && !askMode) {
      focusSearchRef.current = false;
      searchInputRef.current?.focus();
    }
    if (focusAiHeadingRef.current && showAi) {
      focusAiHeadingRef.current = false;
      document.getElementById('explore-ai-heading')?.focus();
    }
  });

  const update = useCallback(
    (patch, { replace = false } = {}) =>
      setSearchParams((current) => writeExploreFilters(current, patch), { replace }),
    [setSearchParams]
  );
  // Clearing the filters keeps the question being asked.
  const reset = () => setSearchParams(ask ? writeAskQuestion('', ask) : new URLSearchParams());
  // The same question again asks again only if the last answer was a failure or a fallback.
  const askQuestion = (question) => {
    const key = normaliseQuestion(question);
    setAskedHere(key);
    if (key === normaliseQuestion(ask)) {
      if (confirmed && (ai.isError || ai.data?.fallback)) ai.refetch();
      return;
    }
    setSearchParams((current) => writeAskQuestion(current, question));
  };
  const confirmAsk = () => setAskedHere(normaliseQuestion(ask));
  // After "Ask Gemini again" succeeds the note (and its button) goes: focus the AI heading. Another
  // fallback keeps the note, and focus stays on its button.
  const retryAi = async () => {
    focusAiHeadingRef.current = true;
    const result = await ai.refetch();
    if (!result.data || result.data.fallback) focusAiHeadingRef.current = false;
  };
  // Back to keywords: the AI box's text (or the question asked), cut to the keyword limit, becomes
  // the keyword search.
  const changeAskMode = (next, text = '') => {
    setAskOpen(next);
    const words = (text.trim() || ask).slice(0, SEARCH_MAX_LENGTH);
    if (!next && words) {
      setSearchParams((current) => writeExploreFilters(writeAskQuestion(current, ''), { q: words }));
    }
  };
  const useKeywords = () => {
    focusSearchRef.current = true;
    changeAskMode(false);
  };
  // The AI results' "Clear filters" goes away with the filters: focus the AI heading instead.
  const resetAiFilters = () => {
    reset();
    document.getElementById('explore-ai-heading')?.focus();
  };
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
  // In the fallback the question is the keyword search, which "Clear filters" keeps.
  const filtered = hasExploreFilters(urlFilters);

  // One live region for the page: the AI's state, or the list's count (with why the AI didn't answer).
  const announcement = showAi
    ? aiAnnouncement(ai, urlFilters, confirmed)
    : list.isSuccess && !list.isFetching
      ? `${aiFallback ? `${errorMessage(fallbackError)} Keyword results instead: ` : ''}${resultText(total, filters)}.`
      : '';

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
      <FadeUp as="section" className="relative overflow-hidden rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d] text-white p-6 md:p-8 shadow-[6px_6px_0_#1a1a1a]">
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
      </FadeUp>

      <ResourceFilters
        filters={urlFilters}
        onChange={update}
        onReset={reset}
        hasFilters={hasExploreFilters(urlFilters)}
        askMode={askMode}
        ask={ask}
        onAsk={askQuestion}
        onAskModeChange={changeAskMode}
        searchInputRef={searchInputRef}
        units={Array.isArray(units.data?.data) ? units.data.data : []}
        unitsLoading={units.isPending}
        unitsError={units.isError ? units.error : null}
        onRetryUnits={() => units.refetch()}
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {showAi && (
        <AiResults
          question={ask}
          search={ai}
          filters={urlFilters}
          confirmed={confirmed}
          onConfirm={confirmAsk}
          onClearFilters={resetAiFilters}
          onUseKeywords={useKeywords}
        />
      )}

      {!showAi && (
        <section aria-labelledby="explore-results-heading" className="space-y-4" ref={resultsRef}>
          {aiFallback && <AiFallbackNote error={fallbackError} question={ask} onRetry={retryAi} retrying={ai.isFetching} />}
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
              title={
                aiFallback ? 'No keyword matches either' : filtered ? 'Nothing matches these filters' : 'No resources listed yet'
              }
              description={
                aiFallback
                  ? 'No resource matches these words by keyword. Try fewer or different words, or ask again later.'
                  : filters.eligibleOnly
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
              {/* Keyed by the page of the cards shown (the list keeps the previous page's cards while the
                  next loads), so the next page's cards come in one after another once they arrive. */}
              <StaggerList
                key={meta?.page ?? filters.page}
                data-tour="explore-results"
                aria-busy={list.isFetching || undefined}
                className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}
              >
                {items.map((resource) => (
                  <StaggerItem key={resource._id}>
                    <ResourceCard resource={resource} />
                  </StaggerItem>
                ))}
              </StaggerList>
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
      )}
    </div>
  );
}
