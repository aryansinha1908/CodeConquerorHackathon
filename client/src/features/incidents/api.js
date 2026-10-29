import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { fieldErrorsFrom, retryReads } from '../../lib/errors';
import { readPage } from '../../lib/paging';
import { toPhotoRefs } from '../uploads/api';
import {
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
} from '../bookings/api';

// Incidents (api.md "Incidents"; frontend.md §6.2 /incidents/new and /incidents/:id, §6.3 and §6.4
// the incident lists, §8.2 query keys). One function per route; each resolves with { data, meta }
// from the success envelope (meta only on the paged list) and rejects with lib/http.js's normalised
// error { status, code, message, details, retryAfter, requestId }. Nothing falls back to made-up
// data, and nothing is applied before the server answers: the hooks put the server's IncidentDetail
// in the cache and refetch what else it changed.

// ── Values ────────────────────────────────────────────────────────────────────

export { INCIDENT_DESCRIPTION_MAX, INCIDENT_DESCRIPTION_MIN, INCIDENT_SEVERITIES, INCIDENT_TYPES };

export const INCIDENT_STATUSES = ['open', 'in_review', 'resolved'];

export const INCIDENT_OUTCOMES = [
  {
    value: 'no_action',
    label: 'No action',
    description: 'Looked into it; nothing more is needed.',
  },
  {
    value: 'warning',
    label: 'Warning',
    description: 'The borrower is warned. It is not counted against them.',
  },
  {
    value: 'repair_required',
    label: 'Repair required',
    description: 'The resource needs a repair before it is used again.',
  },
  {
    value: 'strike',
    label: 'Strike',
    description: "Adds one strike to the borrower's record. Only for an incident on a booking.",
  },
];

// Field limits from api.md, for counters and instant checks (the server checks them again).
export const COMMENT_MAX = 1000;
export const RATIONALE_MAX = 1000;
export const MAX_INCIDENT_PHOTOS = 3;
export const INCIDENT_PAGE_SIZE = 20;

// The status filter of the incident lists. "Unresolved" is the comma list GET /incidents takes.
export const UNRESOLVED = 'open,in_review';
export const STATUS_FILTERS = [
  { value: UNRESOLVED, label: 'Unresolved (open or in review)' },
  { value: 'open', label: 'Open' },
  { value: 'in_review', label: 'In review' },
  { value: 'resolved', label: 'Resolved' },
  { value: '', label: 'All statuses' },
];

const ID_RE = /^[0-9a-f]{24}$/i;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const path = (id, suffix = '') => `/incidents/${encodeURIComponent(id)}${suffix}`;

const isType = (value) => INCIDENT_TYPES.some((t) => t.value === value);
const isSeverity = (value) => INCIDENT_SEVERITIES.some((s) => s.value === value);
const isOutcome = (value) => INCIDENT_OUTCOMES.some((o) => o.value === value);

/** Whether a value is a 24-character hex id (api.md "Values"). */
export function isId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

/**
 * A status filter (one status, a comma list or a list) → the canonical comma list in
 * INCIDENT_STATUSES order ('in_review,open' → 'open,in_review'), or '' for "all": nothing given,
 * every status, or anything unknown in it.
 */
export function statusParam(status) {
  const list = Array.isArray(status) ? status : typeof status === 'string' ? status.split(',') : [];
  const clean = new Set(list.map((s) => String(s).trim()).filter(Boolean));
  if (!clean.size || [...clean].some((s) => !INCIDENT_STATUSES.includes(s))) return '';
  const ordered = INCIDENT_STATUSES.filter((s) => clean.has(s));
  return ordered.length === INCIDENT_STATUSES.length ? '' : ordered.join(',');
}

/**
 * GET /incidents filters → the normalised query of the request and the query key: status as a
 * canonical comma list, type and severity only when they are the server's values, resourceId only
 * when it is an id, page 1–10000 and limit 1–50. "All" is the key left out, never a value sent.
 */
