import { useQuery } from '@tanstack/react-query';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';

// What the AI features share (api.md "AI"): the "AI requests left today" quota, the error checks
// that decide between a fallback and an error, and the query keys. The keys sit under ['ai'], not
// ['resources']: a resource change invalidates ['resources'], and an AI answer must never be
// refetched by that (each fetch can spend a request).

const unwrap = (res) => ({ data: res.data?.data });

export const AI_QUESTION_MIN = 3;
export const AI_QUESTION_MAX = 200; // POST /resources/ai-search query: 3–200 characters

/** A question as the server compares and caches it: single-spaced, trimmed, lower case. */
export const normaliseQuestion = (question) =>
  String(question ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export const aiKeys = {
  quota: ['ai', 'quota'],
  search: (question) => ['ai', 'search', normaliseQuestion(question)],
};

/** GET /ai/quota → data { used, limit, remaining, resetsAt, configured }. */
export async function getAiQuota() {
  return unwrap(await http.get('/ai/quota'));
}

/** The quota meter's data, under ['ai', 'quota']; stale after 30 s. */
export function useAiQuota(options = {}) {
  return useQuery({
    queryKey: aiKeys.quota,
    queryFn: getAiQuota,
    staleTime: 30 * 1000,
    retry: retryReads,
    ...options,
  });
}

/**
 * Whether `next` (an answer's quota) is at least as recent as `current`: a later day, or the same day
 * with as many requests used. Answers can arrive out of order; the server counts in request order.
 */
export function isNewerQuota(next, current) {
  if (!current) return true;
  const day = Date.parse(next?.resetsAt) - Date.parse(current?.resetsAt);
  if (Number.isFinite(day) && day !== 0) return day > 0;
  return Number(next?.used) >= Number(current?.used);
}

/** An answer's quota → the cached meter, without another request (never an older count). */
export function storeAiQuota(queryClient, quota) {
  if (!quota) return;
  queryClient.setQueryData(aiKeys.quota, (old) =>
    old?.data && isNewerQuota(quota, old.data) ? { ...old, data: { ...old.data, ...quota } } : old
  );
}

/** 429 AI_QUOTA_EXCEEDED: today's AI requests are used up (details.resetsAt says when they come back). */
export const isAiQuotaOut = (err) => err?.code === 'AI_QUOTA_EXCEEDED';

/** 503 AI_UNAVAILABLE: not configured, paused after a Gemini rate limit, or Redis is down. */
export const isAiUnavailable = (err) => err?.code === 'AI_UNAVAILABLE';

/** "4 of 5 AI requests left today" → null without a quota. */
export function aiQuotaText(quota) {
  const limit = Number(quota?.limit);
  const remaining = Number(quota?.remaining);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;
  return `${Math.max(0, remaining)} of ${limit} AI ${limit === 1 ? 'request' : 'requests'} left today`;
}
