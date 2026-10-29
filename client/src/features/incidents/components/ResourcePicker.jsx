import React, { forwardRef, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useDebouncedValue } from '../../resources/hooks';
import { useReportableResources } from '../api';
import { ChoiceGroup } from './ChoiceGroup';
import { toPick } from './incidentView';

const STATUS_NOTES = { maintenance: 'under maintenance', archived: 'archived' };

const optionOf = (pick) => ({
  value: pick._id,
  label: pick.title,
  description: [pick.unit, STATUS_NOTES[pick.status]].filter(Boolean).join(' · ') || undefined,
});

/**
 * Choosing the resource of a report without a booking (managers and admins, api.md POST
 * /incidents). The list is GET /resources?status=active,maintenance, which the server limits to a
 * manager's own units; a search narrows it. `value` is the chosen { _id, title, unit, status } or
 * null; it stays listed while a search hides it. The ref goes to the search box.
 */
export const ResourcePicker = forwardRef(function ResourcePicker({ value, onChange, error, disabled }, ref) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const list = useReportableResources({ q, limit: 20 });
  const found = (Array.isArray(list.data?.data) ? list.data.data : []).map(toPick).filter(Boolean);
  const total = Number(list.data?.meta?.total) || found.length;
  const picks = value && !found.some((pick) => pick._id === value._id) ? [value, ...found] : found;
  const byId = new Map(picks.map((pick) => [pick._id, pick]));

  return (
    <div className="space-y-3 font-mono text-[#1a1a1a]">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-search`} className="text-sm font-bold tracking-tight">
          Find the resource
        </label>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1a1a1a]/60" aria-hidden="true" />
          <input
            ref={ref}
            id={`${ids}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // The picker sits inside the report form: Enter searches, it doesn't send the report.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            maxLength={100}
            disabled={disabled}
            placeholder="e.g. 3D printer"
            aria-describedby={`${ids}-search-hint`}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono placeholder:text-[#1a1a1a]/40 focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1"
          />
        </div>
        <p id={`${ids}-search-hint`} className="text-xs text-[#1a1a1a]/70">
          Resources of the units you manage (admins: every unit), active or under maintenance.
        </p>
      </div>

      {list.isPending && (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading resources…</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {list.isError && (
        <ErrorState
          error={list.error}
          title="Couldn't load the resources"
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      )}

      {list.isSuccess && picks.length === 0 && (
        <p className="text-sm text-[#1a1a1a]/70" role="status">
          {q ? `No resource matches “${q}”. Try another word.` : 'There are no resources in your units to report on.'}
        </p>
      )}

      {(picks.length > 0 || error) && (
        <ChoiceGroup
          legend="Resource"
          name={`${ids}-resource`}
          columns={1}
          options={picks.map(optionOf)}
          value={value?._id ?? null}
          onChange={(id) => onChange?.(byId.get(id) ?? null)}
          error={error}
          disabled={disabled}
          hint={
            total > found.length
              ? `Showing ${found.length} of ${total}. Search to narrow it down.`
              : undefined
          }
        />
      )}
      {list.isFetching && !list.isPending && (
        <p className="sr-only" role="status">
          Updating the list…
        </p>
      )}
    </div>
  );
});