export function incidentListParams({ status, type, severity, resourceId, page = 1, limit = INCIDENT_PAGE_SIZE } = {}) {
  const params = {};
  const statuses = statusParam(status);
  if (statuses) params.status = statuses;
  if (isType(type)) params.type = type;
  if (isSeverity(severity)) params.severity = severity;
  if (isId(resourceId)) params.resourceId = resourceId;
  params.page = readPage(page);
  const size = Number(limit);
  params.limit = Number.isInteger(size) && size >= 1 ? Math.min(size, 50) : INCIDENT_PAGE_SIZE;
  return params;
}

// ── The lists' URL (frontend.md §6.3 /manage/incidents, §6.4 /admin/incidents) ─

// A filter left at "all" is written as ?key=all when the scope's default isn't "all" (the admin's
// severity defaults to high), so the choice survives a reload.
const ALL = 'all';

/** The filters a list starts with: unresolved incidents; the admin's escalations are high severity. */
export function defaultIncidentFilters(scope) {
  return { status: UNRESOLVED, type: '', severity: scope === 'admin' ? 'high' : '', resourceId: '' };
}

/** The list page's URL (?status, type, severity, resourceId, page) → its filters, defaults filled in. */
export function readIncidentFilters(searchParams, scope = 'manage') {
  const defaults = defaultIncidentFilters(scope);
  const get = (key) => searchParams?.get?.(key) ?? null;
  const pick = (key, valid) => {
    const value = get(key);
    if (value === null) return defaults[key];
    if (value === ALL) return '';
    return valid(value) ? value : defaults[key];
  };
  const rawStatus = get('status');
  // statusParam says '' both for "every status" and for something unknown: only the first is "all".
  const listed = typeof rawStatus === 'string' ? rawStatus.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const known = listed.length > 0 && listed.every((s) => INCIDENT_STATUSES.includes(s));
  const status =
    rawStatus === null ? defaults.status : rawStatus === ALL ? '' : known ? statusParam(listed) : defaults.status;
  return {
    status,
    type: pick('type', isType),
    severity: pick('severity', isSeverity),
    resourceId: pick('resourceId', isId),
    page: readPage(get('page')),
  };
}

/**
 * The URL search params after changing some filters ({ status?, type?, severity?, resourceId?,
 * page? }). A filter at the scope's default is removed from the URL; "all" against a default that
 * isn't is written as `all`. Changing anything but the page goes back to page 1.
 */
export function writeIncidentFilters(current, patch = {}, scope = 'manage') {
  const params = new URLSearchParams(current);
  const defaults = defaultIncidentFilters(scope);
  const normalise = {
    status: (v) => statusParam(v),
    type: (v) => (isType(v) ? v : ''),
    severity: (v) => (isSeverity(v) ? v : ''),
    resourceId: (v) => (isId(v) ? v : ''),
  };
  for (const key of Object.keys(normalise)) {
    if (!(key in patch)) continue;
    const value = normalise[key](patch[key]);
    if (value === defaults[key]) params.delete(key);
    else params.set(key, value || ALL);
  }
  if ('page' in patch) {
    const page = readPage(patch.page);
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
  } else if (Object.keys(patch).length) {
    params.delete('page');
  }
  return params;
}

/** Whether the filters differ from the scope's defaults (the page aside). */
export function hasCustomFilters(filters, scope = 'manage') {
  const defaults = defaultIncidentFilters(scope);
  return ['status', 'type', 'severity', 'resourceId'].some((key) => (filters?.[key] ?? '') !== defaults[key]);
}

// ── Forms ─────────────────────────────────────────────────────────────────────

/**
 * The report form → the POST /incidents body: bookingId (with a booking; the server takes the
 * resource from it) or resourceId (without one), type, severity, the trimmed description and, when
 * there are any, photos as { url, publicId } only. No other key: the server refuses unknown ones.
 */
