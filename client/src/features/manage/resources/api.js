import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../../lib/http';
import { retryReads } from '../../../lib/errors';
import { readPage } from '../../../lib/paging';
import { resourceKeys } from '../../resources/api';
import { RESOURCE_CATEGORIES } from '../../resources/format';

// The manager's side of resources (api.md "Resources" and "Badges"; frontend.md §6.3
// /manage/resources and the listing form, §8.2). One function per route; each resolves with
// { data, meta } from the success envelope (meta only on the paged list) and rejects with
// lib/http.js's normalised error { status, code, message, details, retryAfter, requestId }. Nothing
// here makes up data, and no write is applied optimistically: the hooks wait for the server, then
// refetch what changed.

export const MANAGE_RESOURCES_PAGE_SIZE = 20;
export const SEARCH_MAX_LENGTH = 100; // GET /resources q: "Can be at most 100 characters."
export const STATUS_REASON_MAX = 500; // PATCH /resources/:id/status reason

export const RESOURCE_STATUSES = ['active', 'maintenance', 'archived'];

// The list's status filter. Every choice names a status other than `active`: the server scopes a
// manager's list to their own units only once a non-active status is asked for (api.md "Once a
// non-active status is requested…"), so "active" alone would list every unit's active resources.
export const STATUS_FILTERS = [
  { id: 'all', label: 'All statuses', statuses: ['active', 'maintenance', 'archived'] },
  { id: 'maintenance', label: 'Under maintenance', statuses: ['maintenance'] },
  { id: 'archived', label: 'Archived', statuses: ['archived'] },
];

const ID_RE = /^[0-9a-f]{24}$/i;
const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const path = (id, suffix = '') => `/resources/${encodeURIComponent(id)}${suffix}`;
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A ?status= value → one of STATUS_FILTERS (the first, "All statuses", by default). */
export function readStatusFilter(value) {
  return STATUS_FILTERS.find((filter) => filter.id === value) ?? STATUS_FILTERS[0];
}

/**
 * The list's filters → the GET /resources query, normalised so equal filters share one cache entry:
 * status as a comma list (never `active` alone, see STATUS_FILTERS), orgUnit only when it is an id,
 * q trimmed to 100 characters, category only when it is one of the backend's.
 */
export function manageListParams({ status, orgUnit, q, category, page = 1, limit = MANAGE_RESOURCES_PAGE_SIZE } = {}) {
  const params = { status: readStatusFilter(status).statuses.join(',') };
  if (typeof orgUnit === 'string' && ID_RE.test(orgUnit)) params.orgUnit = orgUnit;
  const search = text(q).slice(0, SEARCH_MAX_LENGTH).trim();
  if (search) params.q = search;
  if (RESOURCE_CATEGORIES.includes(category)) params.category = category;
  params.page = readPage(page);
  const size = Number(limit);
  params.limit = Number.isInteger(size) && size >= 1 ? Math.min(size, 50) : MANAGE_RESOURCES_PAGE_SIZE;
  return params;
}

/** /manage/resources's URL (?status, unit, q, page) → the filters. */
export function readManageFilters(searchParams) {
  const get = (key) => searchParams?.get?.(key) ?? null;
  const unit = get('unit');
  return {
    status: readStatusFilter(get('status')).id,
    orgUnit: unit && ID_RE.test(unit) ? unit : '',
    q: (get('q') ?? '').slice(0, SEARCH_MAX_LENGTH),
    page: readPage(get('page')),
  };
}

/**
 * The URL search params after changing some filters ({ status?, orgUnit?, q?, page? }). Defaults
 * are left out of the URL; changing anything but the page goes back to page 1.
 */
export function writeManageFilters(current, patch = {}) {
  const params = new URLSearchParams(current);
  const set = (key, value) => {
    if (value === '' || value == null) params.delete(key);
    else params.set(key, String(value));
  };
  if ('status' in patch) {
    const id = readStatusFilter(patch.status).id;
    set('status', id === STATUS_FILTERS[0].id ? '' : id);
  }
  if ('orgUnit' in patch) set('unit', ID_RE.test(patch.orgUnit ?? '') ? patch.orgUnit : '');
  if ('q' in patch) set('q', text(patch.q).slice(0, SEARCH_MAX_LENGTH));
  if ('page' in patch) {
    const page = readPage(patch.page);
    set('page', page > 1 ? page : '');
  } else if (Object.keys(patch).length) {
    params.delete('page');
  }
  return params;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * GET /resources?status=active,maintenance,archived&orgUnit&q&page&limit → data [Card], meta
 * { page, limit, total }: a manager's own units (an admin's: every unit), sorted by title.
 */
export async function listManagedResources(filters = {}) {
  const res = await http.get('/resources', { params: manageListParams(filters) });
  return unwrap(res);
}

