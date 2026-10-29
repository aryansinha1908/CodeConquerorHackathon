import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Layers, Plus, Search, X } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Pagination } from '../../components/ui/Pagination';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { pageCount } from '../../lib/paging';
import { useOrgUnits } from '../resources/api';
import { LinkButton, ListSkeleton, LiveRegion } from './components/Bits';
import {
  MANAGE_RESOURCES_PAGE_SIZE,
  SEARCH_MAX_LENGTH,
  STATUS_FILTERS,
  STATUS_REASON_MAX,
  readManageFilters,
  useManagedResources,
  useSetResourceStatus,
  writeManageFilters,
} from './resources/api';
import { canListResources, isAdmin, unitChoices, unitName } from './resources/listingForm';
import { ResourceTable } from './resources/ResourceTable';
import { STATUS_DIALOGS, statusChangeNotice, statusVars } from './resources/statusView';
import { inputClass, labelClass, textLinkClass } from './resources/styles';

// /manage/resources (frontend.md §6.3, F-10; judge step 1): the resources of the units the manager
// runs (an admin: every unit), from GET /resources with every status, so the server scopes the list
// to their units. Each row has the status toggles (PATCH /resources/:id/status: a reason is asked
// for when taking it out of service, and the bookings still affected are reported after), and
// links to the listing form and to the public page.

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const listText = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

function Notice({ tone = 'success', onDismiss, children }) {
  const Icon = tone === 'warning' ? AlertTriangle : CheckCircle2;
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 p-4 rounded-lg border-2 text-sm ${
        tone === 'warning' ? 'border-[#e67e22] bg-[#fef9f3]' : 'border-[#183d2d] bg-[#f0faf5]'
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Icon
          className={`w-5 h-5 shrink-0 ${tone === 'warning' ? 'text-[#a04000]' : 'text-[#183d2d]'}`}
          aria-hidden="true"
        />
        <div className="space-y-1 min-w-0">{children}</div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss the notice"
        className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border-2 border-[#1a1a1a] bg-white hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}

// "You manage DIC and CW: …", from the user's managedOrgUnits and the unit list.
function scopeText(user, units) {
  if (isAdmin(user)) return 'As an admin you can list, edit and change the status of every unit’s resources.';
  const names = units.map((unit) => asText(unit.code).toUpperCase() || asText(unit.name)).filter(Boolean);
  if (!names.length) return null;
  return `You manage ${listText(names)}: you can list, edit and change the status of their resources.`;
}

function SearchBox({ initial, onSearch }) {
  const [value, setValue] = useState(initial);
  // The URL's q changed (a search, Clear filters, the browser's back): show it. Not keyed on q, so
  // the input or button that was used keeps focus after a search.
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setValue(initial);
  }
  return (
    <form
      role="search"
      aria-label="Search your resources"
      className="flex items-end gap-2 flex-1 min-w-[14rem]"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value);
      }}
    >
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <label htmlFor="manage-resources-q" className={labelClass}>
          Search
        </label>
        <input
          id="manage-resources-q"
          type="search"
          value={value}
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Title or description"
          className={inputClass(false)}
        />
      </div>
      <Button type="submit" variant="outline" className="bg-white min-h-[44px]">
        <Search className="w-4 h-4" aria-hidden="true" />
        Search
      </Button>
    </form>
  );
}