export function buildIncidentBody({ bookingId, resourceId, type, severity, description, photos } = {}) {
  const body = {};
  if (bookingId) body.bookingId = String(bookingId);
  else if (resourceId) body.resourceId = String(resourceId);
  body.type = type;
  body.severity = severity;
  body.description = text(description);
  const refs = toPhotoRefs(photos);
  if (refs.length) body.photos = refs.slice(0, MAX_INCIDENT_PHOTOS);
  return body;
}

/**
 * The report form → { field: message } for what has to change before it is sent (frontend.md §9
 * "Incident": type and severity required, description 20–2000; a resource without a booking).
 */
export function validateIncident({ bookingId, resourceId, type, severity, description } = {}) {
  const errors = {};
  if (!bookingId && !resourceId) errors.resourceId = 'Choose the resource the issue is about.';
  if (!isType(type)) errors.type = 'Choose the kind of issue.';
  if (!isSeverity(severity)) errors.severity = 'Choose how serious it is.';
  const length = text(description).length;
  if (!length) errors.description = 'Describe what happened.';
  else if (length < INCIDENT_DESCRIPTION_MIN) {
    errors.description = `Use at least ${INCIDENT_DESCRIPTION_MIN} characters (now ${length}).`;
  } else if (length > INCIDENT_DESCRIPTION_MAX) {
    errors.description = `Use at most ${INCIDENT_DESCRIPTION_MAX} characters (now ${length}).`;
  }
  return errors;
}

const REPORT_FIELDS = ['type', 'severity', 'description', 'resourceId'];

/**
 * A failed POST /incidents → { fields: { formField: message }, other: [message] }. Field details
 * the form shows (type, severity, description, resourceId, photos and photos.<i>) go beside the
 * field; the rest (a bookingId the URL carried, an unknown key) are listed above the buttons.
 */
export function incidentErrorsFrom(err) {
  const fields = {};
  const other = [];
  for (const [key, message] of Object.entries(fieldErrorsFrom(err))) {
    const field = REPORT_FIELDS.includes(key) ? key : /^photos(\.\d+)?$/.test(key) ? 'photos' : null;
    if (field && !(field in fields)) fields[field] = message;
    else if (!field) other.push(message);
  }
  return { fields, other };
}

/** A comment's text → { value, error }: required, at most 1000 characters after trimming. */
export function readComment(value) {
  const clean = text(value);
  if (!clean) return { value: clean, error: 'Write a comment first.' };
  if (clean.length > COMMENT_MAX) {
    return { value: clean, error: `Use at most ${COMMENT_MAX} characters (now ${clean.length}).` };
  }
  return { value: clean, error: null };
}

/**
 * The resolve form → { field: message }: an outcome of the server's, a strike only on an incident
 * tied to a booking, and a rationale of 1–1000 characters.
 */
