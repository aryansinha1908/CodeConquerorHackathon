import { useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';
import { readPage } from '../../lib/paging';
import { toDate } from '../../lib/time';
import { AI_QUESTION_MAX, AI_QUESTION_MIN, aiKeys, isAiQuotaOut, isAiUnavailable, storeAiQuota } from '../ai/api';
import { checkBooking } from '../bookings/api';
import { getActiveOrgUnits, orgUnitKeys } from '../verification/api';
import { RESOURCE_CATEGORIES } from './format';

// Resources (api.md "Resources"; frontend.md §6.2 /explore and /resources/:id, §8.2). One function
// per route; each resolves with { data, meta } from the success envelope (meta only on the paged
// list) and rejects with lib/http.js's normalised error { status, code, message, details,
// retryAfter, requestId }. Nothing falls back to made-up data: a failed request is shown as one.

export const EXPLORE_PAGE_SIZE = 12;
export const SEARCH_MAX_LENGTH = 100; // GET /resources q: "Can be at most 100 characters."

const ID_RE = /^[0-9a-f]{24}$/i;
const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const path = (id, suffix = '') => `/resources/${encodeURIComponent(id)}${suffix}`;

const toIso = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : null;
};

// ── Explore's filters ─────────────────────────────────────────────────────────

/**
 * Explore's filters → the GET /resources query, normalised so equal filters share one cache entry:
 * q trimmed (≤ 100), category only when it is one of the backend's, orgUnit only when it is an id,
 * eligibleOnly only when true. "All" is the key left out, never a value sent to the server.
 */
export function resourceListParams({
  q,
  category,
  orgUnit,
  eligibleOnly,
  page = 1,
  limit = EXPLORE_PAGE_SIZE,
} = {}) {
  const params = {};
  const text = typeof q === 'string' ? q.trim().slice(0, SEARCH_MAX_LENGTH).trim() : '';
  if (text) params.q = text;
  if (RESOURCE_CATEGORIES.includes(category)) params.category = category;
  if (typeof orgUnit === 'string' && ID_RE.test(orgUnit)) params.orgUnit = orgUnit;
  if (eligibleOnly === true || eligibleOnly === 'true') params.eligibleOnly = true;
  params.page = readPage(page);
  const size = Number(limit);
  params.limit = Number.isInteger(size) && size >= 1 ? Math.min(size, 50) : EXPLORE_PAGE_SIZE;
  return params;
}

/** /explore's URL (?q, category, unit, eligibleOnly=true, page) → the filters. */
export function readExploreFilters(searchParams) {
  const get = (key) => searchParams?.get?.(key) ?? null;
  const category = get('category');
  const unit = get('unit');
  return {
    q: (get('q') ?? '').slice(0, SEARCH_MAX_LENGTH),
    category: RESOURCE_CATEGORIES.includes(category) ? category : '',
    orgUnit: unit && ID_RE.test(unit) ? unit : '',
    eligibleOnly: get('eligibleOnly') === 'true',
    page: readPage(get('page')),
  };
}

/**
 * The URL search params after changing some filters ({ q?, category?, orgUnit?, eligibleOnly?,
 * page? }). Empty values are removed; changing anything but the page goes back to page 1.
 */
export function writeExploreFilters(current, patch = {}) {
  const params = new URLSearchParams(current);
  const set = (key, value) => {
    if (value === '' || value == null || value === false) params.delete(key);
    else params.set(key, String(value));
  };
  if ('q' in patch) set('q', typeof patch.q === 'string' ? patch.q.trim().slice(0, SEARCH_MAX_LENGTH) : '');
  if ('category' in patch) set('category', RESOURCE_CATEGORIES.includes(patch.category) ? patch.category : '');
  if ('orgUnit' in patch) set('unit', ID_RE.test(patch.orgUnit ?? '') ? patch.orgUnit : '');
  if ('eligibleOnly' in patch) set('eligibleOnly', patch.eligibleOnly ? 'true' : '');
  if ('page' in patch) {
    const page = readPage(patch.page);
    set('page', page > 1 ? page : '');
  } else if (Object.keys(patch).length) {
    params.delete('page');
  }
  return params;
}

/**
 * /explore's ?ask (the AI search question) → the question, trimmed, at most 200 characters; '' for
 * one under 3 characters, which the server would refuse (a hand-made link).
 */
