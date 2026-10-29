import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, FileText, Filter, RotateCcw, Search, UserRound } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { pageCount } from '../../lib/paging';
import { formatIstDate, formatIstDateTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { useDebouncedValue } from '../resources/hooks';
import { useOrgUnits } from '../resources/api';
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ENTITY_TYPES,
  AUDIT_PAGE_SIZE,
  actionLabel,
  actorLabel,
  auditFieldErrors,
  changeRows,
  entityPath,
  entityTypeLabel,
  hasAuditFilters,
  metaRows,
  readAuditFilters,
  shortId,
  useAuditLog,
  useUserSearch,
  validateAuditFilters,
  writeAuditFilters,
} from './auditApi';

// /admin/audit (frontend.md §6.4 "Audit log", F-15; judge step 12): GET /audit as a table, newest
// first, filtered by entity type and id, actor, action, unit and IST dates ([from, the day after
// to)), with paging. A row expands to its before → after changes and meta. The filters live in the
// URL, so ?entityType=booking&entityId=… opens one booking's history (the booking pages link here).

const linkClass =
  'font-bold text-[#183d2d] underline underline-offset-2 hover:text-[#c0392b] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-1';

const EMPTY_FILTERS = { entityType: '', entityId: '', actorId: '', action: '', orgUnit: '', from: '', to: '' };

// ── Find a person for the actor filter (GET /admin/users?q) ─────────────────

