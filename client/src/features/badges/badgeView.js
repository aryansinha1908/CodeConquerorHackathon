import { Ban, CheckCircle2, Clock, TimerOff, XCircle } from 'lucide-react';
import { formatIstDate, formatIstDateTime } from '../../lib/time';

// Pure helpers for /badges (frontend.md §6.2).
// Formats states, validity, dates, and matches badges against existing user holdings.

export const BADGE_TABS = [
  { id: 'catalogue', label: 'Badge Catalogue' },
  { id: 'mine', label: 'My Badges' },
];

export const BADGE_STATES = {
  active: {
    variant: 'forest',
    icon: CheckCircle2,
    label: 'Active',
    summary: 'Verified Credential',
  },
  requested: {
    variant: 'gold',
    icon: Clock,
    label: 'Requested',
    summary: 'Awaiting Manager Review',
  },
  expired: {
    variant: 'slate',
    icon: TimerOff,
    label: 'Expired',
    summary: 'Validity Period Ended',
  },
  rejected: {
    variant: 'red',
    icon: XCircle,
    label: 'Rejected',
    summary: 'Application Rejected',
  },
  revoked: {
    variant: 'slate',
    icon: Ban,
    label: 'Revoked',
    summary: 'Credential Revoked',
  },
};

/**
 * Normalises a member's badge row or raw state into view attributes.
 */
export function badgeStateView(rowOrState) {
  const state = typeof rowOrState === 'string' ? rowOrState : rowOrState?.state ?? rowOrState?.status;
  return BADGE_STATES[state] ?? {
    variant: 'neutral',
    icon: Clock,
    label: String(state ?? 'Unknown'),
    summary: 'Unknown status',
  };
}

/**
 * Extracts rows safely whether response is bare array or { data: [...] }.
 */
export function myBadgeRows(cached) {
  const rows = Array.isArray(cached) ? cached : Array.isArray(cached?.data) ? cached.data : [];
  return rows.filter(
    (row) => row && typeof row === 'object' && row.badge && typeof row.badge === 'object'
  );
}

/**
 * Creates a Map of badgeId -> user's most recent UserBadge row.
 */
export function mapUserBadgesByBadgeId(rows) {
  const map = new Map();
  for (const row of rows) {
    const badgeId = row.badge?._id ? String(row.badge._id) : null;
    if (badgeId) {
      map.set(badgeId, row);
    }
  }
  return map;
}

/**
 * Formats validity days into clear text.
 */
export function validityText(validityDays) {
  const days = Number(validityDays);
  if (validityDays == null || !Number.isInteger(days) || days <= 0) {
    return 'Never expires';
  }
  if (days === 365) return 'Valid for 1 year';
  if (days === 180) return 'Valid for 6 months';
  if (days === 90) return 'Valid for 3 months';
  if (days === 30) return 'Valid for 1 month';
  return `Valid for ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Readable issuer name.
 */
export function badgeUnitName(badge) {
  return badge?.orgUnit?.name ?? 'Central Campus';
}

/**
 * Filter badges catalogue by search term and selected orgUnit.
 */
export function filterBadges(badges, { search = '', orgUnit = '' } = {}) {
  const q = search.trim().toLowerCase();
  return (Array.isArray(badges) ? badges : []).filter((badge) => {
    if (!badge || typeof badge !== 'object') return false;
    if (orgUnit) {
      const unitId = String(badge.orgUnit?._id ?? badge.orgUnit ?? '');
      if (unitId !== orgUnit) return false;
    }
    if (!q) return true;
    const name = String(badge.name || '').toLowerCase();
    const code = String(badge.code || '').toLowerCase();
    const desc = String(badge.description || '').toLowerCase();
    const unit = String(badge.orgUnit?.name || '').toLowerCase();
    return name.includes(q) || code.includes(q) || desc.includes(q) || unit.includes(q);
  });
}

