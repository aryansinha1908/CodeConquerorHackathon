import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';
import { toDate } from '../../lib/time';
import { toPhotoRefs } from '../uploads/api';

// Bookings (api.md "Bookings"; frontend.md §6.2, §6.3, §8.2). One function per route. Each resolves
// with { data, meta } from the success envelope (meta only on the paged lists) and rejects with
// lib/http.js's normalised error { status, code, message, details, retryAfter, requestId }.
// Nothing here falls back to made-up data, and no lifecycle action is applied optimistically: the
// hooks wait for the server, then refetch what changed.

// ── Values ────────────────────────────────────────────────────────────────────

export { BOOKING_STATUSES } from '../../lib/bookingStatus';

// GET /bookings/:id allowedActions, by state-machine name.
export const BOOKING_ACTIONS = [
  'approve',
  'reject',
  'waitlist',
  'cancel',
  'checkIn',
  'checkOut',
  'confirmOk',
  'confirmIssue',
];

// My bookings tabs (frontend.md §6.2): Upcoming · Requests (with waitlist position) · Past.
export const MINE_TABS = [
  { id: 'upcoming', label: 'Upcoming', statuses: ['approved', 'checked_in'] },
  { id: 'requests', label: 'Requests', statuses: ['pending', 'waitlisted'] },
  {
    id: 'past',
    label: 'Past',
    statuses: ['checked_out', 'completed', 'flagged', 'rejected', 'cancelled', 'expired', 'no_show'],
  },
];

// Field limits from api.md, for counters and instant checks (the server checks them again).
export const PURPOSE_MIN = 10;
export const PURPOSE_MAX = 300;
export const DECISION_TEXT_MAX = 500; // approve note, reject / waitlist / cancel reason
export const ITEM_NOTE_MAX = 200; // a checklist item's note
export const REPORT_NOTES_MAX = 1000; // check-in / check-out notes, the return note
export const INCIDENT_DESCRIPTION_MIN = 20;
export const INCIDENT_DESCRIPTION_MAX = 2000;
export const CHECK_IN_OPENS_MINUTES = 15; // check-in opens 15 minutes before start, closes at end
export const OVERDUE_GRACE_MINUTES = 15;

export const CONDITION_OVERALL = [
  { value: 'good', label: 'Good condition' },
  { value: 'minor_issue', label: 'Minor issue' },
  { value: 'damaged', label: 'Damaged' },
];
export const INCIDENT_TYPES = [
  { value: 'damage', label: 'Damage' },
  { value: 'delay', label: 'Late return' },
  { value: 'misuse', label: 'Misuse' },
  { value: 'safety', label: 'Safety' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'other', label: 'Other' },
];
export const INCIDENT_SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const MINE_PAGE_SIZE = 20;
export const MANAGE_PAGE_SIZE = 20;

// ── Small helpers ─────────────────────────────────────────────────────────────

/** A reference that may be populated ({ _id, … }) or a bare id → the id, or null. */
export function idOf(ref) {
  if (ref == null) return null;
  if (typeof ref === 'object') return ref._id != null ? String(ref._id) : null;
  return String(ref);
}

/** Whether GET /bookings/:id lets this viewer take `action` now (allowedActions). */
export function canDo(booking, action) {
  return Array.isArray(booking?.allowedActions) && booking.allowedActions.includes(action);
}

/** Whether `user` is the booking's borrower (a borrower may cancel without a reason). */
export function isBorrower(booking, user) {
  const borrower = idOf(booking?.borrower);
  return Boolean(borrower && user?._id && borrower === String(user._id));
}

/** The instant check-in opens: 15 minutes before start. Null without a valid start. */
export function checkInOpensAt(booking) {
  const start = toDate(booking?.start);
  return start ? new Date(start.getTime() - CHECK_IN_OPENS_MINUTES * 60 * 1000).toISOString() : null;
}

/**
 * The newest condition report of a phase (check_in | check_out | return_confirmation) in timeline
 * items, or null: the check-out step shows the check-in photos, the return check shows both.
 */
