import { useQuery } from '@tanstack/react-query';
import http from '../../../lib/http';
import { retryReads } from '../../../lib/errors';
import { useManageBookings } from '../../bookings/api';
import { handoverFilters } from '../components/manageView';
import { useBadgeRequests } from '../badges/api';

// The /manage dashboard's counts (frontend.md §6.3: "several GETs with limit=1 for totals"). Each
// is the meta.total of a one-item page of the list the card links to, under that list's own key
// prefix, so whatever refreshes the list (a decision, a check-in, a new incident) refreshes the
// count too. Every count is polled every 30 s while the dashboard is open.

export const DASHBOARD_POLL_MS = 30 * 1000;

// The incident statuses that still need someone (api.md "Incidents": open | in_review | resolved).
export const OPEN_INCIDENT_STATUSES = 'open,in_review';

/** A list answer { data, meta } → meta.total as a whole number, or null when there is none. */
export function totalOf(result) {
  const total = Number(result?.meta?.total);
  return Number.isFinite(total) && total >= 0 ? Math.floor(total) : null;
}

const one = { page: 1, limit: 1 };

/** The GET /bookings/manage filters of each booking count (pending → conflict groups). */
export function bookingCountFilters(now = Date.now()) {
  return {
    pending: { status: 'pending', ...one },
    // Today's handovers: the handovers page's "Starting soon" list (approved, starting today IST).
    today: { ...handoverFilters('starting', { now }), ...one },
    returns: { ...handoverFilters('returns', { now }), ...one },
  };
}

export const incidentCountParams = { status: OPEN_INCIDENT_STATUSES, ...one };

export const incidentCountKey = ['incidents', 'count', incidentCountParams];

/**
 * GET /incidents?status=open,in_review&page=1&limit=1 → { data, meta } (managers: their units'
 * incidents and their own; admins: all).
 */
export async function countOpenIncidents() {
  const res = await http.get('/incidents', { params: incidentCountParams });
  return { data: res.data?.data, meta: res.data?.meta };
}

const poll = { refetchInterval: DASHBOARD_POLL_MS };

/**
 * The five counts, each a React Query result whose data is a { data, meta } page of one:
 * { pending, today, returns, incidents, badges }.
 */
export function useDashboardCounts(now) {
  const filters = bookingCountFilters(now);
  const pending = useManageBookings(filters.pending, { placeholderData: undefined });
  const today = useManageBookings(filters.today, { placeholderData: undefined });
  const returns = useManageBookings(filters.returns, { placeholderData: undefined });
  const incidents = useQuery({
    // Under ['incidents'], so creating or resolving an incident refreshes it; 'count' keeps it
    // apart from the incident list's own entries.
    queryKey: incidentCountKey,
    queryFn: countOpenIncidents,
    staleTime: 0,
    retry: retryReads,
    ...poll,
  });
  const badges = useBadgeRequests({ status: 'requested', ...one }, { placeholderData: undefined, ...poll });
  return { pending, today, returns, incidents, badges };
}