export function validateResolution({ outcome, rationale, hasBooking = true } = {}) {
  const errors = {};
  if (!isOutcome(outcome)) errors.outcome = 'Choose an outcome.';
  else if (outcome === 'strike' && !hasBooking) {
    errors.outcome = "A strike counts against a borrower, and this incident isn't tied to a booking.";
  }
  const length = text(rationale).length;
  if (!length) errors.rationale = 'Explain the decision, so everyone involved knows why.';
  else if (length > RATIONALE_MAX) errors.rationale = `Use at most ${RATIONALE_MAX} characters (now ${length}).`;
  return errors;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * POST /incidents { bookingId? | resourceId, type, severity, description, photos? } → 201 data
 * IncidentDetail. With a booking: its borrower (up to 7 days after it ends) or the unit's staff;
 * without one: the unit's managers and admins only.
 */
export async function createIncident(input = {}) {
  return unwrap(await http.post('/incidents', buildIncidentBody(input)));
}

/**
 * GET /incidents?status&type&severity&resourceId&page&limit → data [IncidentListItem] (no photos or
 * thread; commentCount), meta { page, limit, total }, newest first, in the viewer's scope.
 */
export async function listIncidents(filters = {}) {
  return unwrap(await http.get('/incidents', { params: incidentListParams(filters) }));
}

/** GET /incidents/:id → data IncidentDetail with comments, resolution, canComment and canResolve. */
export async function getIncident(id) {
  return unwrap(await http.get(path(id)));
}

/**
 * POST /incidents/:id/comments { text (1–1000) } → 201 data IncidentDetail with the new comment. A
 * staff member's first comment moves the incident from open to in_review.
 */
export async function commentOnIncident(id, { text: comment } = {}) {
  return unwrap(await http.post(path(id, '/comments'), { text: text(comment) }));
}

/**
 * POST /incidents/:id/resolve { outcome, rationale } → 200 data IncidentDetail plus bookingClosed
 * (true when this closed a flagged booking, which is now completed).
 */
export async function resolveIncident(id, { outcome, rationale } = {}) {
  return unwrap(await http.post(path(id, '/resolve'), { outcome, rationale: text(rationale) }));
}

/**
 * The resources a manager or admin can report on without a booking: GET /resources with
 * status=active,maintenance, which a manager's list limits to their own units and an admin's
 * covers every unit (api.md "Resources"). q is the text search; at most `limit` (≤ 50), by title.
 */
export function reportableResourceParams({ q, limit = 20 } = {}) {
  const params = { status: 'active,maintenance' };
  const search = text(q).slice(0, 100).trim();
  if (search) params.q = search;
  const size = Number(limit);
  params.limit = Number.isInteger(size) && size >= 1 ? Math.min(size, 50) : 20;
  return params;
}

/** GET /resources (see reportableResourceParams) → data [Card], meta { page, limit, total }. */
export async function listReportableResources(filters = {}) {
  return unwrap(await http.get('/resources', { params: reportableResourceParams(filters) }));
}

// The lists' resource filter: every status (an archived resource keeps its incidents), which a
// manager's GET /resources limits to their own units and an admin's covers every unit. By title.
export const FILTER_RESOURCE_PARAMS = { status: 'active,maintenance,archived', limit: 50 };

/** GET /resources for the resource filter → data [Card], meta { page, limit, total }. */
export async function listFilterResources() {
  return unwrap(await http.get('/resources', { params: FILTER_RESOURCE_PARAMS }));
}

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────

export const incidentKeys = {
  all: ['incidents'], // every list: invalidating it refreshes each filter and page
  list: (filters) => ['incidents', incidentListParams(filters)],
  detail: (id) => ['incident', id],
  // Under ['resources'], so a resource change makes the picker stale too.
  reportable: (filters) => ['resources', 'reportable', reportableResourceParams(filters)],
  filterResources: ['resources', 'incident-filter', FILTER_RESOURCE_PARAMS],
};

/**
 * The query keys an incident change makes stale (as prefixes): every incident list; the booking it
 * is on (its incidents and its timeline, ['booking', id] being their prefix); and, after a resolve
 * that may have completed a flagged booking, every booking list.
 */
export function incidentKeysToInvalidate({ bookingId, resolved = false } = {}) {
  const keys = [incidentKeys.all];
  if (bookingId) keys.push(['booking', String(bookingId)]);
  if (resolved && bookingId) keys.push(['bookings']);
  return keys;
}

const bookingIdOf = (incident) => {
  const booking = incident?.booking;
  if (!booking) return null;
  return typeof booking === 'object' ? (booking._id ? String(booking._id) : null) : String(booking);
};

function invalidate(queryClient, keys) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

// The server's answer is the incident as GET /incidents/:id shows it: store it as that query's data
// (resolve adds bookingClosed, which only the page that resolved needs).
function storeDetail(queryClient, incident) {
  if (!incident?._id) return;
  const { bookingClosed: _closed, ...detail } = incident;
  queryClient.setQueryData(incidentKeys.detail(String(incident._id)), { data: detail });
}

// Errors that mean the incident on screen is out of date (resolved meanwhile, gone, or the viewer's
// rights changed): refetch it so the page shows the current state.
const STALE_CODES = new Set(['INVALID_TRANSITION', 'NOT_FOUND', 'FORBIDDEN']);

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * GET /incidents under ['incidents', params]; refetched on focus. The previous page stays on screen
 * while the next loads, but never another filter's rows.
 */
export function useIncidents(filters = {}, options = {}) {
  const params = incidentListParams(filters);
  const { page: _page, ...rest } = params;
  const same = JSON.stringify(rest);
  return useQuery({
    queryKey: incidentKeys.list(params),
    queryFn: () => listIncidents(params),
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) => {
      const { page: _previousPage, ...previousRest } = previousQuery?.queryKey?.[1] ?? {};
      return JSON.stringify(previousRest) === same ? previous : undefined;
    },
    ...options,
  });
}