export function latestReport(items, phase) {
  const reports = (Array.isArray(items) ? items : []).filter(
    (item) => item?.kind === 'condition_report' && item.phase === phase
  );
  return reports.length ? reports[reports.length - 1] : null;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const toIso = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : value;
};

// 'approved,checked_in' from a list or a string; undefined when empty.
function statusParam(status) {
  const list = Array.isArray(status) ? status : typeof status === 'string' ? status.split(',') : [];
  const clean = list.map((s) => String(s).trim()).filter(Boolean);
  return clean.length ? clean.join(',') : undefined;
}

// Drop undefined, null and '' so they never reach the query string.
function compact(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const path = (id, suffix = '') => `/bookings/${encodeURIComponent(id)}${suffix}`;

/**
 * GET /bookings/mine params → the normalised { status, page, limit } used for both the request
 * and the query key, so equal filters share one cache entry.
 */
export function mineParams({ status, page = 1, limit = MINE_PAGE_SIZE } = {}) {
  return { status: statusParam(status) ?? null, page: Number(page) || 1, limit: Number(limit) || MINE_PAGE_SIZE };
}

/** GET /bookings/manage filters → the normalised object of the request and the query key. */
export function manageParams({ status, resourceId, from, to, page = 1, limit = MANAGE_PAGE_SIZE } = {}) {
  return compact({
    status: text(status) || undefined,
    resourceId: resourceId || undefined,
    from: from ? toIso(from) : undefined,
    to: to ? toIso(to) : undefined,
    page: Number(page) || 1,
    limit: Number(limit) || MANAGE_PAGE_SIZE,
  });
}

/**
 * A condition report from a form → the check-in / check-out body (api.md): items [{ label, ok,
 * note? }] with notes trimmed and blank ones left out, overall, notes? and photos? ({ url, publicId }
 * only). Empty optional fields are not sent.
 */
export function buildReportBody({ items, overall, notes, photos } = {}) {
  const body = {
    items: (Array.isArray(items) ? items : []).map((item) => {
      const note = text(item?.note);
      return { label: item?.label, ok: Boolean(item?.ok), ...(note && { note }) };
    }),
    overall,
  };
  const cleanNotes = text(notes);
  if (cleanNotes) body.notes = cleanNotes;
  const refs = toPhotoRefs(photos);
  if (refs.length) body.photos = refs;
  return body;
}

/**
 * The return check from a form → the confirm-return body: outcome, items? (the full checklist,
 * only when answered), photos?, note? and, for an issue only, incident { type, severity,
 * description }.
 */
export function buildReturnBody({ outcome, items, photos, note, incident } = {}) {
  const body = { outcome };
  const report = buildReportBody({ items, photos });
  if (report.items.length) body.items = report.items;
  if (report.photos) body.photos = report.photos;
  const cleanNote = text(note);
  if (cleanNote) body.note = cleanNote;
  if (outcome === 'issue' && incident) {
    body.incident = {
      type: incident.type,
      severity: incident.severity,
      description: text(incident.description),
    };
  }
  return body;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * POST /bookings/check { resourceId, start, end } → data { eligible, outcome, results: [12 rules],
 * waitlistPosition }. Nothing is saved; a suspended or unverified user gets failed rules, not 403.
 */
export async function checkBooking({ resourceId, start, end }) {
  const res = await http.post('/bookings/check', { resourceId, start: toIso(start), end: toIso(end) });
  return unwrap(res);
}

/**
 * POST /bookings { resourceId, start, end, purpose, joinWaitlist? } → 201 data { booking,
 * evaluation, waitlistPosition }. joinWaitlist is sent only when true (offer it after 409
 * SLOT_TAKEN). 422 INELIGIBLE carries the failed rules in details.
 */
export async function createBooking({ resourceId, start, end, purpose, joinWaitlist = false }) {
  const res = await http.post('/bookings', {
    resourceId,
    start: toIso(start),
    end: toIso(end),
    purpose: text(purpose),
    ...(joinWaitlist === true && { joinWaitlist: true }),
  });
  return unwrap(res);
}

/**
 * GET /bookings/mine?status&page&limit → data [Booking with resource { _id, title, slug, location },
 * waitlistPosition on waitlisted ones], meta { page, limit, total }. Latest start first. `status` is
 * one status, a list or a comma list.
 */
export async function listMyBookings(params = {}) {
  const { status, page, limit } = mineParams(params);
  const res = await http.get('/bookings/mine', { params: compact({ status, page, limit }) });
  return unwrap(res);
}

/**
 * GET /bookings/manage?status&resourceId&from&to&page&limit (managers: their units; admins: all).
 * Without status=pending: data [Booking with resource { _id, title, slug, quantity } and borrower
 * { _id, name, memberType, department }], earliest start first. With status=pending: data [conflict
 * group { resource, start, end, bookings: [Booking] }], oldest pending first; meta.total counts
 * groups. `from`/`to` bound `start` as [from, to).
 */
export async function listManageBookings(filters = {}) {
  const res = await http.get('/bookings/manage', { params: manageParams(filters) });
  return unwrap(res);
}

/**
 * GET /bookings/:id → data Booking with resource { _id, title, slug, location, bookingMode,
 * checklist }, borrower, orgUnit { _id, name, code }, allowedActions, isOverdue, waitlistPosition.
 */
export async function getBooking(id) {
  return unwrap(await http.get(path(id)));
}

/** GET /bookings/:id/timeline → data [event | condition_report | incident], oldest first. */
export async function getBookingTimeline(id) {
  return unwrap(await http.get(path(id, '/timeline')));
}

/** POST /bookings/:id/approve { note? (≤500) } → data Booking (approved). */
export async function approveBooking(id, { note } = {}) {
  const clean = text(note);
  return unwrap(await http.post(path(id, '/approve'), clean ? { note: clean } : {}));
}

/** POST /bookings/:id/reject { reason (required, ≤500) } → data Booking (rejected). */
export async function rejectBooking(id, { reason } = {}) {
  return unwrap(await http.post(path(id, '/reject'), { reason: text(reason) }));
}

/** POST /bookings/:id/waitlist { reason (required, ≤500) } → data Booking (waitlisted). */
export async function waitlistBooking(id, { reason } = {}) {
  return unwrap(await http.post(path(id, '/waitlist'), { reason: text(reason) }));
}

/**
 * POST /bookings/:id/cancel { reason? (≤500) } → data Booking (cancelled). The borrower may leave
 * the reason out; a manager or admin must give one.
 */
export async function cancelBooking(id, { reason } = {}) {
  const clean = text(reason);
  return unwrap(await http.post(path(id, '/cancel'), clean ? { reason: clean } : {}));
}

/** POST /bookings/:id/check-in { items, overall, notes?, photos? } → data Booking (checked_in). */
export async function checkInBooking(id, report = {}) {
  return unwrap(await http.post(path(id, '/check-in'), buildReportBody(report)));
}

/** POST /bookings/:id/check-out (same body as check-in) → data Booking (checked_out). */
export async function checkOutBooking(id, report = {}) {
  return unwrap(await http.post(path(id, '/check-out'), buildReportBody(report)));
}

/**
 * POST /bookings/:id/confirm-return { outcome, items?, photos?, note?, incident? } → 200 data
 * { booking (completed | flagged), incident (null, or the new incident with bare ids) }.
 */
export async function confirmBookingReturn(id, input = {}) {
  return unwrap(await http.post(path(id, '/confirm-return'), buildReturnBody(input)));
}

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────

export const bookingKeys = {
  all: ['bookings'], // every list: invalidating it refreshes mine and manage
  mine: ['bookings', 'mine'],
  mineList: (params) => ['bookings', 'mine', mineParams(params)],
  manage: ['bookings', 'manage'],
  manageList: (filters) => ['bookings', 'manage', manageParams(filters)],
  detail: (id) => ['booking', id], // also matches ['booking', id, 'timeline'] when invalidated
  timeline: (id) => ['booking', id, 'timeline'],
};

// The resource page's keys (frontend.md §8.2) that a booking change makes stale.
export const resourceBookingKeys = {
  availability: (resourceId) => ['resource', resourceId, 'availability'],
  eligibility: (resourceId) => ['resource', resourceId, 'eligibility'],
};

/**
 * The query keys a booking change makes stale (frontend.md §8.2, as prefixes): every booking list,
 * the booking and its timeline, the resource's availability and eligibility, and the incident lists
 * when an incident was opened.
 */
export function keysToInvalidate({ id, resourceId, incident = false } = {}) {
  const keys = [bookingKeys.all];
  if (id) keys.push(bookingKeys.detail(id));
  if (resourceId) {
    keys.push(resourceBookingKeys.availability(resourceId), resourceBookingKeys.eligibility(resourceId));
  }
  if (incident) keys.push(['incidents']);
  return keys;
}

function invalidate(queryClient, keys) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

// Errors that mean what the screen shows is out of date: refetch it so the user sees the current
// state (the message says whether to reload).
const STALE_CODES = new Set(['INVALID_TRANSITION', 'NOT_FOUND', 'SLOT_TAKEN', 'INELIGIBLE']);

// ── Query hooks ───────────────────────────────────────────────────────────────

/** GET /bookings/:id under ['booking', id]; refetched on focus. data: { data: Booking }. */
export function useBooking(id, options = {}) {
  return useQuery({
    queryKey: bookingKeys.detail(id),
    queryFn: () => getBooking(id),
    enabled: Boolean(id),
    staleTime: 0,
    retry: retryReads,
    ...options,
  });
}

// ── QR booking pass (backend.md C-04, frontend.md FC-05) ──────────────────────

/** Pass refresh: the server's passes last 2 minutes; a fresh one every minute keeps the QR valid. */
export const PASS_REFRESH_MS = 60_000;

/** POST /bookings/:id/pass (the borrower) → envelope; data { token, code, expiresAt, issuedAt, phase, verifiedAt }. */
export async function getBookingPass(id) {
  const res = await http.post(`/bookings/${encodeURIComponent(id)}/pass`);
  return res.data;
}

/** GET /bookings/:id/pass (the borrower) → envelope; data { phase, verifiedAt }: the light read to poll. */
export async function getPassStatus(id) {
  const res = await http.get(`/bookings/${encodeURIComponent(id)}/pass`);
  return res.data;
}

/** POST /bookings/scan { token } | { code } (the unit's managers) → envelope; data { booking, phase, next, isOverdue, verifiedAt, recorded }. */
export async function scanBookingPass(body) {
  const res = await http.post('/bookings/scan', body);
  return res.data;
}

/** How often an open, not yet verified pass asks whether the unit has scanned it. */
export const PASS_STATUS_POLL_MS = 15_000;

/**
 * The borrower's pass while it's on screen, refetched every minute (`refresh: false` stops that, once
 * the pass has been verified). Never cached once closed.
 */
export function useBookingPass(id, { enabled = true, refresh = true } = {}) {
  return useQuery({
    queryKey: [...bookingKeys.detail(id), 'pass'],
    queryFn: () => getBookingPass(id),
    enabled: Boolean(id) && enabled,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: refresh ? PASS_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    retry: retryReads,
  });
}

/** Whether the unit has verified the pass: polled while the pass is open, until it's verified. */
export function usePassStatus(id, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...bookingKeys.detail(id), 'pass-status'],
    queryFn: () => getPassStatus(id),
    enabled: Boolean(id) && enabled,
    staleTime: 0,
    // Stops by itself once the answer says it's verified.
    refetchInterval: (query) => (query.state.data?.data?.verifiedAt ? false : PASS_STATUS_POLL_MS),
    refetchIntervalInBackground: false,
    retry: retryReads,
  });
}