export function readAskQuestion(searchParams) {
  const question = String(searchParams?.get?.('ask') ?? '').trim().slice(0, AI_QUESTION_MAX).trim();
  return question.length >= AI_QUESTION_MIN ? question : '';
}

/** The URL search params with the AI question set (and the keyword search off), or cleared. */
export function writeAskQuestion(current, question) {
  const params = new URLSearchParams(current);
  const text = String(question ?? '').trim().slice(0, AI_QUESTION_MAX).trim();
  if (text) params.set('ask', text);
  else params.delete('ask');
  params.delete('q');
  params.delete('page');
  return params;
}

/**
 * The category, unit and "only what I can book" filters, applied to the AI's picks on this device:
 * the AI search answers the question about the whole catalogue, the filters then narrow it.
 */
export function filterAiPicks(items, filters = {}) {
  return (Array.isArray(items) ? items : []).filter(
    (item) =>
      (!filters.category || item.category === filters.category) &&
      (!filters.orgUnit || String(item.orgUnit?._id ?? item.orgUnit) === filters.orgUnit) &&
      (!filters.eligibleOnly || item.eligible === true)
  );
}

/** Whether any filter (not the page) is set. */
export function hasExploreFilters(filters) {
  return Boolean(filters?.q?.trim() || filters?.category || filters?.orgUnit || filters?.eligibleOnly);
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * GET /resources?q&category&orgUnit&eligibleOnly&page&limit → data [Card], meta { page, limit,
 * total, capped? }. Sorted by title (by relevance with q). With eligibleOnly only what the viewer
 * passes the no-slot member rules for, from the first 200 matches (meta.capped when there were more).
 */
export async function listResources(filters = {}) {
  const res = await http.get('/resources', { params: resourceListParams(filters) });
  return unwrap(res);
}

/**
 * GET /resources/:id → data Detail: the card plus usageRules?, checklist, availability.blackouts and
 * canManage. 404 "Resource not found." for unknown, malformed or (for members) archived ids.
 */
export async function getResource(id) {
  return unwrap(await http.get(path(id)));
}

/**
 * GET /resources/:id/availability?from&to (≤ 14 days) → data { quantity, openWindows: [{ start,
 * end }], busy: [{ start, end, inUse, full }] }. No borrower data.
 */
export async function getResourceAvailability(id, { from, to } = {}) {
  return unwrap(await http.get(path(id, '/availability'), { params: { from: toIso(from), to: toIso(to) } }));
}

/**
 * GET /resources/:id/eligibility → without a slot: data { eligible, results (7 member rules), quota:
 * { hoursThisWeek, maxHoursPerWeek, activeCount, maxActiveBookings } }. With { start, end }: the
 * answer of POST /bookings/check. Start and end go together or not at all.
 */
export async function getResourceEligibility(id, slot = null) {
  const start = toIso(slot?.start);
  const end = toIso(slot?.end);
  const params = start && end ? { start, end } : undefined;
  return unwrap(await http.get(path(id, '/eligibility'), params ? { params } : undefined));
}

/**
 * POST /resources/ai-search { query } → data { items: [Card + reason + eligible], quota, cached }.
 * 400 for a question under 3 or over 200 characters, 429 AI_QUOTA_EXCEEDED, 503 AI_UNAVAILABLE.
 */
export async function aiSearchResources(query) {
  return unwrap(await http.post('/resources/ai-search', { query }));
}

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────
// ['resource', id] is a prefix of the availability and eligibility keys, and
// ['resource', id, 'availability'] / ['resource', id, 'eligibility'] are the prefixes that
// features/bookings/api.js invalidates after a booking change.

const slotOf = (slot) => {
  const start = toIso(slot?.start);
  const end = toIso(slot?.end);
  return start && end ? { start, end } : null;
};

export const resourceKeys = {
  all: ['resources'],
  list: (filters) => ['resources', resourceListParams(filters)],
  detail: (id) => ['resource', id],
  availability: (id, range) => ['resource', id, 'availability', slotOfRange(range)],
  // null: the member checklist and quota; { start, end }: the pre-check of that slot.
  eligibility: (id, slot = null) => ['resource', id, 'eligibility', slotOf(slot)],
};

function slotOfRange(range) {
  const from = toIso(range?.from);
  const to = toIso(range?.to);
  return from && to ? { from, to } : null;
}

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * GET /resources under ['resources', params]; stale after 60 s, like the server's cache. Paging
 * keeps the previous page on screen while the next loads; other filter changes start fresh.
 */
export function useResources(filters = {}, options = {}) {
  const params = resourceListParams(filters);
  const { page: _page, ...rest } = params;
  const sameFilters = JSON.stringify(rest);
  return useQuery({
    queryKey: resourceKeys.list(params),
    queryFn: () => listResources(params),
    staleTime: 60 * 1000,
    retry: retryReads,
    placeholderData: (previous, previousQuery) => {
      const { page: _previousPage, ...previousRest } = previousQuery?.queryKey?.[1] ?? {};
      return JSON.stringify(previousRest) === sameFilters ? previous : undefined;
    },
    ...options,
  });
}

/**
 * The AI search for `question` under ['ai', 'search', question]: asked once and kept (never refetched
 * on focus, reconnect, remount or a resource change, and not retried: each request can spend the
 * viewer's AI quota). Off without a question of 3+ characters, or with enabled: false. The answer's
 * quota updates the meter.
 *
 * When the AI can't answer (429 AI_QUOTA_EXCEEDED, 503 AI_UNAVAILABLE) the query succeeds with
 * { fallback: error }: the page shows the keyword search instead, and that stays on screen while
 * "Ask again" refetches (an errored query would go back to pending) and after Back (an errored query
 * would be asked again on mount). Any other failure is an error.
 */
export function useAiSearch(question, { enabled = true, ...options } = {}) {
  const queryClient = useQueryClient();
  const text = String(question ?? '').trim();
  return useQuery({
    queryKey: aiKeys.search(text),
    queryFn: async () => {
      try {
        const res = await aiSearchResources(text);
        storeAiQuota(queryClient, res.data?.quota);
        return res;
      } catch (err) {
        if (isAiQuotaOut(err)) queryClient.invalidateQueries({ queryKey: aiKeys.quota });
        if (isAiQuotaOut(err) || isAiUnavailable(err)) return { fallback: err };
        throw err;
      }
    },
    enabled: enabled && text.length >= AI_QUESTION_MIN,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...options,
  });
}

/** GET /resources/:id under ['resource', id]; stale after 5 minutes. */
export function useResource(id, options = {}) {
  return useQuery({
    queryKey: resourceKeys.detail(id),
    queryFn: () => getResource(id),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
    retry: retryReads,
    ...options,
  });
}

/** GET /resources/:id/availability under ['resource', id, 'availability', range]; stale after 15 s. */
export function useResourceAvailability(id, range, options = {}) {
  const normalised = slotOfRange(range);
  return useQuery({
    queryKey: resourceKeys.availability(id, normalised),
    queryFn: () => getResourceAvailability(id, normalised),
    enabled: Boolean(id && normalised),
    staleTime: 15 * 1000,
    retry: retryReads,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey?.[1] === id ? previous : undefined),
    ...options,
  });
}

