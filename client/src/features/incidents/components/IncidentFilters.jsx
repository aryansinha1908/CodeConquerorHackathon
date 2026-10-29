import React from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, STATUS_FILTERS, useFilterResources } from '../api';

/**
 * The incident lists' filters (frontend.md §6.3: status, incl. "open,in_review", type, severity,
 * resource). Each select applies at once through `onChange(patch)`; the page keeps them in the URL.
 * The resource options are the viewer's units' resources (admins: every unit's), up to 50; a
 * resource from the URL that isn't among them still shows as chosen.
 */
export function IncidentFilters({ filters, onChange, onReset, canReset = false }) {
  const resources = useFilterResources();
  const list = Array.isArray(resources.data?.data) ? resources.data.data : [];
  const total = Number(resources.data?.meta?.total) || list.length;
  const known = list.some((r) => String(r?._id) === filters.resourceId);

  return (
    <div
      role="group"
      aria-label="Filter incidents"
      className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[3px_3px_0_#1a1a1a] space-y-3 font-mono"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Select
          label="Status"
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value })}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select label="Severity" value={filters.severity} onChange={(event) => onChange({ severity: event.target.value })}>
          <option value="">Any severity</option>
          {INCIDENT_SEVERITIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select label="Type" value={filters.type} onChange={(event) => onChange({ type: event.target.value })}>
          <option value="">Any type</option>
          {INCIDENT_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          label="Resource"
          value={filters.resourceId}
          onChange={(event) => onChange({ resourceId: event.target.value })}
          hint={
            resources.isError
              ? "Couldn't load the resources for this filter."
              : total > list.length
                ? `The first ${list.length} of ${total}, by title.`
                : undefined
          }
        >
          <option value="">Any resource</option>
          {filters.resourceId && !known && <option value={filters.resourceId}>The resource from the link</option>}
          {list.map((resource) => (
            <option key={String(resource._id)} value={String(resource._id)}>
              {typeof resource.title === 'string' ? resource.title : 'Resource'}
              {resource.status && resource.status !== 'active' ? ` (${resource.status})` : ''}
            </option>
          ))}
        </Select>
      </div>
      {canReset && (
        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={onReset}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Back to the default filters
        </Button>
      )}
    </div>
  );
}
