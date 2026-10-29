import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Sparkles, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { press, spring } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { errorMessage } from '../../../lib/errors';
import { groupUnits } from '../../verification/api';
import { SEARCH_MAX_LENGTH } from '../api';
import { CATEGORY_OPTIONS } from '../format';
import { AiAskForm } from './AiAskForm';

// Explore's filters (frontend.md §6.2): search, category (the backend enum, readable labels), unit
// (GET /org-units) and "only what I can book" (eligibleOnly=true). `filters` is read from the URL by
// the page; every change goes to onChange(patch, { replace }). "All" is an empty value: the page
// leaves that key out of the request. With onAskModeChange, a switch above the box swaps the keyword
// search for "Ask in your own words" (AiAskForm, the page's ?ask): askMode, ask and onAsk(question).
// The text in either box goes with the switch: onAskModeChange(next, text) gets the AI box's text when
// going back to keywords. `searchInputRef` points at whichever box is shown.

const SEARCH_DELAY_MS = 400;

// A category pill. The active one's green box is a shared layoutId, so it slides to the pill you
// pick. It sits behind the label (isolate + -z-10: above the pill's own background, below its text)
// and covers the border, so active and inactive pills are the same size and nothing reflows.
function CategoryPill({ active, onClick, layoutId, children }) {
  return (
    <motion.button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      {...press}
      className={cn(
        'relative isolate px-3 py-2 min-h-[40px] text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
        active
          ? 'text-white border-transparent'
          : 'bg-[#ede8df] text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
      )}
    >
      {children}
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={spring}
          aria-hidden="true"
          className="absolute -inset-[2px] -z-10 rounded-md border-2 border-[#1a1a1a] bg-[#183d2d] shadow-[2px_2px_0_#1a1a1a]"
        />
      )}
    </motion.button>
  );
}

// One side of the keyword / AI switch: a pressed toggle, so the pair reads as "Keyword search,
// pressed" and "Ask in your own words, not pressed".
function ModeButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-bold font-mono rounded-md border-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
        active
          ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
          : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
      )}
    >
      {children}
    </button>
  );
}