function ActorSearch({ onPick }) {
  const ids = useId();
  const detailsRef = useRef(null);
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const search = useUserSearch(q);
  const people = Array.isArray(search.data?.data) ? search.data.data.filter((p) => p && p._id) : [];
  return (
    <details ref={detailsRef} className="rounded-lg border-2 border-[#1a1a1a]/30 bg-[#f5f0e8] px-3 py-2">
      <summary className="cursor-pointer text-xs font-bold py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]">
        Find a person by name or email
      </summary>
      <div className="mt-2 space-y-2">
        <label htmlFor={`${ids}-q`} className="sr-only">
          Name or email
        </label>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1a1a1a]/60" aria-hidden="true" />
          <input
            id={`${ids}-q`}
            type="search"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            // Inside the filter form: Enter searches people, it doesn't apply the filters.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            placeholder="Name or email"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
          />
        </div>
        <div role="status" className="text-xs">
          {q.length > 0 && q.length < 2 && <p className="text-[#1a1a1a]/70">Type at least 2 characters.</p>}
          {search.isFetching && <p className="text-[#1a1a1a]/70">Searching…</p>}
          {search.isSuccess && q.length >= 2 && people.length === 0 && <p>Nobody matches “{q}”.</p>}
        </div>
        <ErrorState error={search.error} title="Couldn't search people" />
        {people.length > 0 && (
          <ul className="space-y-1">
            {people.map((person) => (
              <li key={String(person._id)}>
                <button
                  type="button"
                  onClick={() => {
                    // The list closes and the parent moves focus to the filled Actor id field.
                    if (detailsRef.current) detailsRef.current.open = false;
                    onPick(person);
                  }}
                  className="w-full text-left px-3 py-2 min-h-[44px] rounded-md border-2 border-[#1a1a1a]/30 bg-white hover:border-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                >
                  <span className="block text-sm font-bold">{typeof person.name === 'string' ? person.name : 'Unnamed'}</span>
                  <span className="block text-xs text-[#1a1a1a]/70 break-all">
                    {typeof person.email === 'string' ? person.email : ''}
                    {Array.isArray(person.roles) && person.roles.length ? ` · ${person.roles.join(', ')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────

function FilterForm({ filters, serverErrors, onApply, onClear }) {
  const [draft, setDraft] = useState(() => ({ ...EMPTY_FILTERS, ...filters }));
  const [errors, setErrors] = useState({});
  const [picked, setPicked] = useState(''); // "Actor set to …", said once a person is chosen
  // When the URL's filters change (applied here, a row's "Only this …", Clear, the browser's back)
  // the draft follows them. The form stays mounted, so the control that had focus keeps it; the
  // page number isn't part of this, so paging keeps what is being typed.
  const urlKey = JSON.stringify({ ...filters, page: undefined });
  const [syncedKey, setSyncedKey] = useState(urlKey);
  if (syncedKey !== urlKey) {
    setSyncedKey(urlKey);
    setDraft({ ...EMPTY_FILTERS, ...filters });
    setErrors({});
    setPicked('');
  }
  const units = useOrgUnits();
  const unitList = Array.isArray(units.data?.data) ? units.data.data : [];
  const refs = useRef({});
  const knownType = AUDIT_ENTITY_TYPES.some((t) => t.value === draft.entityType);
  const knownAction = AUDIT_ACTION_GROUPS.some((g) => g.actions.includes(draft.action));
  const knownUnit = unitList.some((u) => String(u._id) === draft.orgUnit);
  // A filter from the URL that the server or the checks refuse shows beside its field.
  const shown = { ...validateAuditFilters(filters), ...serverErrors, ...errors };

  const set = (key) => (value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (key === 'actorId') setPicked('');
  };

  const pickActor = (person) => {
    set('actorId')(String(person._id));
    const name = typeof person.name === 'string' && person.name ? person.name : 'this person';
    setPicked(`Actor set to ${name}. Apply the filters to see what they did.`);
    refs.current.actorId?.focus();
  };

  const submit = (event) => {
    event.preventDefault();
    const found = validateAuditFilters(draft);
    setErrors(found);
    const first = Object.keys(EMPTY_FILTERS).find((key) => found[key]);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    onApply(draft);
  };

  const bind = (key) => ({
    ref: (node) => {
      refs.current[key] = node;
    },
    value: draft[key],
    error: shown[key] || undefined,
  });

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Filter the audit log"
      className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[3px_3px_0_#1a1a1a] space-y-4 font-mono"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Select label="Entity type" {...bind('entityType')} onChange={(e) => set('entityType')(e.target.value)}>
          <option value="">Any entity</option>
          {draft.entityType && !knownType && <option value={draft.entityType}>{draft.entityType}</option>}
          {AUDIT_ENTITY_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
        <Input
          label="Entity id"
          {...bind('entityId')}
          onChange={(e) => set('entityId')(e.target.value)}
          placeholder="24-character id"
          spellCheck={false}
          autoComplete="off"
          maxLength={64}
          className="font-mono"
        />
        <Select label="Action" {...bind('action')} onChange={(e) => set('action')(e.target.value)}>
          <option value="">Any action</option>
          {draft.action && !knownAction && <option value={draft.action}>{draft.action}</option>}
          {AUDIT_ACTION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select
          label="Unit"
          {...bind('orgUnit')}
          onChange={(e) => set('orgUnit')(e.target.value)}
          hint={units.isError ? "Couldn't load the units." : undefined}
        >
          <option value="">Any unit</option>
          {draft.orgUnit && !knownUnit && <option value={draft.orgUnit}>The unit from the link</option>}
          {unitList.map((unit) => (
            <option key={String(unit._id)} value={String(unit._id)}>
              {unit.name}
              {unit.code ? ` (${String(unit.code).toUpperCase()})` : ''}
            </option>
          ))}
        </Select>
        <div className="sm:col-span-2 space-y-2">
          <Input
            label="Actor id"
            {...bind('actorId')}
            onChange={(e) => set('actorId')(e.target.value)}
            placeholder="The person who acted"
            spellCheck={false}
            autoComplete="off"
            maxLength={64}
            hint="Or find them below; system actions have no actor id."
          />
          <ActorSearch onPick={pickActor} />
          <p role="status" className="text-xs font-bold text-[#183d2d]">
            {picked}
          </p>
        </div>
        <Input
          label="From (IST date)"
          type="date"
          {...bind('from')}
          onChange={(e) => set('from')(e.target.value)}
        />
        <Input
          label="To (IST date, included)"
          type="date"
          {...bind('to')}
          onChange={(e) => set('to')(e.target.value)}
          min={draft.from || undefined}
        />
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-[#1a1a1a]/15">
        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={onClear}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Clear all filters
        </Button>
        <Button type="submit" variant="forest" size="sm" className="min-h-[44px]">
          <Filter className="w-4 h-4" aria-hidden="true" />
          Apply filters
        </Button>
      </div>
    </form>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────

function EntryDetails({ entry, onOnly }) {
  const changes = changeRows(entry.changes);
  const meta = metaRows(entry.meta);
  const path = entityPath(entry.entity);
  const actorId = entry.actor?.id ? String(entry.actor.id) : null;
  return (
    <div className="space-y-4 text-xs">
      {entry.reason && (
        <p className="bg-white border-l-4 border-[#1a1a1a] rounded-r-md px-3 py-2 whitespace-pre-wrap break-words">
          <span className="font-bold">Reason: </span>“{String(entry.reason)}”
        </p>
      )}
      <div className="space-y-1">
        <p className="font-bold uppercase tracking-wider text-[11px]">Changes</p>
        {changes.length ? (
          <table className="w-full border-2 border-[#1a1a1a]/30 bg-white">
            <caption className="sr-only">Changes: each field before and after</caption>
            <thead>
              <tr className="bg-[#ede8df]">
                <th scope="col" className="text-left px-2 py-1">Field</th>
                <th scope="col" className="text-left px-2 py-1">Before</th>
                <th scope="col" className="px-1 py-1" aria-hidden="true" />
                <th scope="col" className="text-left px-2 py-1">After</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((row) => (
                <tr key={row.field} className="border-t border-[#1a1a1a]/15 align-top">
                  <th scope="row" className="text-left px-2 py-1 font-bold break-all">{row.field}</th>
                  <td className="px-2 py-1 break-all whitespace-pre-wrap">{row.before}</td>
                  <td className="px-1 py-1" aria-hidden="true">→</td>
                  <td className="px-2 py-1 break-all whitespace-pre-wrap">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[#1a1a1a]/70">No field changes recorded.</p>
        )}
      </div>
      <div className="space-y-1">
        <p className="font-bold uppercase tracking-wider text-[11px]">Meta</p>
        {meta.length ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {meta.map((row) => (
              <div key={row.key} className="min-w-0">
                <dt className="inline font-bold">{row.key}: </dt>
                <dd className="inline break-all">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[#1a1a1a]/70">No meta.</p>
        )}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-[#1a1a1a]/80">
        <div className="min-w-0">
          <dt className="inline font-bold">Entity: </dt>
          <dd className="inline break-all">
            {entityTypeLabel(entry.entity?.type)} {String(entry.entity?.id ?? '')}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="inline font-bold">Actor id: </dt>
          <dd className="inline break-all">{actorId ?? 'none (system)'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="inline font-bold">Request id: </dt>
          <dd className="inline break-all">{entry.requestId ? String(entry.requestId) : 'not recorded'}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {entry.entity?.id && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white min-h-[44px]"
            onClick={() => onOnly({ entityType: entry.entity.type, entityId: String(entry.entity.id) })}
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            Only this {entityTypeLabel(entry.entity.type).toLowerCase()}
          </Button>
        )}
        {actorId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white min-h-[44px]"
            onClick={() => onOnly({ actorId })}
          >
            <UserRound className="w-4 h-4" aria-hidden="true" />
            Only this actor
          </Button>
        )}
        {path && (
          <Link to={path} className={`${linkClass} inline-flex items-center gap-1 px-2 min-h-[44px] text-sm`}>
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
            Open the {entityTypeLabel(entry.entity.type).toLowerCase()}
          </Link>
        )}
      </div>
    </div>
  );
}

function AuditTable({ entries, onOnly, dimmed }) {
  const ids = useId();
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    // The table scrolls inside its frame on a narrow screen; the page itself never does.
    <div className={cn('overflow-x-auto rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a]', dimmed && 'opacity-60')}>
      <table className="w-full min-w-[760px] text-left text-xs font-mono">
        <caption className="sr-only">Audit entries, newest first. Expand a row for its changes and meta.</caption>
        <thead className="bg-[#ede8df] border-b-2 border-[#1a1a1a]">
          <tr>
            <th scope="col" className="px-3 py-2 w-10">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="px-3 py-2">When (IST)</th>
            <th scope="col" className="px-3 py-2">Action</th>
            <th scope="col" className="px-3 py-2">Actor</th>
            <th scope="col" className="px-3 py-2">Entity</th>
            <th scope="col" className="px-3 py-2">Unit</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const key = String(entry._id ?? index);
            const expanded = open.has(key);
            const detailsId = `${ids}-${index}`;
            const when = formatIstDateTime(entry.at);
            return (
              <React.Fragment key={key}>
                <tr className={cn('border-t border-[#1a1a1a]/15 align-top', expanded && 'bg-[#f5f0e8]')}>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      className="w-10 h-10 inline-flex items-center justify-center rounded-md border-2 border-[#1a1a1a]/40 bg-white hover:border-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                    >
                      {expanded ? (
                        <ChevronDown className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span className="sr-only">
                        {expanded ? 'Hide' : 'Show'} details of {String(entry.action ?? 'this entry')}
                        {when ? `, ${when}` : ''}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {when ? <time dateTime={String(entry.at)}>{when.replace(/ IST$/, '')}</time> : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-bold">{String(entry.action ?? '')}</span>
                    <span className="block text-[#1a1a1a]/70">{actionLabel(entry.action)}</span>
                    {entry.reason && (
                      <span className="block text-[#1a1a1a]/70 max-w-[240px] truncate" title={String(entry.reason)}>
                        “{String(entry.reason)}”
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 break-words max-w-[180px]">{actorLabel(entry.actor)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entityTypeLabel(entry.entity?.type)}{' '}
                    <span className="text-[#1a1a1a]/70" title={String(entry.entity?.id ?? '')}>
                      {shortId(entry.entity?.id)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {entry.orgUnit?.code ? (
                      <span title={entry.orgUnit.name ?? ''}>{String(entry.orgUnit.code).toUpperCase()}</span>
                    ) : (
                      <span className="text-[#1a1a1a]/70">—</span>
                    )}
                  </td>
                </tr>
                <tr id={detailsId} hidden={!expanded} className="bg-[#f5f0e8]">
                  <td />
                  <td colSpan={5} className="px-3 pb-4 pt-1">
                    {expanded && <EntryDetails entry={entry} onOnly={onOnly} />}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">Loading the audit log…</span>
      {[0, 1, 2, 3].map((n) => (
        <Skeleton key={n} className="h-12 w-full" />
      ))}
    </div>
  );
}

// "Showing: booking …a1b2c3 · actor Priya Manager · 3 Nov – 5 Nov": what the table is filtered by.
function FilterSummary({ filters, entries }) {
  const parts = [];
  if (filters.entityType || filters.entityId) {
    parts.push(
      `${filters.entityType ? entityTypeLabel(filters.entityType).toLowerCase() : 'entity'}${
        filters.entityId ? ` ${shortId(filters.entityId)}` : 's'
      }`
    );
  }
  if (filters.action) parts.push(`action ${filters.action}`);
  if (filters.actorId) {
    const name = entries.find((e) => String(e.actor?.id ?? '') === filters.actorId)?.actor?.name;
    parts.push(`actor ${name ?? shortId(filters.actorId)}`);
  }
  if (filters.orgUnit) {
    const unit = entries.find((e) => String(e.orgUnit?._id ?? '') === filters.orgUnit)?.orgUnit;
    parts.push(`unit ${unit?.code ? String(unit.code).toUpperCase() : shortId(filters.orgUnit)}`);
  }
  if (filters.from || filters.to) {
    const from = filters.from ? formatIstDate(`${filters.from}T00:00:00+05:30`, { year: true }) : 'the start';
    const to = filters.to ? formatIstDate(`${filters.to}T00:00:00+05:30`, { year: true }) : 'now';
    parts.push(`${from} – ${to}`);
  }
  if (!parts.length) return null;
  return <span> · filtered by {parts.join(' · ')}</span>;
}

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readAuditFilters(searchParams);
  const problems = validateAuditFilters(filters);
  const invalid = Object.keys(problems).length > 0;
  const log = useAuditLog(filters);
  const entries = Array.isArray(log.data?.data) ? log.data.data.filter((e) => e && typeof e === 'object') : [];
  const meta = log.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, AUDIT_PAGE_SIZE);
  const serverErrors = auditFieldErrors(log.error);
  const filtered = hasAuditFilters(filters);
  const headingRef = useRef(null);
  const [focusHeading, setFocusHeading] = useState(0);

  const apply = (patch) => setSearchParams((current) => writeAuditFilters(current, patch));
  const clear = () => setSearchParams(new URLSearchParams());
  // A row's "Only this …" button goes away with the old rows: focus moves to the heading, after
  // the render that gives it the new filter ("History of booking …a1b2c3").
  const only = (patch) => {
    apply(patch);
    setFocusHeading((n) => n + 1);
  };
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);
  const entityPage = filters.entityType && filters.entityId ? entityPath({ type: filters.entityType, id: filters.entityId }) : null;

  return (
    <section aria-labelledby="audit-heading" className="space-y-5 font-mono text-[#1a1a1a]">
      <div className="border-b-2 border-[#1a1a1a] pb-4">
        <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">Audit log</span>
        <h2 id="audit-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">
          {filters.entityType && filters.entityId
            ? `History of ${entityTypeLabel(filters.entityType).toLowerCase()} ${shortId(filters.entityId)}`
            : 'Audit log'}
        </h2>
        <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">
          Every recorded action, newest first: who did it, in what role, when (IST) and why. Expand a
          row to see each field before and after. The log is append-only.
        </p>
        {entityPage && (
          <p className="text-sm mt-2">
            <Link to={entityPage} className={`${linkClass} inline-flex items-center gap-1`}>
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              Open the {entityTypeLabel(filters.entityType).toLowerCase()}
            </Link>
          </p>
        )}
      </div>

      <FilterForm
        filters={filters}
        serverErrors={serverErrors}
        onApply={(draft) => apply(draft)}
        onClear={clear}
      />

      {/* Only the count and filters are live: a background refetch isn't announced. */}
      <p className="text-xs text-[#1a1a1a]/70">
        <span role="status" aria-live="polite">
          {invalid
            ? 'Fix the highlighted filters to see the log.'
            : log.isSuccess
              ? (
                  <>
                    {total} {total === 1 ? 'entry' : 'entries'}
                    <FilterSummary filters={filters} entries={entries} />
                  </>
                )
              : ''}
        </span>
        {!invalid && log.isSuccess && log.isFetching && <span aria-hidden="true"> · updating…</span>}
      </p>

      {!invalid && log.isPending && <TableSkeleton />}

      {log.isError && (
        <ErrorState
          error={log.error}
          title={log.data ? "Couldn't refresh the audit log" : "Couldn't load the audit log"}
          onRetry={() => log.refetch()}
          retrying={log.isFetching}
        >
          {Object.keys(serverErrors).length ? 'The filters it refused are marked above.' : null}
        </ErrorState>
      )}

      {log.isSuccess && entries.length === 0 && (
        <EmptyState
          icon={FileText}
          title={filtered ? 'No entries match' : 'No entries yet'}
          description={
            filtered
              ? 'Nothing was recorded for these filters. Widen the dates or clear a filter.'
              : 'Actions appear here as people book, decide, hand over and resolve.'
          }
        />
      )}

      {entries.length > 0 && <AuditTable entries={entries} onOnly={only} dimmed={log.isPlaceholderData} />}

      <Pagination
        page={filters.page}
        pageCount={pages}
        onPageChange={(next) => apply({ page: next })}
        busy={log.isFetching}
        label="Audit log pages"
      />
    </section>
  );
}