/** POST /resources (the listing form with orgUnit) → 201 data Detail (canManage: true). */
export async function createResource(body) {
  return unwrap(await http.post('/resources', body));
}

/**
 * PATCH /resources/:id (any listing-form field but orgUnit and status; a nested section sets only
 * the keys it names, lists are replaced whole) → data Detail (canManage: true).
 */
export async function updateResource(id, patch) {
  return unwrap(await http.patch(path(id), patch));
}

/**
 * PATCH /resources/:id/status { status, reason } → data { resource: Detail, affectedBookings }.
 * The reason is required unless the new status is active (then it is sent only when given).
 * Nothing is cancelled: affectedBookings counts the slot-holding bookings that haven't ended.
 */
export async function setResourceStatus(id, { status, reason } = {}) {
  const clean = text(reason);
  return unwrap(await http.patch(path(id, '/status'), { status, ...(clean && { reason: clean }) }));
}

/**
 * GET /badges → data [{ _id, name, code, orgUnit: { _id, name, code, isActive }, description?,
 * validityDays, evidenceRequired, selfServe }], sorted by name (badges of inactive units left out).
 */
export async function listBadges() {
  return unwrap(await http.get('/badges'));
}

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────
// ['resources', 'manage', params] sits under Explore's ['resources'] prefix, so invalidating
// ['resources'] after a write refreshes both lists. The detail is resources/api.js's
// ['resource', id], the prefix of its availability and eligibility.

export const manageResourceKeys = {
  all: ['resources'],
  list: (filters) => ['resources', 'manage', manageListParams(filters)],
  detail: (id) => resourceKeys.detail(id),
  // Not ['badges']: the badge pages keep their own lists under that prefix.
  badges: ['badges', 'catalogue'],
};

/** The keys a resource write makes stale (frontend.md §8.2): every resource list and the resource. */
export function resourceKeysToInvalidate(id) {
  return id ? [manageResourceKeys.all, manageResourceKeys.detail(id)] : [manageResourceKeys.all];
}

function invalidate(queryClient, keys) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

// Errors that mean the screen is out of date: refetch so the user sees the current state.
const STALE_CODES = new Set(['INVALID_TRANSITION', 'NOT_FOUND']);

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * The manager's list under ['resources', 'manage', params]. Paging keeps the previous page on
 * screen while the next loads; other filter changes start fresh.
 */
export function useManagedResources(filters = {}, options = {}) {
  const params = manageListParams(filters);
  const { page: _page, ...rest } = params;
  const sameFilters = JSON.stringify(rest);
  return useQuery({
    queryKey: manageResourceKeys.list(params),
    queryFn: () => listManagedResources(params),
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) => {
      const { page: _previousPage, ...previousRest } = previousQuery?.queryKey?.[2] ?? {};
      return JSON.stringify(previousRest) === sameFilters ? previous : undefined;
    },
    ...options,
  });
}

/** GET /badges under ['badges', 'catalogue'], for the eligibility section's badge picker. */
export function useBadgeCatalogue(options = {}) {
  return useQuery({
    queryKey: manageResourceKeys.badges,
    queryFn: listBadges,
    staleTime: 5 * 60 * 1000,
    retry: retryReads,
    ...options,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────
// Each onSuccess returns the invalidation, so `isPending` stays true until the lists have
// refetched. Per-call callbacks (mutate(vars, { onSuccess, onError })) handle navigation and focus.

/** POST /resources. mutate(body). The new detail goes straight into ['resource', id]. */
export function useCreateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createResource,
    onSuccess: (result) => {
      const id = result?.data?._id;
      if (id) queryClient.setQueryData(manageResourceKeys.detail(String(id)), { data: result.data });
      return invalidate(queryClient, [manageResourceKeys.all]);
    },
  });
}

/** PATCH /resources/:id. mutate({ id, patch }). */
export function useUpdateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => updateResource(id, patch),
    onSuccess: (result, vars) => {
      if (result?.data) queryClient.setQueryData(manageResourceKeys.detail(vars.id), { data: result.data });
      // The detail too: opening hours and limits change the availability and eligibility under it.
      return invalidate(queryClient, resourceKeysToInvalidate(vars.id));
    },
    onError: (err, vars) => {
      if (STALE_CODES.has(err?.code)) invalidate(queryClient, resourceKeysToInvalidate(vars?.id));
    },
  });
}

/** PATCH /resources/:id/status. mutate({ id, status, reason? }). */
export function useSetResourceStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }) => setResourceStatus(id, { status, reason }),
    onSuccess: (_result, vars) => invalidate(queryClient, resourceKeysToInvalidate(vars.id)),
    onError: (err, vars) => {
      if (STALE_CODES.has(err?.code)) invalidate(queryClient, resourceKeysToInvalidate(vars?.id));
    },
  });
}