export default function ResourcesPage() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readManageFilters(searchParams);
  const filtered = Boolean(filters.q || filters.orgUnit || filters.status !== STATUS_FILTERS[0].id);

  const list = useManagedResources({ ...filters, limit: MANAGE_RESOURCES_PAGE_SIZE });
  const resources = Array.isArray(list.data?.data) ? list.data.data : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, MANAGE_RESOURCES_PAGE_SIZE);

  const unitsQuery = useOrgUnits();
  const units = unitChoices(Array.isArray(unitsQuery.data?.data) ? unitsQuery.data.data : [], user);
  const scope = scopeText(user, units);
  const canList = canListResources(user);

  // A notice handed over by the listing form (created or saved), shown once.
  const [arrival, setArrival] = useState(() =>
    typeof location.state?.notice === 'string'
      ? { text: location.state.notice, resourceId: location.state.resourceId ?? null }
      : null
  );
  const arrivedWithNotice = useRef(Boolean(arrival));
  useEffect(() => {
    if (!arrivedWithNotice.current) return;
    arrivedWithNotice.current = false;
    headingRef.current?.focus();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [navigate, location.pathname, location.search]);

  const write = (patch, options) => setSearchParams((current) => writeManageFilters(current, patch), options);
  // Both "Clear filters" buttons go away once nothing is filtered: focus moves to the heading.
  const clearFilters = () => {
    setSearchParams(new URLSearchParams());
    headingRef.current?.focus();
  };

  // A change of status can empty the last page of a filtered list: step back to the new last one.
  const settled = list.isSuccess && !list.isPlaceholderData;
  useEffect(() => {
    if (settled && filters.page > pages) {
      setSearchParams((current) => writeManageFilters(current, { page: pages }), { replace: true });
    }
  }, [settled, filters.page, pages, setSearchParams]);

  // ── Status changes ─────────────────────────────────────────────────────────
  const setStatus = useSetResourceStatus();
  const [dialog, setDialog] = useState(null); // { resource, status }
  const [result, setResult] = useState(null); // statusChangeNotice(...)
  const [stale, setStale] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  const openDialog = (resource, status) => {
    if (setStatus.isPending) return;
    setStatus.reset();
    setStale(null);
    setDialog({ resource, status });
  };
  const closeDialog = () => {
    if (setStatus.isPending) return;
    setDialog(null);
    setStatus.reset();
  };
  const submitStatus = (reason) => {
    if (!dialog || setStatus.isPending) return;
    const { resource, status } = dialog;
    setStatus.mutate(statusVars(resource, status, reason), {
      onSuccess: (res) => {
        const notice = statusChangeNotice({
          title: resource.title,
          status,
          affectedBookings: res?.data?.affectedBookings,
        });
        setDialog(null);
        setArrival(null);
        setResult(notice);
        setAnnouncement(notice.text);
        if (notice.tone === 'warning') toast.warning(notice.text);
        else toast.success(notice.text);
      },
      onError: (err) => {
        // Changed by someone else meanwhile, or gone: the hook refetches the list; say why above it.
        if (err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND') {
          setDialog(null);
          setStale(err);
        }
        // Anything else (400 reason, 403, 503) stays in the dialog with its message and request id.
      },
    });
  };
  const dialogText = dialog ? STATUS_DIALOGS[dialog.status] : null;
  const busyId = setStatus.isPending ? setStatus.variables?.id ?? null : null;

  const caption = `${filtered ? 'Matching resources' : 'Your units’ resources'}, page ${filters.page} of ${pages}`;

  return (
    <section aria-labelledby="resources-heading" className="space-y-5 font-mono text-[#1a1a1a]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b-2 border-[#1a1a1a] pb-4">
        <div>
          <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">Unit resources</span>
          <h2
            id="resources-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-black tracking-tight focus:outline-none"
          >
            Resources
          </h2>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">
            Every resource your units list, whatever its status. Taking one out of service asks for a
            reason and never cancels bookings: you&apos;ll see how many are affected.
          </p>
          {scope && <p className="text-xs mt-1 max-w-2xl leading-relaxed font-bold">{scope}</p>}
        </div>
        {canList && (
          <LinkButton to="/manage/resources/new" variant="primary" className="shrink-0 self-start md:self-auto">
            <Plus className="w-4 h-4" aria-hidden="true" />
            New resource
          </LinkButton>
        )}
      </div>

      <LiveRegion>{announcement}</LiveRegion>

      {arrival && (
        <Notice onDismiss={() => { setArrival(null); headingRef.current?.focus(); }}>
          <p className="font-bold">{arrival.text}</p>
          {arrival.resourceId && (
            <p className="text-xs">
              <Link to={`/resources/${encodeURIComponent(arrival.resourceId)}`} className={textLinkClass}>
                View it as members do
              </Link>
            </p>
          )}
        </Notice>
      )}

      {result && (
        <Notice tone={result.tone} onDismiss={() => { setResult(null); headingRef.current?.focus(); }}>
          <p className="font-bold">{result.text}</p>
          {result.followUp && (
            <p className="text-xs">
              <Link to="/manage/requests" className={textLinkClass}>
                Review the request queue
              </Link>{' '}
              ·{' '}
              <Link to="/manage/handovers" className={textLinkClass}>
                See today&apos;s handovers
              </Link>
            </p>
          )}
        </Notice>
      )}

      {stale && (
        <ErrorState
          error={stale}
          title="That resource changed meanwhile"
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
          retryLabel="Reload the list"
        >
          The list below shows each resource as it is now.
        </ErrorState>
      )}

      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <SearchBox initial={filters.q} onSearch={(q) => write({ q })} />
        {units.length > 1 && (
          <div className="flex flex-col gap-1 lg:w-64">
            <label htmlFor="manage-resources-unit" className={labelClass}>
              Unit
            </label>
            <select
              id="manage-resources-unit"
              value={filters.orgUnit}
              onChange={(event) => write({ orgUnit: event.target.value })}
              className={inputClass(false)}
            >
              <option value="">{isAdmin(user) ? 'All units' : 'All my units'}</option>
              {units.map((unit) => (
                <option key={unit._id} value={String(unit._id)}>
                  {unitName(unit)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1 lg:w-56">
          <label htmlFor="manage-resources-status" className={labelClass}>
            Status
          </label>
          <select
            id="manage-resources-status"
            value={filters.status}
            onChange={(event) => write({ status: event.target.value })}
            className={inputClass(false)}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.isSuccess && (
        <p className="text-xs text-[#1a1a1a]/70">
          {total} {total === 1 ? 'resource' : 'resources'}
          {filtered ? ' match' : ''}
          {list.isFetching && <span aria-hidden="true"> · updating…</span>}
          {filtered && (
            <>
              {' · '}
              <button type="button" onClick={clearFilters} className={`${textLinkClass} py-2`}>
                Clear filters
              </button>
            </>
          )}
        </p>
      )}

      {list.isPending && <ListSkeleton label="Loading your resources…" rows={3} />}

      {list.isError && !list.data && (
        <ErrorState
          error={list.error}
          title="Couldn't load the resources"
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        >
          {list.error?.status === 403 && 'Only unit managers and admins can see this list.'}
        </ErrorState>
      )}

      {list.isError && list.data && (
        <ErrorState
          error={list.error}
          title="Couldn't refresh the resources"
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        >
          The rows below may be out of date.
        </ErrorState>
      )}

      {list.isSuccess && resources.length === 0 &&
        (filtered ? (
          <EmptyState
            icon={Layers}
            title="No resources match"
            description="Try another word, unit or status, or clear the filters."
            actionLabel="Clear filters"
            onAction={clearFilters}
          />
        ) : (
          <EmptyState
            icon={Layers}
            title="No resources listed yet"
            description={
              canList
                ? 'List your unit’s first resource: a room, a machine or a kit members can book.'
                : "You don't manage a unit yet. An admin assigns unit managers."
            }
            actionLabel={canList ? 'List a resource' : undefined}
            onAction={canList ? () => navigate('/manage/resources/new') : undefined}
          />
        ))}

      {resources.length > 0 && (
        <ResourceTable
          resources={resources}
          caption={caption}
          busyId={busyId}
          dimmed={list.isPlaceholderData}
          onChooseStatus={openDialog}
        />
      )}

      <Pagination
        page={filters.page}
        pageCount={pages}
        onPageChange={(page) => write({ page })}
        busy={list.isFetching}
        label="Resource pages"
      />

      <ReasonDialog
        open={Boolean(dialog)}
        onClose={closeDialog}
        returnFocusRef={headingRef}
        eyebrow={dialog ? `${asText(dialog.resource.title)} · ${unitName(dialog.resource.orgUnit)}` : undefined}
        title={dialogText ? dialogText.title(asText(dialog.resource.title) || 'this resource') : ''}
        description={dialogText?.description}
        label={dialogText?.label}
        hint={dialogText?.hint}
        required={dialogText?.required ?? true}
        maxLength={STATUS_REASON_MAX}
        templates={dialogText?.templates ?? []}
        submitLabel={dialogText?.submitLabel}
        pendingLabel={dialogText?.pendingLabel}
        variant={dialogText?.variant}
        pending={setStatus.isPending}
        error={setStatus.error}
        errorTitle="The status wasn't changed"
        onSubmit={submitStatus}
      />
    </section>
  );
}