/** GET /incidents/:id under ['incident', id]; refetched on focus. */
export function useIncident(id, options = {}) {
  return useQuery({
    queryKey: incidentKeys.detail(id),
    queryFn: () => getIncident(id),
    enabled: Boolean(id),
    staleTime: 0,
    retry: retryReads,
    ...options,
  });
}

/** The report page's resource picker (managers and admins). */
export function useReportableResources(filters = {}, options = {}) {
  return useQuery({
    queryKey: incidentKeys.reportable(filters),
    queryFn: () => listReportableResources(filters),
    staleTime: 60 * 1000,
    retry: retryReads,
    placeholderData: (previous) => previous,
    ...options,
  });
}

/** The resource filter's options (managers: their units' resources; admins: every unit's). */
export function useFilterResources(options = {}) {
  return useQuery({
    queryKey: incidentKeys.filterResources,
    queryFn: listFilterResources,
    staleTime: 5 * 60 * 1000,
    retry: retryReads,
    ...options,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────
// onSuccess returns the invalidation, so `isPending` stays true until the changed queries have
// refetched. Pass per-call callbacks to mutate(vars, { onSuccess, onError }) for navigation,
// toasts and focus.

/** POST /incidents. mutate({ bookingId? | resourceId, type, severity, description, photos? }). */
export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createIncident,
    onSuccess: (result, vars) => {
      storeDetail(queryClient, result?.data);
      return invalidate(
        queryClient,
        incidentKeysToInvalidate({ bookingId: bookingIdOf(result?.data) ?? vars?.bookingId })
      );
    },
  });
}

/** POST /incidents/:id/comments. mutate({ id, text }). */
export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text: comment }) => commentOnIncident(id, { text: comment }),
    onSuccess: (result) => {
      storeDetail(queryClient, result?.data);
      return invalidate(queryClient, incidentKeysToInvalidate({ bookingId: bookingIdOf(result?.data) }));
    },
    onError: (err, vars) => {
      if (STALE_CODES.has(err?.code) && vars?.id) {
        queryClient.invalidateQueries({ queryKey: incidentKeys.detail(vars.id) });
      }
    },
  });
}

/** POST /incidents/:id/resolve. mutate({ id, outcome, rationale, bookingId? }). */
export function useResolveIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome, rationale }) => resolveIncident(id, { outcome, rationale }),
    onSuccess: (result, vars) => {
      storeDetail(queryClient, result?.data);
      return invalidate(
        queryClient,
        incidentKeysToInvalidate({ bookingId: bookingIdOf(result?.data) ?? vars?.bookingId, resolved: true })
      );
    },
    onError: (err, vars) => {
      if (STALE_CODES.has(err?.code) && vars?.id) {
        queryClient.invalidateQueries({ queryKey: incidentKeys.detail(vars.id) });
      }
    },
  });
}
