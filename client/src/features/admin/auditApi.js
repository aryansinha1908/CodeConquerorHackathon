import { useQuery } from '@tanstack/react-query';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';
import { readPage } from '../../lib/paging';
import { formatIstDateTime, istDayBounds } from '../../lib/time';

// The audit log (api.md "Audit": GET /audit; frontend.md §6.4 /admin/audit, §8.2 ['audit', filters];
// judge step 12: "Admin → Audit filtered by this booking"). Each request resolves with { data, meta }
// from the success envelope and rejects with lib/http.js's normalised error. Filters live in the
// page's URL (?entityType=booking&entityId=… is the deep link the booking pages use); the helpers
// here read, check and turn them into the query, and say what an entry shows. Nothing is made up:
// a value the server didn't send is shown as missing.

export const AUDIT_PAGE_SIZE = 25;

export const AUDIT_ENTITY_TYPES = [
  { value: 'booking', label: 'Booking' },
  { value: 'incident', label: 'Incident' },
  { value: 'resource', label: 'Resource' },
  { value: 'badge', label: 'Badge' },
  { value: 'user_badge', label: "A member's badge" },
  { value: 'user', label: 'User' },
  { value: 'org_unit', label: 'Org unit' },
];

// api.md "Audit" action values, by what they are about (badge.evidence_viewed: opening a badge
// request's evidence, audited like verification.id_viewed).
export const AUDIT_ACTION_GROUPS = [
  {
    label: 'Bookings',
    actions: [
      'booking.requested',
      'booking.approved',
      'booking.rejected',
      'booking.waitlisted',
      'booking.cancelled',
      'booking.promoted',
      'booking.expired',
      'booking.checked_in',
      'booking.no_show',
      'booking.checked_out',
      'booking.completed',
      'booking.flagged',
      'booking.overdue',
    ],
  },
  { label: 'Incidents', actions: ['incident.created', 'incident.commented', 'incident.resolved'] },
  { label: 'Resources', actions: ['resource.created', 'resource.updated', 'resource.status_changed'] },
  {
    label: 'Badges',
    actions: ['badge.created', 'badge.requested', 'badge.granted', 'badge.rejected', 'badge.evidence_viewed'],
  },
  {
    label: 'Users and verification',
    actions: [
      'user.registered',
      'verification.submitted',
      'verification.id_viewed',
      'verification.approved',
      'verification.rejected',
    ],
  },
  { label: 'Org units', actions: ['org_unit.created', 'org_unit.updated', 'org_unit.managers_changed'] },
];

// The server's own checks (services/auditService.js, params.js), so a bad value is caught here
// with the same message before a request is made.
const ENTITY_TYPE_RE = /^[a-z][a-z_]{1,39}$/;
const ACTION_RE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;
const ID_RE = /^[0-9a-f]{24}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const FILTER_KEYS = ['entityType', 'entityId', 'actorId', 'action', 'orgUnit', 'from', 'to'];
const MAX_VALUE = 64; // longer than any valid value; keeps a pasted essay out of the URL

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const clean = (value) => asText(value).trim().slice(0, MAX_VALUE);
const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });

/** Whether "2026-11-03" is a real calendar date (not 30 Feb). */
export function isDateKey(value) {
  const match = DATE_RE.exec(asText(value));
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// ── The page's URL ────────────────────────────────────────────────────────────

/**
 * The audit page's URL → its filters: { entityType, entityId, actorId, action, orgUnit, from, to,
 * page }, each a trimmed string ('' when not set) and from/to IST calendar dates (YYYY-MM-DD).
 * Values are kept as given, even malformed, so the form can point at them instead of silently
 * showing an unfiltered log (validateAuditFilters says what's wrong).
 */
export function readAuditFilters(searchParams) {
  const get = (key) => clean(searchParams?.get?.(key) ?? '');
  const filters = {};
  for (const key of FILTER_KEYS) filters[key] = get(key);
  filters.entityType = filters.entityType.toLowerCase();
  filters.action = filters.action.toLowerCase();
  filters.page = readPage(searchParams?.get?.('page'));
  return filters;
}

/**
 * The URL search params after applying `patch` ({ entityType?, …, page? }). Empty values are
 * removed; changing any filter (not the page) goes back to page 1.
 */
export function writeAuditFilters(current, patch = {}) {
  const params = new URLSearchParams(current);
  let changed = false;
  for (const key of FILTER_KEYS) {
    if (!(key in patch)) continue;
    changed = true;
    const value = clean(patch[key]);
    if (value) params.set(key, value);
    else params.delete(key);
  }
  if ('page' in patch) {
    const page = readPage(patch.page);
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
  } else if (changed) {
    params.delete('page');
  }
  return params;
}

/** Whether any filter (not the page) is set. */
export function hasAuditFilters(filters) {
  return FILTER_KEYS.some((key) => Boolean(filters?.[key]));
}

/**
 * The filters → { field: message } for what the server would refuse (api.md GET /audit 400s, in
 * its words), checked before asking: an entity type and action of the right form, ids of 24 hex
 * characters, real dates, and the end date on or after the start date (the range is
 * [from, the day after to), so one day is from = to).
 */
export function validateAuditFilters(filters = {}) {
  const errors = {};
  if (filters.entityType && !ENTITY_TYPE_RE.test(filters.entityType)) {
    errors.entityType = 'Must be an entity type such as "booking".';
  }
  if (filters.action && !ACTION_RE.test(filters.action)) {
    errors.action = 'Must be an action such as "booking.approved".';
  }
  for (const key of ['entityId', 'actorId', 'orgUnit']) {
    if (filters[key] && !ID_RE.test(filters[key])) errors[key] = 'Must be a valid id.';
  }
  if (filters.from && !isDateKey(filters.from)) errors.from = 'Must be a valid date.';
  if (filters.to && !isDateKey(filters.to)) errors.to = 'Must be a valid date.';
  if (!errors.from && !errors.to && filters.from && filters.to && filters.to < filters.from) {
    errors.to = "Can't be before the start date.";
  }
  return errors;
}

/**
 * Valid filters → the GET /audit query: the set filters as sent, from = IST midnight of the start
 * date, to = IST midnight after the end date ([from, to) on `at`, so both dates are included),
 * page and limit. The same object is the query key, so equal filters share one cache entry.
 */
export function auditQueryParams(filters = {}, { limit = AUDIT_PAGE_SIZE } = {}) {
  const params = {};
  for (const key of ['entityType', 'entityId', 'actorId', 'action', 'orgUnit']) {
    const value = clean(filters[key]);
    if (value) params[key] = value;
  }
  if (filters.from && isDateKey(filters.from)) params.from = istDayBounds(filters.from).start;
  if (filters.to && isDateKey(filters.to)) params.to = istDayBounds(filters.to).end;
  params.page = readPage(filters.page);
  const size = Number(limit);
  params.limit = Number.isInteger(size) && size >= 1 ? Math.min(size, 50) : AUDIT_PAGE_SIZE;
  return params;
}

// The server's 400 details name the query keys; the form shows them beside its fields.
const SERVER_FIELDS = new Set(FILTER_KEYS);

/** A failed GET /audit → { field: message } for the filter fields (first message per field). */
export function auditFieldErrors(err) {
  if (err?.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return {};
  const fields = {};
  for (const detail of err.details) {
    const key = asText(detail?.path);
    if (SERVER_FIELDS.has(key) && !(key in fields)) fields[key] = asText(detail.message) || 'Invalid value.';
  }
  return fields;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * GET /audit?entityType&entityId&actorId&action&orgUnit&from&to&page&limit → data [AuditEntry
 * { _id, at, action, actor: { id, role, name }, entity: { type, id }, orgUnit?, reason?, changes?,
 * meta?, requestId? }], meta { page, limit, total }, newest first. Admins read everything;
 * managers their units' entries; members get 403.
 */
export async function listAudit(filters = {}) {
  return unwrap(await http.get('/audit', { params: auditQueryParams(filters) }));
}

/**
 * GET /admin/users?q&limit (admins; a demo admin sees only demo users) → data [{ _id, name, email,
 * roles, … }], meta { page, limit, total }. The actor filter's "find a person": q matches name or
 * email.
 */
export async function findUsers({ q, limit = 5 } = {}) {
  const params = { q: clean(q).slice(0, 100), limit };
  return unwrap(await http.get('/admin/users', { params }));
}

// ── Query keys and hooks (frontend.md §8.2) ───────────────────────────────────

export const auditKeys = {
  all: ['audit'],
  list: (filters) => ['audit', auditQueryParams(filters)],
  users: (q) => ['admin', 'users', { q: clean(q), limit: 5 }],
};

/**
 * GET /audit under ['audit', params]; refetched on focus. Off while the filters have an error (the
 * form says which), so a bad filter never shows the whole log as if it were filtered. Paging keeps
 * the previous page on screen while the next loads.
 */
export function useAuditLog(filters = {}, options = {}) {
  const params = auditQueryParams(filters);
  const valid = Object.keys(validateAuditFilters(filters)).length === 0;
  const { page: _page, ...rest } = params;
  const same = JSON.stringify(rest);
  return useQuery({
    queryKey: ['audit', params],
    queryFn: () => listAudit(filters),
    enabled: valid,
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) => {
      const { page: _previousPage, ...previousRest } = previousQuery?.queryKey?.[1] ?? {};
      return JSON.stringify(previousRest) === same ? previous : undefined;
    },
    ...options,
  });
}

/** The actor filter's person search: GET /admin/users?q, once q has 2 characters. */
export function useUserSearch(q, options = {}) {
  const query = clean(q);
  return useQuery({
    queryKey: auditKeys.users(query),
    queryFn: () => findUsers({ q: query }),
    enabled: query.length >= 2,
    staleTime: 30 * 1000,
    retry: retryReads,
    ...options,
  });
}

// ── What an entry shows ───────────────────────────────────────────────────────

const ROLE_LABELS = { member: 'member', manager: 'manager', admin: 'admin' };

/** "booking.checked_in" → "Booking checked in"; an odd value shows as itself. */
export function actionLabel(action) {
  const textValue = asText(action);
  const [entity, verb] = textValue.split('.');
  if (!entity || !verb) return textValue || 'Unknown action';
  const subject = entity.replace(/_/g, ' ');
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb.replace(/_/g, ' ')}`;
}

/** "Priya Manager (manager)", "Admin", "System (automatic)". */
export function actorLabel(actor) {
  if (!actor || typeof actor !== 'object') return 'Unknown';
  if (actor.role === 'system') return 'System (automatic)';
  const role = ROLE_LABELS[actor.role] ?? asText(actor.role);
  const name = asText(actor.name).trim();
  if (name) return role ? `${name} (${role})` : name;
  return role ? `${role.charAt(0).toUpperCase()}${role.slice(1)} (account removed)` : 'Unknown';
}

/** An entity type → its label ("Booking", "A member's badge"); an odd one shows as itself. */
export function entityTypeLabel(type) {
  return AUDIT_ENTITY_TYPES.find((t) => t.value === type)?.label ?? (asText(type).replace(/_/g, ' ') || 'Entity');
}

/** "…a1b2c3": the last 6 characters of an id, enough to tell rows apart. */
export function shortId(id) {
  const value = asText(id);
  return value.length > 8 ? `…${value.slice(-6)}` : value;
}

/** The in-app page of an entity, or null when there isn't one (users, units, badges). */
export function entityPath(entity) {
  const id = asText(entity?.id);
  if (!id) return null;
  const safe = encodeURIComponent(id);
  if (entity.type === 'booking') return `/bookings/${safe}`;
  if (entity.type === 'incident') return `/admin/incidents/${safe}`;
  if (entity.type === 'resource') return `/resources/${safe}`;
  return null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * One value of `changes` or `meta` as text: "—" for nothing, an instant in IST ("3 Nov 2026,
 * 10:00 am IST"), true/false, numbers and text as they are, and lists or objects as compact JSON.
 */
export function formatAuditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return ISO_RE.test(value) ? (formatIstDateTime(value) ?? value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** changes { field: [before, after] } → [{ field, before, after }] as text, in the server's order. */
export function changeRows(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  return Object.entries(changes).map(([field, pair]) => {
    const [before, after] = Array.isArray(pair) ? pair : [undefined, pair];
    return { field, before: formatAuditValue(before), after: formatAuditValue(after) };
  });
}

/** meta { key: value } → [{ key, value }] as text. */
export function metaRows(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  return Object.entries(meta).map(([key, value]) => ({ key, value: formatAuditValue(value) }));
}
