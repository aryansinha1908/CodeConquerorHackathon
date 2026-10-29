import { formatDuration } from '../../lib/time';

// Labels and text for resources (api.md "Resources": the Card and Detail shapes; "Bookings": the
// eligibility rules). Pure, so the cards, the detail page and the tests read the same words.

// ── Enums (server/src/models/enums.js) ────────────────────────────────────────

export const RESOURCE_CATEGORIES = ['space', 'equipment', 'computing', 'tool'];

const CATEGORY_PLURAL = { space: 'Spaces', equipment: 'Equipment', computing: 'Computing', tool: 'Tools' };
const CATEGORY_SINGULAR = { space: 'Space', equipment: 'Equipment', computing: 'Computing', tool: 'Tool' };

/** The category filter's choices: the backend enum with readable labels. */
export const CATEGORY_OPTIONS = RESOURCE_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_PLURAL[value],
}));

const humanise = (value) => {
  const text = String(value).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** 'equipment' → 'Equipment', 'tool' → 'Tool'; an unknown value as itself. */
export function categoryLabel(value) {
  if (!value) return 'Resource';
  return CATEGORY_SINGULAR[value] ?? humanise(value);
}

// Badge variants are components/ui/Badge's, each at least 4.5:1 for its text (frontend.md §10.3).
const RISK_STYLES = {
  low: { variant: 'teal', label: 'Low risk' },
  medium: { variant: 'gold', label: 'Medium risk' },
  high: { variant: 'red', label: 'High risk' },
};

/** riskLevel → { variant, label }. */
export function riskView(level) {
  return RISK_STYLES[level] ?? { variant: 'neutral', label: level ? `${humanise(level)} risk` : 'Risk not set' };
}

const STATUS_STYLES = {
  active: { variant: 'forest', label: 'Open for booking' },
  maintenance: { variant: 'gold', label: 'Under maintenance' },
  archived: { variant: 'slate', label: 'Archived' },
};

/** A resource's status → { variant, label }. */
export function resourceStatusView(status) {
  return STATUS_STYLES[status] ?? { variant: 'neutral', label: status ? humanise(status) : 'Unknown' };
}

const APPROVAL_STYLES = {
  auto: {
    variant: 'forest',
    label: 'Instant approval',
    description: 'Booked at once when every check passes.',
  },
  manual: {
    variant: 'outline',
    label: 'Manager approval',
    description: "A manager of the unit reviews each request.",
  },
};

/** eligibility.approvalMode → { variant, label, description }; the server's default is manual. */
export function approvalView(mode) {
  return APPROVAL_STYLES[mode] ?? APPROVAL_STYLES.manual;
}

/** bookingMode → a short label. */
export function bookingModeLabel(mode) {
  return mode === 'loan' ? 'Loan (pick up and return)' : 'Time slot';
}

/** 1 → '1 unit', 3 → '3 units'. */
export function formatQuantity(quantity) {
  const n = Number(quantity) || 1;
  return `${n} ${n === 1 ? 'unit' : 'units'}`;
}

const MEMBER_TYPE_SHORT = {
  ug: 'UG students',
  pg: 'PG students',
  rs: 'Research scholars',
  faculty: 'Faculty',
  staff: 'Staff',
};
const ALL_MEMBER_TYPES = Object.keys(MEMBER_TYPE_SHORT);

const listOf = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** eligibility.memberTypes → 'Everyone' (empty or all five) or 'PG students, Research scholars and Faculty'. */
export function memberTypesText(types) {
  const list = Array.isArray(types) ? types.filter(Boolean) : [];
  if (!list.length || ALL_MEMBER_TYPES.every((type) => list.includes(type))) return 'Everyone';
  return listOf(list.map((type) => MEMBER_TYPE_SHORT[type] ?? String(type).toUpperCase()));
}

/** eligibility.departments ([{ _id, code, name }]) → 'All departments' or 'CSE and ECE'. */
export function departmentsText(departments) {
  const list = Array.isArray(departments) ? departments : [];
  if (!list.length) return 'All departments';
  const names = list
    .map((d) => (d && typeof d === 'object' ? (d.code ? d.code.toUpperCase() : d.name) : null))
    .filter(Boolean);
  return names.length ? listOf(names) : 'Certain departments';
}

/**
 * A location { building?, room?, floor? } → 'Prototyping Lab, Design and Innovation Centre (Ground
 * floor)', or null when there is none. A plain string (older data) is returned as it is.
 */
export function formatLocation(location) {
  if (!location) return null;
  if (typeof location === 'string') return location.trim() || null;
  if (typeof location !== 'object') return null;
  const clean = (value) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value));
  const room = clean(location.room);
  const building = clean(location.building);
  const floor = clean(location.floor);
  const place = [room, building].filter(Boolean).join(', ');
  let level = '';
  if (floor) {
    if (/floor/i.test(floor)) level = floor;
    else if (/^-?\d+$/.test(floor)) level = `floor ${floor}`;
    else level = `${floor} floor`;
  }
  if (place && level) return `${place} (${level})`;
  if (place) return place;
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a listing image ({ url, publicId } in resource.images) may be shown: a Cloudinary delivery
 * URL for its own public id, https://res.cloudinary.com/<cloud>/image/upload/v<version>/<publicId>.<ext>,
 * as POST /uploads/images hands out, in normal form, with no query, user, port or transformation
 * (one could fetch from elsewhere). The server doesn't check listing images (api.md "Resources"),
 * and an image on any other host would be fetched by every member who opens Explore. The same rule
 * as the server's isOurPhoto, except that the client doesn't know our cloud's name.
 */
