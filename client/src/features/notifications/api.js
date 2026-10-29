import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';

// Notifications (api.md "Notifications"; frontend.md §6.2 /notifications, §7 NotificationBell,
// §8.2). One function per route, each resolving with { data, meta } from the success envelope and
// rejecting with lib/http.js's normalised error { status, code, message, details, requestId }.
//
// The bell's count lives under ['notifications', 'unread-count'] and is polled every 30 s. Every
// list answer carries meta.unread (the bell count whatever the filter), so each list fetch writes
// it into that key too: the bell never disagrees with the page the user is looking at. "Mark read"
// is the one optimistic update in the app (frontend.md §8.2); it is rolled back if the server
// refuses it, and every notification query is refetched once it settles either way.

export const NOTIFICATIONS_PAGE_SIZE = 20;
export const BELL_LIMIT = 5; // the bell's dropdown: the latest 5
export const UNREAD_POLL_MS = 30 * 1000;

const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const path = (id, suffix = '') => `/notifications/${encodeURIComponent(id)}${suffix}`;

/**
 * GET /notifications params → the normalised { unread, page, limit } used for both the request and
 * the query key, so equal filters share one cache entry. `unread` is true only for true / 'true'.
 */
export function notificationParams({ unread = false, page = 1, limit = NOTIFICATIONS_PAGE_SIZE } = {}) {
  return {
    unread: unread === true || unread === 'true',
    page: Number(page) || 1,
    limit: Number(limit) || NOTIFICATIONS_PAGE_SIZE,
  };
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * GET /notifications?unread&page&limit → data [Notification { _id, type, title, body, link, readAt,
 * createdAt, updatedAt }], meta { page, limit, total, unread }. Newest first. `unread` is sent only
 * when true: the server takes only the exact strings true and false.
 */
export async function listNotifications(params = {}) {
  const { unread, page, limit } = notificationParams(params);
  const res = await http.get('/notifications', {
    params: { ...(unread && { unread: true }), page, limit },
  });
  return unwrap(res);
}

/** GET /notifications/unread-count → data { count } (no meta). */
export async function getUnreadCount() {
  return unwrap(await http.get('/notifications/unread-count'));
}

/** PATCH /notifications/:id/read → data Notification (readAt kept from the first read). */
export async function markNotificationRead(id) {
  return unwrap(await http.patch(path(id, '/read')));
}

/** PATCH /notifications/read-all → data { updated } (how many were unread). */
export async function markAllNotificationsRead() {
  return unwrap(await http.patch('/notifications/read-all'));
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** The cached unread-count answer ({ data: { count } }) → a whole number, or null before it loads. */
export function unreadCountOf(result) {
  const count = Number(result?.data?.count);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

/** The bell badge's text: "3", or "9+" past nine. Empty for none. */
export function unreadBadgeText(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}

/** The bell button's accessible name: "Notifications, 3 unread" or "Notifications". */
export function bellLabel(count) {
  const n = Number(count) || 0;
  return n > 0 ? `Notifications, ${n} unread` : 'Notifications';
}

/**
 * Whether a notification's link is an in-app path the router can open: it starts with one "/"
 * (api.md: "link is always an in-app path"). Anything else ("//evil.example", "https://…",
 * "javascript:…") is never followed.
 */
export function isInAppPath(link) {
  return typeof link === 'string' && /^\/(?![/\\])/.test(link);
}

export function isUnread(notification) {
  return Boolean(notification) && !notification.readAt;
}

/**
 * A cached list answer { data: [Notification], meta } with one notification marked read at
 * `readAt` → a new answer (meta.unread one lower when it was unread). Anything else comes back as
 * it was, so the optimistic update never invents a list.
 */
export function markReadInList(result, id, readAt) {
  if (!result || !Array.isArray(result.data)) return result;
  let changed = false;
  const data = result.data.map((item) => {
    if (item?._id !== id || item.readAt) return item;
    changed = true;
    return { ...item, readAt };
  });
  if (!changed) return result;
  const unread = Number(result.meta?.unread);
  const meta = result.meta
    ? { ...result.meta, ...(Number.isFinite(unread) && { unread: Math.max(0, unread - 1) }) }
    : result.meta;
  return { ...result, data, meta };
}

/** Whether a cached list answer holds `id` as an unread notification. */
export function holdsUnread(result, id) {
  return Array.isArray(result?.data) && result.data.some((item) => item?._id === id && !item.readAt);
}

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────

export const notificationKeys = {
  all: ['notifications'], // invalidating it refreshes the count and every list
  unreadCount: ['notifications', 'unread-count'],
  lists: ['notifications', 'list'],
  list: (params) => ['notifications', 'list', notificationParams(params)],
};

const countAnswer = (count) => ({ data: { count } });

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * GET /notifications/unread-count under ['notifications', 'unread-count'], polled every 30 s.
 * React Query skips an interval tick while the tab is hidden (refetchIntervalInBackground is off)
 * and refetches as soon as it is visible again. Pass `enabled: false` while signed out.
 */
export function useUnreadCount({ enabled = true } = {}) {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: getUnreadCount,
    enabled,
    staleTime: 0,
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: retryReads,
  });
}

/**
 * GET /notifications under ['notifications', 'list', { unread, page, limit }]; refetched on mount
 * and focus. Each answer's meta.unread also sets the bell count. The previous page stays on screen
 * while the next loads, but never the other filter's rows.
 */
export function useNotifications(params = {}, options = {}) {
  const queryClient = useQueryClient();
  const normalised = notificationParams(params);
  return useQuery({
    queryKey: notificationKeys.list(normalised),
    queryFn: async () => {
      const result = await listNotifications(normalised);
      const unread = Number(result.meta?.unread);
      if (Number.isFinite(unread) && unread >= 0) {
        queryClient.setQueryData(notificationKeys.unreadCount, countAnswer(unread));
      }
      return result;
    },
    staleTime: 0,
    retry: retryReads,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[2]?.unread === normalised.unread ? previous : undefined,
    ...options,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

/**
 * PATCH /notifications/:id/read, optimistic (frontend.md §8.2): mutate(id) marks the notification
 * read in every cached list and lowers the bell count at once; a refusal (403 suspended, 404 gone,
 * a network failure) puts both back. Either way every notification query refetches afterwards.
 * The callbacks live here, not in mutate(), so they still run when the bell's dropdown that
 * started the request has closed.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const lists = queryClient.getQueriesData({ queryKey: notificationKeys.lists });
      const count = queryClient.getQueryData(notificationKeys.unreadCount);
      const readAt = new Date().toISOString();
      const wasUnread = lists.some(([, data]) => holdsUnread(data, id));
      for (const [key, data] of lists) queryClient.setQueryData(key, markReadInList(data, id, readAt));
      const current = unreadCountOf(count);
      if (wasUnread && current !== null) {
        queryClient.setQueryData(notificationKeys.unreadCount, countAnswer(Math.max(0, current - 1)));
      }
      return { lists, count };
    },
    onError: (_err, _id, context) => {
      for (const [key, data] of context?.lists ?? []) queryClient.setQueryData(key, data);
      if (context && context.count !== undefined) {
        queryClient.setQueryData(notificationKeys.unreadCount, context.count);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/**
 * PATCH /notifications/read-all. Not optimistic: `isPending` stays true until the lists and the
 * count have refetched, so the page shows the server's answer ({ updated }).
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
