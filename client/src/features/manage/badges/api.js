import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../../lib/http';
import { retryReads } from '../../../lib/errors';

// The manager's badge queue (frontend.md §6.3 /manage/badges; api.md "Badges and badge requests";
// judge step 4). One function per route, each resolving with { data, meta } from the success
// envelope and rejecting with lib/http.js's normalised error. Nothing is applied optimistically:
// a decision or a grant waits for the server, then the queue and the member's badges refetch.

export const BADGE_REQUEST_STATUSES = ['requested', 'active', 'rejected', 'revoked'];
export const BADGE_REQUESTS_PAGE_SIZE = 10;
export const BADGE_TEXT_MAX = 500; // reject reason, grant note (api.md: ≤ 500)

const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A ?status= value → one of BADGE_REQUEST_STATUSES (requested when missing or unknown). */
export function readBadgeRequestStatus(value) {
  return BADGE_REQUEST_STATUSES.includes(value) ? value : 'requested';
}

/** GET /badge-requests params → the normalised { status, page, limit } of the request and key. */
export function badgeRequestParams({ status, page = 1, limit = BADGE_REQUESTS_PAGE_SIZE } = {}) {
  return {
    status: readBadgeRequestStatus(status),
    page: Number(page) || 1,
    limit: Number(limit) || BADGE_REQUESTS_PAGE_SIZE,
  };
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * GET /badge-requests?status&page&limit (managers: their units' badges; admins: all) → data [queue
 * row: member row + user { _id, name, memberType, department }, decidedBy, evidence], meta { page,
 * limit, total }. `requested` comes oldest request first; the others newest decision first.
 */
export async function listBadgeRequests(params = {}) {
  return unwrap(await http.get('/badge-requests', { params: badgeRequestParams(params) }));
}

/**
 * PATCH /badge-requests/:id { decision: approve | reject, reason (required to reject, ≤ 500) } →
 * data queue row (active with expiresAt, or rejected with reason). Approving sends no reason.
 */
export async function decideBadgeRequest(id, { decision, reason } = {}) {
  const clean = text(reason);
  const body = decision === 'reject' ? { decision, reason: clean } : { decision };
  return unwrap(await http.patch(`/badge-requests/${encodeURIComponent(id)}`, body));
}

/**
 * GET /badge-requests/:id/evidence → data { url, expiresAt }: a download link that stops working
 * within 5 minutes, sent with Cache-Control: no-store and audited ("badge.evidence_viewed") on
 * every call. Fetch it for each view and never keep it in the query cache. 404 without evidence.
 */
export async function getBadgeEvidenceUrl(id) {
  return unwrap(await http.get(`/badge-requests/${encodeURIComponent(id)}/evidence`));
}

/**
 * GET /badges?orgUnit → data [Badge { _id, name, code, orgUnit: { _id, name, code, isActive },
 * description?, validityDays, evidenceRequired, selfServe }], sorted by name (no meta). Without
 * orgUnit: every active unit's badges.
 */
export async function listBadges({ orgUnit } = {}) {
  return unwrap(await http.get('/badges', { params: orgUnit ? { orgUnit } : {} }));
}

/**
 * POST /badges/:id/grant { email, note? } → data queue row (status active, expiresAt now +
 * validityDays or null). The email is matched exactly, ignoring case; an unknown one is 400 on
 * "email". The note goes to the audit log only.
 */
export async function grantBadge(badgeId, { email, note } = {}) {
  const cleanNote = text(note);
  const body = { email: text(email), ...(cleanNote && { note: cleanNote }) };
  return unwrap(await http.post(`/badges/${encodeURIComponent(badgeId)}/grant`, body));
}

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────

export const badgeRequestKeys = {
  all: ['badge-requests'],
  list: (params) => ['badge-requests', badgeRequestParams(params)],
};

export const badgeKeys = {
  all: ['badges'],
  mine: ['badges', 'mine'],
  // Not ['badges'] itself: the member's /badges page owns that key. A prefix invalidation of
  // ['badges'] (a new badge) still refreshes this.
  catalogue: (orgUnit) => ['badges', 'catalogue', { orgUnit: orgUnit ?? null }],
};

// A decision or grant changes the queue and the member's own badges (frontend.md §8.2 "Badge
// decision"); the eligibility checklist reads badges live on the server, so it needs nothing here.
const DECISION_KEYS = [badgeRequestKeys.all, badgeKeys.mine];

// The screen is out of date: decided by someone else, or gone.
const STALE_CODES = new Set(['INVALID_TRANSITION', 'NOT_FOUND']);

function invalidate(queryClient, keys) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * GET /badge-requests under ['badge-requests', { status, page, limit }]; refetched on focus
 * (frontend.md §8.2). The previous page stays while the next loads, for the same status only.
 */
export function useBadgeRequests(params = {}, options = {}) {
  const normalised = badgeRequestParams(params);
  return useQuery({
    queryKey: badgeRequestKeys.list(normalised),
    queryFn: () => listBadgeRequests(normalised),
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[1]?.status === normalised.status ? previous : undefined,
    ...options,
  });
}

/**
 * PATCH /badge-requests/:id. mutate({ id, decision, reason? }). Its onSuccess returns the
 * invalidation, so `isPending` stays true until the queue shows the server's new state.
 */
export function useDecideBadgeRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }) => decideBadgeRequest(id, { decision, reason }),
    onSuccess: () => invalidate(queryClient, DECISION_KEYS),
    onError: (err) => {
      if (STALE_CODES.has(err?.code)) invalidate(queryClient, [badgeRequestKeys.all]);
    },
  });
}

/** POST /badges/:id/grant. mutate({ badgeId, email, note? }). */
export function useGrantBadge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ badgeId, email, note }) => grantBadge(badgeId, { email, note }),
    onSuccess: () => invalidate(queryClient, DECISION_KEYS),
    onError: (err) => {
      // "Badge not found.": the picker is out of date.
      if (err?.code === 'NOT_FOUND') invalidate(queryClient, [badgeKeys.all]);
    },
  });
}

/**
 * The badges this user may grant (api.md grant: "a manager of the issuing unit, or an admin"): one
 * GET /badges?orgUnit= per unit they manage, or every badge for an admin. → { badges (by unit, then
 * name), units: how many units were asked, isPending, isFetching, error, refetch }.
 */
export function useGrantableBadges(unitIds, { all = false, enabled = true } = {}) {
  const units = all ? [null] : Array.isArray(unitIds) ? unitIds : [];
  return useQueries({
    queries: units.map((orgUnit) => ({
      queryKey: badgeKeys.catalogue(orgUnit),
      queryFn: () => listBadges({ orgUnit }),
      enabled,
      staleTime: 60 * 1000,
      retry: retryReads,
    })),
    combine: (results) => {
      const seen = new Set();
      const badges = [];
      for (const result of results) {
        for (const badge of Array.isArray(result.data?.data) ? result.data.data : []) {
          if (!badge?._id || seen.has(badge._id)) continue;
          seen.add(badge._id);
          badges.push(badge);
        }
      }
      return {
        badges,
        units: results.length,
        isPending: results.some((r) => r.isPending && r.fetchStatus !== 'idle'),
        isFetching: results.some((r) => r.isFetching),
        error: results.find((r) => r.error)?.error ?? null,
        refetch: () => Promise.all(results.map((r) => r.refetch())),
      };
    },
  });
}