export function isListingImage(image) {
  if (!image || typeof image.url !== 'string' || typeof image.publicId !== 'string' || !image.publicId) {
    return false;
  }
  let url;
  try {
    url = new URL(image.url);
  } catch {
    return false;
  }
  const path = new RegExp(
    `^/[A-Za-z0-9_-]+/image/upload/(?:v\\d+/)?${escapeRegExp(image.publicId)}(?:\\.[a-z0-9]+)?$`
  );
  return (
    url.href === image.url &&
    url.protocol === 'https:' &&
    url.host === 'res.cloudinary.com' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    path.test(url.pathname)
  );
}

/** limits → [{ label, value }] for the rules that are set, in a fixed order. */
export function limitsList(limits) {
  if (!limits || typeof limits !== 'object') return [];
  const out = [];
  const n = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);
  const min = n(limits.minDurationMins);
  const max = n(limits.maxDurationMins);
  if (min && max) out.push({ label: 'Length', value: `${formatDuration(min)} to ${formatDuration(max)}` });
  else if (max) out.push({ label: 'Longest booking', value: formatDuration(max) });
  else if (min) out.push({ label: 'Shortest booking', value: formatDuration(min) });
  const weekly = n(limits.maxHoursPerWeek);
  if (weekly) out.push({ label: 'Weekly limit', value: `${formatHours(weekly)} h per member` });
  const active = n(limits.maxActiveBookings);
  if (active) out.push({ label: 'Active bookings', value: `at most ${active} at a time` });
  const lead = n(limits.leadTimeMins);
  if (lead) out.push({ label: 'Book ahead', value: `at least ${formatDuration(lead)}` });
  const advance = n(limits.maxAdvanceDays);
  if (advance) out.push({ label: 'Furthest ahead', value: `${advance} ${advance === 1 ? 'day' : 'days'}` });
  return out;
}

// ── Quota (GET /resources/:id/eligibility without a slot) ─────────────────────

/** 4 → '4', 1.5 → '1.5', 2.25 → '2.3' (the server's style). */
export function formatHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