/** GET /resources/:id/eligibility (no slot) under ['resource', id, 'eligibility', null]; stale at once. */
export function useResourceEligibility(id, options = {}) {
  return useQuery({
    queryKey: resourceKeys.eligibility(id),
    queryFn: () => getResourceEligibility(id),
    enabled: Boolean(id),
    staleTime: 0,
    retry: retryReads,
    ...options,
  });
}

/**
 * The booking panel's live pre-check: POST /bookings/check { resourceId, start, end } (it saves
 * nothing) under ['resource', id, 'eligibility', { start, end }], so a booking change that
 * invalidates the resource's eligibility re-checks it too. Off until a slot is chosen. The previous
 * slot's answer stays (as placeholder data) while the next is checked.
 */
export function useBookingCheck(resourceId, slot, options = {}) {
  const normalised = slotOf(slot);
  return useQuery({
    queryKey: resourceKeys.eligibility(resourceId, normalised),
    queryFn: () => checkBooking({ resourceId, ...normalised }),
    enabled: Boolean(resourceId && normalised),
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[1] === resourceId && previousQuery?.queryKey?.[3] ? previous : undefined,
    ...options,
  });
}

/**
 * GET /org-units (active units) for Explore's unit filter, under the key and request the
 * verification form already uses, so both share one cache entry. data: the envelope, units in .data.
 */
export function useOrgUnits(options = {}) {
  return useQuery({
    queryKey: orgUnitKeys.active,
    queryFn: getActiveOrgUnits,
    staleTime: 5 * 60 * 1000,
    retry: retryReads,
    ...options,
  });
}
