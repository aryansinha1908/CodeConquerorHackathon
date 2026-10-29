import React, { useId, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { cn } from '../../../lib/utils';
import { cellStartingAt, describeCell, isCellSelected, isSelectable } from '../slots';

// The next 7 days of a resource as a day × time-slot grid (frontend.md §7 AvailabilityGrid, §10.3):
// a role="grid" table with one roving tab stop, arrow keys to move, Home / End along a row,
// Page Up / Page Down by an hour or so, and Enter or Space to pick. `model` comes from slots.js
// buildSlotGrid; picks go to `onPick(cell)` and the page turns them into a selection (pickCell).
// Busy slots show how many units are in use, never who holds them.

// A free cell has no glyph, so its solid border is what sets it apart from past and closed ones
// (WCAG 1.4.11: 3:1; at 50% alpha it was 2.8:1 on white).
const STATE_CLASSES = {
  free: 'bg-[#f0faf5] border-[#183d2d] text-[#183d2d] hover:bg-[#d4efdf] cursor-pointer',
  partial: 'bg-[#fdebd0] border-[#b9470b] text-[#1a1a1a] hover:bg-[#fad7a0] cursor-pointer',
  full: 'bg-[#1a1a1a] border-[#1a1a1a] text-white hover:bg-[#333333] cursor-pointer',
  past: 'bg-[#ede8df] border-transparent text-[#1a1a1a]/50 cursor-not-allowed',
  closed: 'bg-[#d9d3c7] border-transparent text-[#1a1a1a]/50 cursor-not-allowed',
  blackout: 'border-[#c0392b]/60 text-[#a93226] cursor-not-allowed',
};
const SELECTED_CLASS = 'bg-[#c0392b] border-[#1a1a1a] text-white shadow-[1px_1px_0_#1a1a1a]';
const HATCH = {
  backgroundImage: 'repeating-linear-gradient(45deg, #fbe3df 0 4px, #ffffff 4px 8px)',
};

const LEGEND = [
  { state: 'free', label: 'Free' },
  { state: 'partial', label: 'Some units in use' },
  { state: 'full', label: 'Taken (waitlist)', glyph: 'FULL' },
  { state: 'selected', label: 'Your pick', glyph: '✓' },
  { state: 'blackout', label: 'Closure', glyph: '×' },
  { state: 'closed', label: 'Closed' },
  { state: 'past', label: 'Past' },
];

function glyphFor(cell, quantity, selected) {
  if (selected) return '✓';
  if (cell.state === 'full') return 'FULL';
  if (cell.state === 'partial') return `${cell.inUse}/${quantity}`;
  if (cell.state === 'blackout') return '×';
  return '';
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] font-bold" aria-label="Legend">
      {LEGEND.map((item) => (
        <li key={item.state} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            style={item.state === 'blackout' ? HATCH : undefined}
            className={cn(
              'w-5 h-4 rounded border-2 inline-flex items-center justify-center text-[8px] leading-none',
              item.state === 'selected' ? SELECTED_CLASS : STATE_CLASSES[item.state]
            )}
          >
            {item.glyph ?? ''}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function GridSkeleton() {
  return (
    <div role="status" className="space-y-2">
      <span className="sr-only">Loading availability…</span>
      <div className="grid grid-cols-8 gap-1.5" aria-hidden="true">
        {Array.from({ length: 40 }, (_, n) => (
          <Skeleton key={n} className="h-8" />
        ))}
      </div>
    </div>
  );
}

export function AvailabilityGrid({
  model,
  selection = null,
  anchor = null,
  onPick,
  loading = false,
  error = null,
  onRetry,
  retrying = false,
  headingLevel = 'h2',
  className,
}) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const helpId = `${ids}-help`;
  const Heading = headingLevel;
  const cellRefs = useRef(new Map());
  const [focusKey, setFocusKey] = useState(null);

  const days = Array.isArray(model?.days) ? model.days : [];
  const rows = Array.isArray(model?.rows) ? model.rows : [];
  const quantity = model?.quantity ?? 1;
  const hasGrid = days.length > 0 && rows.length > 0;

  // One tab stop: the cell last focused, else the selection's first slot, else the first open slot.
  const exists = (key) => {
    if (!key) return false;
    const [d, r] = key.split('-').map(Number);
    return d >= 0 && d < days.length && r >= 0 && r < rows.length;
  };
  let activeKey = exists(focusKey) ? focusKey : null;
  if (!activeKey && selection) activeKey = cellStartingAt(model, selection.start)?.key ?? null;
  if (!activeKey) {
    for (const day of days) {
      const open = day.cells.find(isSelectable);
      if (open) {
        activeKey = open.key;
        break;
      }
    }
  }
  if (!activeKey && hasGrid) activeKey = '0-0';

  const moveTo = (dayIndex, rowIndex) => {
    const d = Math.min(Math.max(dayIndex, 0), days.length - 1);
    const r = Math.min(Math.max(rowIndex, 0), rows.length - 1);
    const key = `${d}-${r}`;
    setFocusKey(key);
    cellRefs.current.get(key)?.focus();
  };

  const pageStep = Math.max(1, Math.round(60 / (model?.slotMinutes || 30)) * 2);

  const handleKeyDown = (event, cell) => {
    const { dayIndex: d, rowIndex: r } = cell;
    switch (event.key) {
      case 'ArrowRight':
        moveTo(d + 1, r);
        break;
      case 'ArrowLeft':
        moveTo(d - 1, r);
        break;
      case 'ArrowDown':
        moveTo(d, r + 1);
        break;
      case 'ArrowUp':
        moveTo(d, r - 1);
        break;
      case 'Home':
        if (event.ctrlKey || event.metaKey) moveTo(0, 0);
        else moveTo(0, r);
        break;
      case 'End':
        if (event.ctrlKey || event.metaKey) moveTo(days.length - 1, rows.length - 1);
        else moveTo(days.length - 1, r);
        break;
      case 'PageDown':
        moveTo(d, r + pageStep);
        break;
      case 'PageUp':
        moveTo(d, r - pageStep);
        break;
      case 'Enter':
      case ' ':
        if (isSelectable(cell)) onPick?.(cell);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const register = (key) => (element) => {
    if (element) cellRefs.current.set(key, element);
    else cellRefs.current.delete(key);
  };

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'rounded-xl border-2 border-[#1a1a1a] bg-white p-4 sm:p-5 font-mono text-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a] space-y-4',
        className
      )}
    >
      <div className="flex flex-col gap-3 pb-3 border-b-2 border-[#1a1a1a]/15">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-[#183d2d]" aria-hidden="true" />
          <Heading id={headingId} className="text-base font-black tracking-tight">
            Availability: the next 7 days
          </Heading>
        </div>
        <p id={helpId} className="text-xs text-[#1a1a1a]/75 leading-relaxed">
          Times are IST{model?.slotMinutes ? `, in ${model.slotMinutes}-minute slots` : ''}. Pick a
          start slot, then the slot it ends with (pick the same slot again for just one). On a
          keyboard, the arrow keys move and Enter or Space picks.
          {anchor ? ' Start chosen: now pick where it ends.' : ''}
        </p>
        <Legend />
      </div>

      {loading && !model && <GridSkeleton />}

      {error && !model && (
        <ErrorState
          error={error}
          title="Couldn't load the availability"
          onRetry={onRetry}
          retrying={retrying}
        />
      )}

      {model && !hasGrid && (
        <p className="p-4 rounded-lg border-2 border-dashed border-[#1a1a1a]/40 bg-[#f5f0e8] text-sm">
          This resource has no opening hours in the next 7 days.
        </p>
      )}

      {hasGrid && (
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <table
            role="grid"
            aria-labelledby={headingId}
            aria-describedby={helpId}
            aria-rowcount={rows.length + 1}
            aria-colcount={days.length + 1}
            className="w-full min-w-[420px] border-separate border-spacing-1 text-[10px]"
          >
            <thead>
              <tr>
                <th scope="col" className="w-12 text-left font-bold text-[#1a1a1a]/70 uppercase px-1">
                  Time
                </th>
                {days.map((day) => (
                  <th
                    key={day.dateKey}
                    scope="col"
                    className={cn(
                      'p-1 text-center rounded border-2 border-[#1a1a1a] font-bold',
                      day.isToday ? 'bg-[#183d2d] text-white' : 'bg-[#ede8df]'
                    )}
                  >
                    <span className="block uppercase tracking-wider">{day.isToday ? 'Today' : day.weekday}</span>
                    <span className="block text-[11px] font-black">{day.date}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.minute}>
                  <th scope="row" className="text-left font-bold text-[#1a1a1a]/75 px-1 tabular-nums whitespace-nowrap">
                    {row.label}
                  </th>
                  {days.map((day) => {
                    const cell = day.cells[row.index];
                    const selectable = isSelectable(cell);
                    const selected = isCellSelected(cell, selection);
                    const isAnchor = Boolean(anchor) && anchor.key === cell.key;
                    const label = `${describeCell(cell, quantity)}${selected ? ', selected' : ''}${
                      isAnchor ? ', start of your pick' : ''
                    }`;
                    return (
                      <td
                        key={cell.key}
                        ref={register(cell.key)}
                        role="gridcell"
                        tabIndex={cell.key === activeKey ? 0 : -1}
                        aria-selected={selected}
                        aria-disabled={selectable ? undefined : true}
                        aria-label={label}
                        title={label}
                        onFocus={() => setFocusKey(cell.key)}
                        onClick={() => {
                          setFocusKey(cell.key);
                          if (selectable) onPick?.(cell);
                        }}
                        onKeyDown={(event) => handleKeyDown(event, cell)}
                        style={cell.state === 'blackout' && !selected ? HATCH : undefined}
                        className={cn(
                          'h-8 min-w-[44px] rounded border-2 text-center align-middle font-bold leading-none select-none transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a1a1a] focus-visible:ring-offset-1',
                          selected ? SELECTED_CLASS : STATE_CLASSES[cell.state],
                          isAnchor && 'ring-2 ring-[#f1c40f] ring-offset-1'
                        )}
                      >
                        <span aria-hidden="true">{glyphFor(cell, quantity, selected)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
