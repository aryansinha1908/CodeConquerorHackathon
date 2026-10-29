import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Pagination } from '../../components/ui/Pagination';
import { pageCount } from '../../lib/paging';
import { LinkButton, ListSkeleton } from '../manage/components/Bits';
import {
  INCIDENT_PAGE_SIZE,
  hasCustomFilters,
  readIncidentFilters,
  useIncidents,
  writeIncidentFilters,
} from './api';
import { IncidentCard } from './components/IncidentCard';
import { IncidentFilters } from './components/IncidentFilters';

// /manage/incidents (frontend.md §6.3: the incidents of the manager's units) and /admin/incidents
// (§6.4 "Escalations": every unit, high severity by default). GET /incidents filtered by status
// (one, or "open,in_review"), type, severity and resource, newest first, with paging. The filters
// and the page live in the URL, so a reload or a shared link keeps them. Both scopes sit under a
// layout with its own h1, so this page's heading is an h2.

const COPY = {
  manage: {
    eyebrow: 'Incidents',
    title: () => 'Incidents in your units',
    description:
      'Reports from borrowers, from return checks and from the overdue sweep. Open one to reply in its thread or resolve it; high-severity incidents are resolved by an admin.',
    empty: {
      title: 'No incidents here',
      description: 'Nothing matches these filters. New reports for your units appear here.',
    },
  },
  admin: {
    eyebrow: 'Escalations',
    title: (filters) => (filters.severity === 'high' ? 'High-severity incidents' : 'Incidents across every unit'),
    description:
      'High-severity incidents wait for an admin; the rest are usually handled by their unit’s managers. Change the severity to see them all.',
    empty: {
      title: 'Nothing to escalate',
      description: 'No incident matches these filters.',
    },
  },
};

export default function IncidentListPage({ scope = 'manage' }) {
  const copy = COPY[scope] ?? COPY.manage;
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readIncidentFilters(searchParams, scope);
  const { page } = filters;

  const list = useIncidents({ ...filters, limit: INCIDENT_PAGE_SIZE });
  const items = Array.isArray(list.data?.data) ? list.data.data.filter((i) => i && i._id) : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, INCIDENT_PAGE_SIZE);

  const update = (patch, options) =>
    setSearchParams((current) => writeIncidentFilters(current, patch, scope), options);
  // "Back to the default filters" and "Show every severity" go away once pressed: focus moves to
  // the heading, after the render that gives it the new title.
  const headingRef = useRef(null);
  const [focusHeading, setFocusHeading] = useState(0);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);
  const reset = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      for (const key of ['status', 'type', 'severity', 'resourceId', 'page']) params.delete(key);
      return params;
    });
    setFocusHeading((n) => n + 1);
  };
  const showEverySeverity = () => {
    update({ severity: '' });
    setFocusHeading((n) => n + 1);
  };

  // A filter change or a resolve can leave the page past the last one: step back to the last.
  const settled = list.isSuccess && !list.isPlaceholderData;
  useEffect(() => {
    if (settled && page > pages) {
      setSearchParams((current) => writeIncidentFilters(current, { page: pages }, scope), { replace: true });
    }
  }, [settled, page, pages, setSearchParams, scope]);

  const custom = hasCustomFilters(filters, scope);
  const showAllSeverities = scope === 'admin' && filters.severity === 'high';

  return (
    <section aria-labelledby="incidents-heading" className="space-y-5 font-mono text-[#1a1a1a]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b-2 border-[#1a1a1a] pb-4">
        <div className="min-w-0">
          <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">{copy.eyebrow}</span>
          <h2 id="incidents-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">
            {copy.title(filters)}
          </h2>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">{copy.description}</p>
        </div>
        <LinkButton to="/incidents/new" variant="outline" className="shrink-0 self-start md:self-auto">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Report an incident
        </LinkButton>
      </div>

      <IncidentFilters filters={filters} onChange={(patch) => update(patch)} onReset={reset} canReset={custom} />

      {/* Only the count is live: a background refetch isn't announced. */}
      <p className="text-xs text-[#1a1a1a]/70">
        <span role="status" aria-live="polite">
          {list.isSuccess ? `${total} ${total === 1 ? 'incident' : 'incidents'}` : ''}
        </span>
        {list.isFetching && list.isSuccess && <span aria-hidden="true"> · updating…</span>}
      </p>

      {list.isPending && <ListSkeleton label="Loading incidents…" rows={3} />}

      {list.isError && (
        <ErrorState
          error={list.error}
          title={list.data ? "Couldn't refresh the incidents" : "Couldn't load the incidents"}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        >
          {list.data ? 'The list below may be out of date.' : null}
        </ErrorState>
      )}

      {list.isSuccess && items.length === 0 && (
        <div className="space-y-3">
          <EmptyState icon={ShieldCheck} title={copy.empty.title} description={copy.empty.description} />
          {showAllSeverities && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" size="sm" className="min-h-[44px] bg-white" onClick={showEverySeverity}>
                Show every severity
              </Button>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className={`space-y-4 ${list.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={list.isPlaceholderData || undefined}>
          {items.map((incident) => (
            <IncidentCard key={String(incident._id)} incident={incident} scope={scope} Heading="h3" />
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pages}
        onPageChange={(next) => update({ page: next })}
        busy={list.isFetching}
        label="Incident pages"
      />
    </section>
  );
}