const limitOf = (value) => {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * quota { hoursThisWeek, maxHoursPerWeek|null, activeCount, maxActiveBookings|null } →
 * { hours: { used, limit, ratio, text }, active: { … }, text }, with text like frontend.md §7:
 * "4 of 6 h this week · 1 of 1 active booking". Null without a quota.
 */
export function quotaView(quota) {
  if (!quota || typeof quota !== 'object') return null;
  const used = Math.max(0, Number(quota.hoursThisWeek) || 0);
  const limit = limitOf(quota.maxHoursPerWeek);
  const activeUsed = Math.max(0, Math.round(Number(quota.activeCount) || 0));
  const activeLimit = limitOf(quota.maxActiveBookings);
  const bookings = (count) => (count === 1 ? 'active booking' : 'active bookings');
  const hoursText =
    limit != null
      ? `${formatHours(used)} of ${formatHours(limit)} h this week`
      : `${formatHours(used)} h this week (no weekly limit)`;
  const activeText =
    activeLimit != null
      ? `${activeUsed} of ${activeLimit} ${bookings(activeLimit)}`
      : `${activeUsed} ${bookings(activeUsed)} (no limit)`;
  const ratio = (a, b) => (b ? Math.min(1, a / b) : null);
  return {
    hours: { used, limit, ratio: ratio(used, limit), text: hoursText },
    active: { used: activeUsed, limit: activeLimit, ratio: ratio(activeUsed, activeLimit), text: activeText },
    text: `${hoursText} · ${activeText}`,
  };
}

// ── Eligibility rules (api.md "Bookings": the 12 rules, in order) ─────────────

const RULE_LABELS = {
  ACCOUNT_VERIFIED: 'ID card verified',
  NOT_SUSPENDED: 'Account in good standing',
  RESOURCE_ACTIVE: 'Open for booking',
  MEMBER_TYPE: 'Member type',
  DEPARTMENT: 'Department',
  BADGES: 'Badges',
  OPEN_HOURS: 'Opening hours',
  DURATION: 'Booking length',
  BOOKING_WINDOW: 'Booking window',
  WEEKLY_HOURS: 'Weekly hours',
  ACTIVE_BOOKINGS: 'Active bookings',
  AVAILABILITY: 'Slot availability',
};

/** 'BADGES' → 'Badges'; an unknown rule id is made readable. */
export function ruleLabel(rule) {
  if (!rule) return 'Rule';
  return RULE_LABELS[rule] ?? humanise(String(rule).toLowerCase());
}

/** Whether a result blocks the booking: failed and hard (only AVAILABILITY is soft). */
export function isBlocking(result) {
  return Boolean(result) && result.passed === false && result.hard !== false && result.rule !== 'AVAILABILITY';
}

/** The /badges link that opens the request for a badge code (frontend.md §7). */
export function badgeRequestHref(code) {
  return code ? `/badges?request=${encodeURIComponent(code)}` : '/badges';
}

function badgeLinks(result, resource) {
  const required = Array.isArray(resource?.eligibility?.badges) ? resource.eligibility.badges : [];
  const byId = new Map(required.filter((b) => b && b._id).map((b) => [String(b._id), b]));
  const listed = Array.isArray(result.meta?.badges) ? result.meta.badges : null;
  if (listed) {
    // meta.badges [{ id, name, issue: missing | requested | expired }] names the badges at fault;
    // the resource's own badge list has their codes.
    return listed.map((item) => {
      const badge = byId.get(String(item?.id));
      const name = item?.name ?? badge?.name ?? 'the badge';
      if (item?.issue === 'requested') return { to: '/badges', label: `See your ${name} request` };
      const label = item?.issue === 'expired' ? `Renew ${name}` : `Request ${name}`;
      return { to: badgeRequestHref(badge?.code), label };
    });
  }
  // No meta (the details of a 422): the resource's badges are the ones to look at.
  if (required.length === 1 && required[0]?.code) {
    return [{ to: badgeRequestHref(required[0].code), label: `Request ${required[0].name ?? 'the badge'}` }];
  }
  return [{ to: '/badges', label: 'Go to badges' }];
}

/**
 * The fix links of a failed rule ([{ to, label }], frontend.md §7): ID verification, the badge to
 * request (/badges?request=<code>), similar resources, your bookings. Passed rules have none.
 */
export function fixLinksFor(result, resource) {
  if (!result || result.passed !== false) return [];
  let links = [];
  switch (result.rule) {
    case 'ACCOUNT_VERIFIED':
      links = [{ to: '/verification', label: 'Go to ID verification' }];
      break;
    case 'BADGES':
      links = badgeLinks(result, resource);
      break;
    case 'RESOURCE_ACTIVE':
      links = [
        {
          to: RESOURCE_CATEGORIES.includes(resource?.category)
            ? `/explore?category=${resource.category}`
            : '/explore',
          label: 'See similar resources',
        },
      ];
      break;
    case 'ACTIVE_BOOKINGS':
      links = [{ to: '/bookings', label: 'See my bookings' }];
      break;
    default:
      links = [];
  }
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.to}|${link.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A rule's message or fixHint as text (never an object on screen). */
export function ruleText(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}