/** A scan: the booking's lists and timeline change (an audit entry), so refresh them. */
export function useScanPass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scanBookingPass,
    onSuccess: (envelope) => {
      const id = envelope?.data?.booking?._id;
      if (id) queryClient.invalidateQueries({ queryKey: bookingKeys.timeline(String(id)) });
    },
  });
}

/** GET /bookings/:id/timeline under ['booking', id, 'timeline']. data: { data: [items] }. */
export function useTimeline(id, options = {}) {
  return useQuery({
    queryKey: bookingKeys.timeline(id),
    queryFn: () => getBookingTimeline(id),
    enabled: Boolean(id),
    staleTime: 0,
    retry: retryReads,
    ...options,
  });
}

/**
 * GET /bookings/mine under ['bookings', 'mine', { status, page, limit }]; refetched on focus. The
 * previous page stays on screen while the next loads, but never another tab's rows.
 */
export function useMyBookings(params = {}, options = {}) {
  const normalised = mineParams(params);
  return useQuery({
    queryKey: bookingKeys.mineList(normalised),
    queryFn: () => listMyBookings(normalised),
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[2]?.status === normalised.status ? previous : undefined,
    ...options,
  });
}

/**
 * GET /bookings/manage under ['bookings', 'manage', filters]; refetched every 30 s while the page is
 * open (frontend.md §8.2). The previous page stays while the next loads, for the same status only.
 */