export function ResourceFilters({
  filters,
  onChange,
  onReset,
  units = [],
  unitsLoading = false,
  unitsError = null,
  onRetryUnits,
  hasFilters = false,
  askMode = false,
  ask = '',
  onAsk,
  onAskModeChange,
  searchInputRef,
}) {
  const ids = useId();
  const searchId = `${ids}-search`;
  const pillId = `${ids}-active-category`;
  const eligibleId = `${ids}-eligible`;
  const eligibleHintId = `${ids}-eligible-hint`;

  // The search box types into local state and reaches the URL after a short pause (or at once on
  // Enter). When the URL's q changes from elsewhere (reset, back button), the box follows it.
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const [sentQ, setSentQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    if (filters.q !== sentQ) {
      setDraft(filters.q);
      setSentQ(filters.q);
    }
  }
  // Typing waits for a pause before it reaches the URL (replacing the history entry, so Back
  // doesn't step through every letter); Enter, Search and Clear apply at once.
  const timerRef = useRef(null);
  const ownSearchRef = useRef(null);
  const searchRef = searchInputRef ?? ownSearchRef;

  // The AI box's text, which follows the URL's question when that changes from elsewhere (Back).
  const [askDraft, setAskDraft] = useState(ask);
  const [seenAsk, setSeenAsk] = useState(ask);
  if (ask !== seenAsk) {
    setSeenAsk(ask);
    if (ask) setAskDraft(ask);
  }
  const switchMode = (next) => {
    if (next === askMode) return;
    clearTimeout(timerRef.current);
    if (next) setAskDraft(ask || draft);
    onAskModeChange(next, next ? '' : askDraft);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const send = (value, options) => {
    clearTimeout(timerRef.current);
    setSentQ(value.trim());
    onChange({ q: value }, options);
  };
  const type = (value) => {
    setDraft(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => send(value, { replace: true }), SEARCH_DELAY_MS);
  };
  const applySearch = (value) => {
    setDraft(value);
    if (value.trim() === filters.q.trim()) {
      clearTimeout(timerRef.current);
      return;
    }
    send(value);
  };
  // The clear buttons go away once there is nothing to clear: each moves focus to the search box,
  // so a keyboard user isn't dropped to <body> (frontend.md §10.3).
  const clearSearch = () => {
    applySearch('');
    searchRef.current?.focus();
  };
  const reset = () => {
    clearTimeout(timerRef.current);
    onReset?.();
    searchRef.current?.focus();
  };

  const groups = groupUnits(units);

  return (
    <section
      aria-label="Filters"
      className="bg-white border-2 border-[#1a1a1a] rounded-xl p-4 shadow-[4px_4px_0_#1a1a1a] space-y-4 font-mono text-[#1a1a1a]"
    >
      <div className="flex flex-col md:flex-row gap-3 md:items-start">
        <div data-tour="explore-search" className="flex-1 flex flex-col gap-2">
          {onAskModeChange && (
            <div role="group" aria-label="Search mode" className="flex flex-wrap gap-1.5">
              <ModeButton active={!askMode} onClick={() => switchMode(false)}>
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
                Keyword search
              </ModeButton>
              <ModeButton active={askMode} onClick={() => switchMode(true)}>
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Ask in your own words
              </ModeButton>
            </div>
          )}
          {askMode ? (
            <AiAskForm value={askDraft} onValueChange={setAskDraft} onAsk={onAsk} inputRef={searchRef} />
          ) : (
            <form
              role="search"
              className="flex-1 flex flex-col gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                applySearch(draft);
              }}
            >
              <label htmlFor={searchId} className="text-sm font-bold tracking-tight">
                Search resources
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1a1a1a]/60 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    ref={searchRef}
                    id={searchId}
                    type="search"
                    value={draft}
                    maxLength={SEARCH_MAX_LENGTH}
                    onChange={(event) => type(event.target.value)}
                    placeholder="3D printer, oscilloscope, lathe…"
                    className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono placeholder:text-[#1a1a1a]/60 focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1 [&::-webkit-search-cancel-button]:hidden"
                  />
                  {draft && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      aria-label="Clear the search"
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <Button type="submit" variant="outline" size="md" className="bg-white shrink-0">
                  Search
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className={cn('w-full md:w-72', onAskModeChange && 'md:pt-11')}>
          <Select
            label="Unit"
            value={filters.orgUnit}
            onChange={(event) => onChange({ orgUnit: event.target.value })}
            hint={unitsLoading ? 'Loading units…' : undefined}
            error={unitsError ? `Couldn't load the units: ${errorMessage(unitsError)}` : undefined}
          >
            <option value="">All units</option>
            {groups.map((group) => (
              <optgroup key={group.type} label={group.label}>
                {group.units.map((unit) => (
                  <option key={unit._id} value={unit._id}>
                    {unit.name}
                    {unit.code ? ` (${unit.code.toUpperCase()})` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {unitsError && onRetryUnits && (
            <button
              type="button"
              onClick={onRetryUnits}
              className="mt-1 text-xs font-bold underline text-[#a93226] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] rounded-sm"
            >
              Try loading the units again
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-3 border-t border-[#1a1a1a]/15">
        <div role="group" aria-label="Category" data-tour="explore-categories" className="flex flex-wrap items-center gap-1.5">
          <CategoryPill active={!filters.category} onClick={() => onChange({ category: '' })} layoutId={pillId}>
            All categories
          </CategoryPill>
          {CATEGORY_OPTIONS.map((option) => {
            const active = filters.category === option.value;
            return (
              <CategoryPill
                key={option.value}
                active={active}
                onClick={() => onChange({ category: active ? '' : option.value })}
                layoutId={pillId}
              >
                {option.label}
              </CategoryPill>
            );
          })}
        </div>

        <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 shrink-0">
          <div className="flex items-start gap-2" data-tour="explore-eligible">
            <input
              id={eligibleId}
              type="checkbox"
              checked={filters.eligibleOnly}
              onChange={(event) => onChange({ eligibleOnly: event.target.checked })}
              aria-describedby={eligibleHintId}
              className="mt-0.5 w-5 h-5 accent-[#183d2d] border-2 border-[#1a1a1a] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
            />
            <div>
              <label htmlFor={eligibleId} className="text-xs font-bold cursor-pointer select-none">
                Only show what I can book
              </label>
              <p id={eligibleHintId} className="text-[11px] text-[#1a1a1a]/75 max-w-[17rem]">
                The checks of each resource's checklist that don't need a time.
              </p>
            </div>
          </div>
          {/* Always rendered, so its space is kept and the box doesn't grow when a filter comes on.
              With nothing to clear it is invisible (visibility: hidden takes it out of the tab order
              and the pointer's reach) and aria-hidden; Button's transition fades it. Not `disabled`:
              Button's disabled:opacity-50 would fight opacity-0 (cn() doesn't merge classes). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('min-h-[40px] underline', hasFilters ? 'opacity-100 visible' : 'opacity-0 invisible')}
            onClick={reset}
            aria-hidden={!hasFilters || undefined}
          >
            Clear filters
          </Button>
        </div>
      </div>
    </section>
  );
}
