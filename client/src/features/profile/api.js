import { useQuery } from '@tanstack/react-query';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';
import { useAuthStore } from '../../stores/auth';
import { getMe } from '../auth/api';

// /profile's reads. The member's badges use ['badges', 'mine'], the key frontend.md §8.2 gives the
// teammate's /badges page, so badge decisions and grants (which invalidate it) refresh both, and
// the two pages share one cache entry.

export const profileKeys = {
  me: ['auth', 'me'],
  myBadges: ['badges', 'mine'],
};

/** GET /badges/mine → the envelope; data = member rows, most recently changed first. */
export async function getMyBadges() {
  const res = await http.get('/badges/mine');
  return res.data;
}

export function useMyBadges(options = {}) {
  return useQuery({
    queryKey: profileKeys.myBadges,
    queryFn: getMyBadges,
    staleTime: 60 * 1000,
    retry: retryReads,
    ...options,
  });
}

/**
 * GET /auth/me → the user view, stored for the header and the guards, but only if the session it
 * was asked under is still the current one. A logout (or another demo login) while the request is
 * in flight changes the access token, and queryClient.clear() doesn't stop a running request: its
 * late answer must not put the old user back.
 */
export async function readFreshUser() {
  const asked = useAuthStore.getState().accessToken;
  const res = await getMe();
  const state = useAuthStore.getState();
  if (asked && state.accessToken === asked) state.setUser(res.data);
  return res.data;
}

/**
 * GET /auth/me on opening /profile, so a verification decided or a role granted after sign-in shows
 * here and in the header without signing in again.
 */
export function useFreshUser(options = {}) {
  return useQuery({
    queryKey: profileKeys.me,
    queryFn: readFreshUser,
    staleTime: 0,
    retry: retryReads,
    ...options,
  });
}

// Badge states (api.md "Member row": show `state`) → label and Badge variant.
const BADGE_STATES = {
  active: { label: 'Active', variant: 'forest' },
  requested: { label: 'Requested', variant: 'amber' },
  expired: { label: 'Expired', variant: 'slate' },
  rejected: { label: 'Rejected', variant: 'red' },
  revoked: { label: 'Revoked', variant: 'red' },
};

/**
 * The member rows of a ['badges', 'mine'] cache entry. /profile stores GET /badges/mine's envelope;
 * the teammate's /badges page shares the key and may store the bare list, so read both.
 */
export function myBadgeRows(cached) {
  const rows = Array.isArray(cached) ? cached : Array.isArray(cached?.data) ? cached.data : [];
  return rows.filter((row) => row && typeof row === 'object' && row.badge && typeof row.badge === 'object');
}

export function badgeStateView(state) {
  return BADGE_STATES[state] ?? { label: String(state ?? 'Unknown'), variant: 'neutral' };
}