export function useManageBookings(filters = {}, options = {}) {
  const normalised = manageParams(filters);
  return useQuery({
    queryKey: bookingKeys.manageList(normalised),
    queryFn: () => listManageBookings(normalised),
    staleTime: 0,
    refetchInterval: 30 * 1000,
    retry: retryReads,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[2]?.status === normalised.status ? previous : undefined,
    ...options,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────
// Each hook's onSuccess returns the invalidation, so `isPending` stays true until the changed
// queries have refetched and the page shows the server's new state. Pass per-call callbacks to
// mutate(vars, { onSuccess, onError }) for navigation, toasts and focus.

function useBookingMutation(send, { keysFor }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (result, vars) => invalidate(queryClient, keysToInvalidate(keysFor(result, vars))),
    onError: (err, vars) => {
      if (STALE_CODES.has(err?.code)) invalidate(queryClient, keysToInvalidate(keysFor(null, vars)));
    },
  });
}

// For the lifecycle actions the variables are { id, resourceId?, ...body }: resourceId (optional,
// never sent) refreshes the resource's availability when the result doesn't name it.
const lifecycleKeys = (result, vars) => ({
  id: vars?.id,
  resourceId: idOf(result?.data?.resource) ?? idOf(result?.data?.booking?.resource) ?? vars?.resourceId,
});

/** POST /bookings. mutate({ resourceId, start, end, purpose, joinWaitlist? }). */
export function useCreateBooking() {
  return useBookingMutation(createBooking, {
    keysFor: (result, vars) => ({
      id: idOf(result?.data?.booking),
      resourceId: vars?.resourceId,
    }),
  });
}

/** mutate({ id, note?, resourceId? }) */
export function useApproveBooking() {
  return useBookingMutation(({ id, note }) => approveBooking(id, { note }), { keysFor: lifecycleKeys });
}

/** mutate({ id, reason, resourceId? }) */
export function useRejectBooking() {
  return useBookingMutation(({ id, reason }) => rejectBooking(id, { reason }), { keysFor: lifecycleKeys });
}

/** mutate({ id, reason, resourceId? }) */
export function useWaitlistBooking() {
  return useBookingMutation(({ id, reason }) => waitlistBooking(id, { reason }), {
    keysFor: lifecycleKeys,
  });
}

/** mutate({ id, reason?, resourceId? }) */
export function useCancelBooking() {
  return useBookingMutation(({ id, reason }) => cancelBooking(id, { reason }), { keysFor: lifecycleKeys });
}

/** mutate({ id, items, overall, notes?, photos?, resourceId? }) */
export function useCheckIn() {
  return useBookingMutation(({ id, ...report }) => checkInBooking(id, report), { keysFor: lifecycleKeys });
}

/** mutate({ id, items, overall, notes?, photos?, resourceId? }) */
export function useCheckOut() {
  return useBookingMutation(({ id, ...report }) => checkOutBooking(id, report), {
    keysFor: lifecycleKeys,
  });
}

/** mutate({ id, outcome, items?, photos?, note?, incident?, resourceId? }) */
export function useConfirmReturn() {
  return useBookingMutation(({ id, ...input }) => confirmBookingReturn(id, input), {
    keysFor: (result, vars) => ({
      ...lifecycleKeys(result, vars),
      incident: Boolean(result?.data?.incident) || vars?.outcome === 'issue',
    }),
  });
}
