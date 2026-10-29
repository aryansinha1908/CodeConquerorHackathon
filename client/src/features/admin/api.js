import http from '../../lib/http';
import { MEMBER_TYPES } from '../verification/api';

// The admin ID-verification queue (frontend.md §6.4 /admin/verifications; architecture.md §6
// "Verification", §8). Every request function resolves with the success envelope
// { success, data, meta?, requestId } and rejects with lib/http.js's normalised error.

export const QUEUE_STATUSES = ['pending', 'approved', 'rejected'];
export const VERIFICATION_PAGE_SIZE = 10;

export const adminKeys = {
  // frontend.md §8.2 ['admin', 'verifications', status]; the page is appended so pages cache apart,
  // and invalidating the prefix after a decision refreshes every status and page.
  verifications: ['admin', 'verifications'],
  verificationList: (status, page) => ['admin', 'verifications', status, page],
};

/** A ?status= value → one of QUEUE_STATUSES (pending when missing or unknown). */
export function readQueueStatus(value) {
  return QUEUE_STATUSES.includes(value) ? value : 'pending';
}

/** A ?page= value → a whole number ≥ 1. */
export function readPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** meta { page, limit, total } → the number of pages, at least 1. */
export function pageCount(meta) {
  const limit = Number(meta?.limit) || VERIFICATION_PAGE_SIZE;
  const total = Number(meta?.total) || 0;
  return Math.max(1, Math.ceil(total / limit));
}

/**
 * GET /admin/verifications?status&page&limit → data [{ user: { _id, name, email, emailHints,
 * memberType, department }, status, submittedAt, reviewedAt, reason, hasIdCard }],
 * meta { page, limit, total }. Pending is oldest submission first.
 */
export async function listVerifications({
  status = 'pending',
  page = 1,
  limit = VERIFICATION_PAGE_SIZE,
} = {}) {
  const res = await http.get('/admin/verifications', { params: { status, page, limit } });
  return res.data;
}

/**
 * GET /admin/verifications/:userId/id-card → data { url, expiresAt }. Every call is audited
 * ("verification.id_viewed") and the URL stops working within 5 minutes, so callers fetch it for
 * each view and never keep it in the query cache.
 */
export async function getIdCardUrl(userId) {
  const res = await http.get(`/admin/verifications/${encodeURIComponent(userId)}/id-card`);
  return res.data;
}

/**
 * GET /admin/verifications/:userId/id-card/file → the card's image as a Blob, for the on-device check
 * (FC-12). Audited like the link, and counted with it by the fileLink limit. Errors are normalised as
 * usual (lib/http.js reads a JSON error from the Blob). `signal` cancels it.
 */
export async function getIdCardFile(userId, { signal } = {}) {
  const res = await http.get(`/admin/verifications/${encodeURIComponent(userId)}/id-card/file`, {
    responseType: 'blob',
    signal,
  });
  return res.data;
}

/**
 * PATCH /admin/verifications/:userId { decision, reason?, memberType?, department?, submittedAt } →
 * data = the queue item. submittedAt is the reviewed item's own value (null when it had none); the
 * user must still be pending with that same submission, else 409 INVALID_TRANSITION.
 */
export async function decideVerification(userId, body) {
  const res = await http.patch(`/admin/verifications/${encodeURIComponent(userId)}`, body);
  return res.data;
}

// backend.md §7 admin.verify: reason safeText(5, 500), required when rejecting.
export const REASON_MIN = 5;
export const REASON_MAX = 500;

/**
 * The decision form { decision, reason, memberType, department } → { body, errors }. body is null
 * while errors has any field. Approving confirms the member type and department (the admin may
 * correct them) and may carry a note; rejecting needs a reason and sends nothing else, as the user
 * picks again on re-upload. Either text is 5–500 characters. The server checks all of it again.
 */
export function readDecision({ decision, reason, memberType, department } = {}) {
  const errors = {};
  const text = typeof reason === 'string' ? reason.trim() : '';

  if (decision !== 'approve' && decision !== 'reject') {
    errors.decision = 'Choose approve or reject.';
  }
  // The server reads any non-empty reason as safeText(5, 500), an approval's optional note too.
  if (!text && decision === 'reject') errors.reason = 'A reason is required to reject.';
  else if (text && text.length < REASON_MIN) errors.reason = `Use at least ${REASON_MIN} characters.`;
  if (text.length > REASON_MAX) errors.reason = `Use at most ${REASON_MAX} characters.`;
  if (decision === 'approve') {
    if (!MEMBER_TYPES.includes(memberType)) errors.memberType = 'Confirm the member type.';
    if (!department) errors.department = 'Confirm the department.';
  }

  if (Object.keys(errors).length) return { body: null, errors };
  const body =
    decision === 'reject'
      ? { decision, reason: text }
      : { decision, memberType, department, ...(text && { reason: text }) };
  return { body, errors };
}
