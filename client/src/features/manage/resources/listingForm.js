import { z } from 'zod';
import { fieldErrorsFrom } from '../../../lib/errors';
import { fromIstInputValue, toIstInputValue } from '../../../lib/time';
import { MEMBER_TYPES } from '../../verification/api';
import { RESOURCE_CATEGORIES } from '../../resources/format';
import { toPhotoRefs } from '../../uploads/api';

// The manager's listing form (frontend.md §6.3 and §9; api.md "Resources": the listing form, its
// rules and its errors; backend.md §5 Resource and §7 resources.create / update) as pure functions,
// so the page and the tests share one set of rules.
//
// Three shapes:
// - the form: what the inputs hold (text for numbers, IST "YYYY-MM-DDTHH:mm" for closures, a key
//   per list row);
// - the values: the listing form exactly as POST /resources takes it, with null for an empty
//   optional field. The schema checks the values, so its issue paths are the server's own
//   ("availability.weekly.0.close", "eligibility.badges.1") and one map of errors serves both;
// - the bodies: createBody() leaves the empty fields out; patchBody() sends only what changed
//   (PATCH is partial: a nested section sets only the keys it names, lists are replaced whole).

// ── Rules (api.md "Listing form"; server/src/models/Resource.js) ─────────────

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const USAGE_RULES_MAX = 2000;
export const IMAGES_MAX = 5;
export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 50;
export const LOCATION_MAX = { building: 120, room: 60, floor: 20 };
export const BLACKOUT_REASON_MAX = 200;
export const CHECKLIST_MAX = 10;
export const CHECKLIST_ITEM_MIN = 2;
export const CHECKLIST_ITEM_MAX = 80;
export const MAX_ADVANCE_DAYS = 365;

export const BOOKING_MODES = ['slot', 'loan'];
export const RISK_LEVELS = ['low', 'medium', 'high'];
export const APPROVAL_MODES = ['manual', 'auto'];
export const SLOT_MINUTES = [15, 30, 60];
export const DEFAULT_SLOT_MINUTES = 30;

const ID_RE = /^[0-9a-f]{24}$/i;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Opening hours are a Mon–Sun week in IST (api.md "Values"); `day` is 0 = Sunday … 6 = Saturday.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS = [1, 2, 3, 4, 5];

export const CATEGORY_OPTIONS = [
  { value: 'space', label: 'Space', description: 'Rooms, labs, courts, studios.' },
  { value: 'equipment', label: 'Equipment', description: 'Machines and instruments.' },
  { value: 'computing', label: 'Computing', description: 'Workstations, servers, GPU time.' },
  { value: 'tool', label: 'Tool', description: 'Hand tools, kits, cameras.' },
].filter((option) => RESOURCE_CATEGORIES.includes(option.value));

export const BOOKING_MODE_OPTIONS = [
  {
    value: 'slot',
    label: 'Time slot',
    description: 'The whole booking sits inside one opening window, as for rooms and machines.',
  },
  {
    value: 'loan',
    label: 'Loan',
    description: 'Picked up and returned during opening hours, and may run over several days, as for cameras and kits.',
  },
];

export const RISK_OPTIONS = [
  { value: 'low', label: 'Low', description: 'Safe to use without supervision.' },
  { value: 'medium', label: 'Medium', description: 'Needs care or a short briefing.' },
  { value: 'high', label: 'High', description: 'Hazardous: training and supervision expected.' },
];

export const APPROVAL_OPTIONS = [
  { value: 'manual', label: 'Manager approval', description: 'A manager of the unit reviews every request.' },
  { value: 'auto', label: 'Instant approval', description: 'Booked at once when every check passes.' },
];

export const SLOT_OPTIONS = SLOT_MINUTES.map((value) => ({ value, label: `${value} min` }));

// Each limit is a whole number, or empty for "no limit" (api.md "Listing form": limits).
export const LIMIT_FIELDS = [
  {
    key: 'minDurationMins',
    label: 'Shortest booking',
    unit: 'minutes',
    min: 1,
    hint: 'A booking must be at least this long.',
  },
  {
    key: 'maxDurationMins',
    label: 'Longest booking',
    unit: 'minutes',
    min: 1,
    hint: 'A booking can be at most this long.',
  },
  {
    key: 'maxHoursPerWeek',
    label: 'Hours per member each week',
    unit: 'hours',
    min: 1,
    hint: 'Counted over the IST week, Monday to Sunday.',
  },
  {
    key: 'maxActiveBookings',
    label: 'Active bookings per member',
    unit: 'bookings',
    min: 1,
    hint: 'Pending, approved and in-use bookings a member may hold at once.',
  },
  {
    key: 'leadTimeMins',
    label: 'Book at least this far ahead',
    unit: 'minutes',
    min: 0,
    hint: 'Time the unit needs between the request and the start.',
  },
  {
    key: 'maxAdvanceDays',
    label: 'Book at most this far ahead',
    unit: 'days',
    min: 1,
    max: MAX_ADVANCE_DAYS,
    hint: `Up to ${MAX_ADVANCE_DAYS} days.`,
  },
];
const LIMIT_KEYS = LIMIT_FIELDS.map((field) => field.key);
const LOCATION_KEYS = ['building', 'room', 'floor'];

// ── Sections (the form's headings; what "changed" is reported by) ─────────────

export const SECTIONS = [
  { id: 'basics', title: 'Basics' },
  { id: 'availability', title: 'Availability' },
  { id: 'eligibility', title: 'Eligibility' },
  { id: 'limits', title: 'Limits' },
  { id: 'checklist', title: 'Condition checklist' },
];

const SECTION_OF_FIELD = {
  orgUnit: 'basics',
  title: 'basics',
  category: 'basics',
  description: 'basics',
  usageRules: 'basics',
  bookingMode: 'basics',
  quantity: 'basics',
  riskLevel: 'basics',
  location: 'basics',
  images: 'basics',
  availability: 'availability',
  eligibility: 'eligibility',
  limits: 'limits',
  checklist: 'checklist',
};

/** A field path ("availability.weekly.0.close", "title") → its section id, or null. */
export function sectionOf(path) {
  const field = typeof path === 'string' ? path.split('.')[0] : '';
  return SECTION_OF_FIELD[field] ?? null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

let rowSeq = 0;
/** A React key for a new list row (weekly windows, closures, checklist items). */
export const rowKey = (prefix) => `${prefix}-${(rowSeq += 1)}`;

const str = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value) => str(value).trim();
const orNull = (value) => trimmed(value) || null;
const idOf = (ref) => {
  if (ref == null) return null;
  if (typeof ref === 'object') return ref._id != null ? String(ref._id) : null;
  return String(ref);
};

/** "" → null; "12" → 12; "1.5" → 1.5 and "abc" → NaN, which the schema refuses. */
function toNumber(value) {
  const text = trimmed(value);
  if (!text) return null;
  return Number(text);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const weekIndex = (day) => {
  const index = WEEK_ORDER.indexOf(Number(day));
  return index === -1 ? WEEK_ORDER.length : index;
};
const minutesOf = (hhmm) => {
  if (!HH_MM.test(hhmm ?? '')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Canonical JSON (sorted keys) for "did this change?".
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
const same = (a, b) => canonical(a) === canonical(b);

// ── The form ──────────────────────────────────────────────────────────────────

const window_ = (day, open, close) => ({ key: rowKey('window'), day, open, close });

/** Mon–Fri 09:00–17:00: a start the manager edits rather than seven empty days. */
export function defaultWeekly() {
  return WEEKDAYS.map((day) => window_(day, '09:00', '17:00'));
}

/** A blank listing form. `orgUnit` preselects the unit (when the manager has only one). */
export function emptyForm({ orgUnit = '' } = {}) {
  return {
    orgUnit,
    title: '',
    category: '',
    description: '',
    usageRules: '',
    bookingMode: 'slot',
    quantity: '1',
    riskLevel: 'low',
    location: { building: '', room: '', floor: '' },
    images: [],
    weekly: defaultWeekly(),
    blackouts: [],
    slotMinutes: DEFAULT_SLOT_MINUTES,
    // Every member type is "open to everyone"; frontend.md §9 asks for at least one.
    memberTypes: [...MEMBER_TYPES],
    departments: [],
    badges: [],
    approvalMode: 'manual',
    limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, ''])),
    checklist: [],
  };
}

/** Windows in week order (Mon … Sun), each day's by opening time; the list order is kept otherwise. */
export function sortWeekly(weekly) {
  return [...(Array.isArray(weekly) ? weekly : [])]
    .map((w, index) => ({ w, index }))
    .sort(
      (a, b) =>
        weekIndex(a.w.day) - weekIndex(b.w.day) ||
        (minutesOf(a.w.open) ?? 9999) - (minutesOf(b.w.open) ?? 9999) ||
        a.index - b.index
    )
    .map(({ w }) => w);
}

/**
 * A Detail from GET /resources/:id (or a write) → the form. An empty memberTypes list means "no
 * restriction" (api.md), the same as all five, which is how the form shows it.
 */
export function formFromResource(resource) {
  const r = resource && typeof resource === 'object' ? resource : {};
  const availability = r.availability && typeof r.availability === 'object' ? r.availability : {};
  const eligibility = r.eligibility && typeof r.eligibility === 'object' ? r.eligibility : {};
  const limits = r.limits && typeof r.limits === 'object' ? r.limits : {};
  const location = r.location && typeof r.location === 'object' ? r.location : {};
  const memberTypes = Array.isArray(eligibility.memberTypes)
    ? MEMBER_TYPES.filter((type) => eligibility.memberTypes.includes(type))
    : [];
  const slot = Number(availability.slotMinutes);
  return {
    orgUnit: idOf(r.orgUnit) ?? '',
    title: str(r.title),
    category: RESOURCE_CATEGORIES.includes(r.category) ? r.category : '',
    description: str(r.description),
    usageRules: str(r.usageRules),
    bookingMode: BOOKING_MODES.includes(r.bookingMode) ? r.bookingMode : 'slot',
    quantity: r.quantity == null ? '1' : String(r.quantity),
    riskLevel: RISK_LEVELS.includes(r.riskLevel) ? r.riskLevel : 'low',
    location: Object.fromEntries(LOCATION_KEYS.map((key) => [key, str(location[key])])),
    images: toPhotoRefs(r.images),
    weekly: sortWeekly(
      (Array.isArray(availability.weekly) ? availability.weekly : [])
        .filter((w) => w && typeof w === 'object')
        .map((w) => window_(Number(w.day), str(w.open), str(w.close)))
    ),
    blackouts: (Array.isArray(availability.blackouts) ? availability.blackouts : [])
      .filter((b) => b && typeof b === 'object')
      .map((b) => ({
        key: rowKey('closure'),
        start: toIstInputValue(b.start),
        end: toIstInputValue(b.end),
        reason: str(b.reason),
      })),
    slotMinutes: SLOT_MINUTES.includes(slot) ? slot : DEFAULT_SLOT_MINUTES,
    memberTypes: memberTypes.length ? memberTypes : [...MEMBER_TYPES],
    departments: (Array.isArray(eligibility.departments) ? eligibility.departments : []).map(idOf).filter(Boolean),
    badges: (Array.isArray(eligibility.badges) ? eligibility.badges : []).map(idOf).filter(Boolean),
    approvalMode: APPROVAL_MODES.includes(eligibility.approvalMode) ? eligibility.approvalMode : 'manual',
    limits: Object.fromEntries(
      LIMIT_KEYS.map((key) => [key, limits[key] == null || limits[key] === '' ? '' : String(limits[key])])
    ),
    checklist: (Array.isArray(r.checklist) ? r.checklist : [])
      .filter((label) => typeof label === 'string')
      .map((label) => ({ key: rowKey('check'), label })),
  };
}

/** The form → the values: the listing form as the API takes it, null where a field is empty. */
export function formValues(form) {
  const f = form ?? emptyForm();
  return {
    orgUnit: orNull(f.orgUnit),
    title: trimmed(f.title),
    category: f.category || null,
    description: orNull(f.description),
    usageRules: orNull(f.usageRules),
    bookingMode: f.bookingMode,
    quantity: toNumber(f.quantity),
    riskLevel: f.riskLevel,
    location: Object.fromEntries(LOCATION_KEYS.map((key) => [key, orNull(f.location?.[key])])),
    images: toPhotoRefs(f.images),
    availability: {
      weekly: (f.weekly ?? []).map((w) => ({ day: Number(w.day), open: str(w.open), close: str(w.close) })),
      blackouts: (f.blackouts ?? []).map((b) => {
        const reason = trimmed(b.reason);
        return {
          start: fromIstInputValue(b.start),
          end: fromIstInputValue(b.end),
          ...(reason && { reason }),
        };
      }),
      slotMinutes: Number(f.slotMinutes),
    },
    eligibility: {
      memberTypes: MEMBER_TYPES.filter((type) => (f.memberTypes ?? []).includes(type)),
      departments: [...(f.departments ?? [])],
      badges: [...(f.badges ?? [])],
      approvalMode: f.approvalMode,
    },
    limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, toNumber(f.limits?.[key])])),
    checklist: (f.checklist ?? []).map((item) => trimmed(item.label)),
  };
}

// ── The schema (frontend.md §9 "Listing form"; api.md "Listing form") ─────────

const lengthCheck = (value, { min, max, missing }, ctx) => {
  if (!value) {
    if (missing) ctx.addIssue({ code: 'custom', message: missing });
  } else if (min && value.length < min) {
    ctx.addIssue({ code: 'custom', message: `Use at least ${min} characters (now ${value.length}).` });
  } else if (max && value.length > max) {
    ctx.addIssue({ code: 'custom', message: `Use at most ${max} characters (now ${value.length}).` });
  }
};
const requiredText = (rules) => z.string().superRefine((value, ctx) => lengthCheck(value, rules, ctx));
const optionalText = (max) =>
  z
    .string()
    .nullable()
    .superRefine((value, ctx) => lengthCheck(value, { max }, ctx));

// A text input's number: "" is null (missing), "abc" NaN; both are refused with a sentence.
const wholeNumber = ({ min, max, missing }) => {
  const number = z
    .number({ error: (issue) => (issue.input == null ? missing : 'Enter a whole number.') })
    .int('Enter a whole number.')
    .min(min, min === 0 ? 'Use 0 or more.' : `Use ${min} or more.`);
  return max == null ? number : number.max(max, `Use at most ${max}.`);
};

const optionalWhole = (field) => wholeNumber(field).nullable();

const windowSchema = z.object({
  day: z.number().int().min(0).max(6),
  open: z.string().regex(HH_MM, 'Enter the opening time.'),
  close: z.string().regex(HH_MM, 'Enter the closing time.'),
});

const blackoutSchema = z.object({
  start: z.string({ error: 'Enter when the closure starts (date and time, IST).' }),
  end: z.string({ error: 'Enter when the closure ends (date and time, IST).' }),
  reason: z
    .string()
    .max(BLACKOUT_REASON_MAX, `Use at most ${BLACKOUT_REASON_MAX} characters.`)
    .optional(),
});

const idList = (message) => z.array(z.string().regex(ID_RE, message));

const limitsSchema = z.object(Object.fromEntries(LIMIT_FIELDS.map((field) => [field.key, optionalWhole(field)])));

const checklistSchema = z
  .array(
    z.string().superRefine((label, ctx) =>
      lengthCheck(label, { min: CHECKLIST_ITEM_MIN, max: CHECKLIST_ITEM_MAX, missing: 'Write the item, or remove it.' }, ctx)
    )
  )
  .min(1, 'Add at least one item to check at every handover, such as "Nozzle clean".')
  .max(CHECKLIST_MAX, `At most ${CHECKLIST_MAX} items.`);

/**
 * The rules that compare fields, as { path: message }. They run apart from the schema, whose
 * refinements are skipped once a sibling fails its type (an empty closure would hide another
 * closure that ends before it starts), and read the values defensively for the same reason.
 */
export function crossFieldErrors(values) {
  const errors = {};
  const add = (path, message) => {
    if (!(path in errors)) errors[path] = message;
  };

  // Opening windows: close after open, and no overlap with an earlier window of the same day.
  // Windows that only touch (09:00–12:00, 12:00–17:00) stay apart, as the server reads them.
  const byDay = new Map();
  (values?.availability?.weekly ?? []).forEach((w, i) => {
    const open = minutesOf(w?.open);
    const close = minutesOf(w?.close);
    if (open == null || close == null) return;
    if (close <= open) {
      add(`availability.weekly.${i}.close`, 'Closing time must be after the opening time.');
      return;
    }
    const earlier = byDay.get(w.day) ?? [];
    const clash = earlier.find((other) => open < other.close && other.open < close);
    if (clash) {
      add(`availability.weekly.${i}.open`, `Overlaps ${DAY_NAMES[w.day] ?? 'this day'}'s ${clash.text} window.`);
    }
    earlier.push({ open, close, text: `${w.open}–${w.close}` });
    byDay.set(w.day, earlier);
  });

  // Closures end after they start (ISO strings from toISOString compare in time order).
  (values?.availability?.blackouts ?? []).forEach((b, i) => {
    if (typeof b?.start === 'string' && typeof b?.end === 'string' && !(b.end > b.start)) {
      add(`availability.blackouts.${i}.end`, 'The closure must end after it starts.');
    }
  });

  const { minDurationMins: min, maxDurationMins: max, maxHoursPerWeek: weekly } = values?.limits ?? {};
  const whole = (n) => Number.isInteger(n);
  if (whole(min) && whole(max) && min > max) {
    // The server's own path and words (server/src/models/Resource.js).
    add('limits.minDurationMins', "Minimum duration can't exceed the maximum.");
  }
  // backend.md §7: maxHoursPerWeek ≥ maxDuration / 60, or a booking of the longest length could
  // never fit in a member's week.
  if (whole(max) && whole(weekly) && weekly * 60 < max) {
    add(
      'limits.maxHoursPerWeek',
      `Allow at least ${Math.ceil(max / 60)} h a week, or the longest booking (${max} min) can never fit.`
    );
  }

  // Check-in and check-out reports name each item exactly once ("Listed twice: …"), so a repeated
  // label could never be reported.
  const seen = new Set();
  (values?.checklist ?? []).forEach((label, i) => {
    const key = typeof label === 'string' ? label.trim().toLowerCase() : '';
    if (!key) return;
    if (seen.has(key)) add(`checklist.${i}`, 'Already on the checklist.');
    seen.add(key);
  });
  return errors;
}

/** The listing form's schema over the values. `mode` 'new' also needs the unit. */
export function listingSchema(mode = 'new') {
  return z.object({
    orgUnit:
      mode === 'new'
        ? z.string({ error: 'Choose the unit that lists this resource.' }).regex(ID_RE, 'Choose one of your units.')
        : z.any(),
    title: requiredText({ min: TITLE_MIN, max: TITLE_MAX, missing: 'Give the resource a title.' }),
    category: z.enum(RESOURCE_CATEGORIES, { error: 'Choose a category.' }),
    description: optionalText(DESCRIPTION_MAX),
    usageRules: optionalText(USAGE_RULES_MAX),
    bookingMode: z.enum(BOOKING_MODES, { error: 'Choose how it is booked.' }),
    quantity: wholeNumber({
      min: QUANTITY_MIN,
      max: QUANTITY_MAX,
      missing: `Enter how many identical units there are (${QUANTITY_MIN}–${QUANTITY_MAX}).`,
    }),
    riskLevel: z.enum(RISK_LEVELS, { error: 'Choose a risk level.' }),
    location: z.object(Object.fromEntries(LOCATION_KEYS.map((key) => [key, optionalText(LOCATION_MAX[key])]))),
    images: z.array(z.object({ url: z.string(), publicId: z.string() })).max(IMAGES_MAX, `At most ${IMAGES_MAX} photos.`),
    availability: z.object({
      weekly: z.array(windowSchema),
      blackouts: z.array(blackoutSchema),
      slotMinutes: z.number().refine((n) => SLOT_MINUTES.includes(n), 'Choose 15, 30 or 60 minutes.'),
    }),
    eligibility: z.object({
      memberTypes: z
        .array(z.enum(MEMBER_TYPES))
        .min(1, 'Choose at least one member type. Choose all five to open it to everyone.'),
      departments: idList('Must be a valid id.'),
      badges: idList('Must be a valid id.'),
      approvalMode: z.enum(APPROVAL_MODES, { error: 'Choose how requests are approved.' }),
    }),
    limits: limitsSchema,
    checklist: checklistSchema,
  });
}

/**
 * The values → { path: message } from the schema and crossFieldErrors (the first message per path),
 * {} when everything is fine. Paths are the server's, as normalisePath gives them.
 */
export function validateListing(values, { mode = 'new' } = {}) {
  const errors = {};
  const result = listingSchema(mode).safeParse(values);
  for (const issue of result.success ? [] : result.error.issues) {
    const key = normalisePath(issue.path.join('.'));
    if (key && !(key in errors)) errors[key] = issue.message;
  }
  for (const [path, message] of Object.entries(crossFieldErrors(values))) {
    if (!(path in errors)) errors[path] = message;
  }
  return errors;
}

// ── Bodies ────────────────────────────────────────────────────────────────────

const presentKeys = (section) =>
  Object.fromEntries(Object.entries(section ?? {}).filter(([, value]) => value !== null && value !== undefined));

/** The values → the POST /resources body: every required field, the optional ones only when set. */
export function createBody(values) {
  const body = {
    orgUnit: values.orgUnit,
    title: values.title,
    category: values.category,
    bookingMode: values.bookingMode,
    quantity: values.quantity,
    riskLevel: values.riskLevel,
    availability: values.availability,
    eligibility: values.eligibility,
    checklist: values.checklist,
  };
  if (values.description) body.description = values.description;
  if (values.usageRules) body.usageRules = values.usageRules;
  if (values.images?.length) body.images = values.images;
  const location = presentKeys(values.location);
  if (Object.keys(location).length) body.location = location;
  const limits = presentKeys(values.limits);
  if (Object.keys(limits).length) body.limits = limits;
  return body;
}

const TOP_FIELDS = [
  'title',
  'category',
  'description',
  'usageRules',
  'bookingMode',
  'quantity',
  'riskLevel',
  'images',
  'checklist',
];
const NESTED_FIELDS = ['location', 'availability', 'eligibility', 'limits'];

/**
 * The PATCH /resources/:id body: only what differs from `initial` (both are values). A cleared
 * optional field is sent as null, which clears it; a nested section carries only its changed keys,
 * so `{ limits: { maxHoursPerWeek: 8 } }` keeps the other limits. orgUnit is never sent (it can't
 * change). {} when nothing changed.
 */
export function patchBody(initial, values) {
  const patch = {};
  for (const field of TOP_FIELDS) {
    if (!same(initial?.[field], values?.[field])) patch[field] = values[field] ?? null;
  }
  for (const field of NESTED_FIELDS) {
    const before = initial?.[field] ?? {};
    const after = values?.[field] ?? {};
    const changed = {};
    for (const key of Object.keys(after)) {
      if (!same(before[key], after[key])) changed[key] = after[key] ?? null;
    }
    if (Object.keys(changed).length) patch[field] = changed;
  }
  return patch;
}

/** A body's fields → the sections they belong to, in form order: ['basics', 'limits']. */
export function changedSections(body) {
  const ids = new Set(Object.keys(body ?? {}).map(sectionOf).filter(Boolean));
  return SECTIONS.filter((section) => ids.has(section.id)).map((section) => section.id);
}

/** Each section's values as text, to tell which sections changed since a server error. */
export function sectionSnapshots(values) {
  const snapshot = Object.fromEntries(SECTIONS.map((section) => [section.id, {}]));
  for (const [field, value] of Object.entries(values ?? {})) {
    const section = sectionOf(field);
    if (section) snapshot[section][field] = value;
  }
  return Object.fromEntries(Object.entries(snapshot).map(([id, part]) => [id, canonical(part)]));
}

// ── Field paths, errors and labels ────────────────────────────────────────────

const FIELD_PATHS = new Set([
  'orgUnit',
  'title',
  'category',
  'description',
  'usageRules',
  'bookingMode',
  'quantity',
  'riskLevel',
  'images',
  'checklist',
  ...LOCATION_KEYS.map((key) => `location.${key}`),
  'availability.weekly',
  'availability.blackouts',
  'availability.slotMinutes',
  'eligibility.memberTypes',
  'eligibility.departments',
  'eligibility.badges',
  'eligibility.approvalMode',
  ...LIMIT_KEYS.map((key) => `limits.${key}`),
]);

/**
 * A server or schema path → the path a form control shows, or null when no control shows it:
 * - "availability.weekly.2.close", "availability.blackouts.0.reason", "checklist.3",
 *   "eligibility.badges.1", "images.0" are kept (each row or item shows its own);
 * - "availability.weekly.2.day" and other row keys → the row ("availability.weekly.2");
 * - "eligibility.memberTypes.1" → "eligibility.memberTypes" (one group of checkboxes);
 * - "images.0.url" → "images.0".
 */
export function normalisePath(path) {
  if (typeof path !== 'string' || !path) return null;
  if (FIELD_PATHS.has(path)) return path;
  let m = /^availability\.weekly\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (m) return m[2] === 'open' || m[2] === 'close' ? path : `availability.weekly.${m[1]}`;
  m = /^availability\.blackouts\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (m) {
    return ['start', 'end', 'reason'].includes(m[2]) ? path : `availability.blackouts.${m[1]}`;
  }
  m = /^eligibility\.memberTypes\.\d+$/.exec(path);
  if (m) return 'eligibility.memberTypes';
  m = /^eligibility\.(departments|badges)\.(\d+)$/.exec(path);
  if (m) return path;
  m = /^(images|checklist)\.(\d+)(?:\..*)?$/.exec(path);
  if (m) return `${m[1]}.${m[2]}`;
  return null;
}

/**
 * A failed POST / PATCH → { fields: { path: message }, other: [{ path, message }] }: the 400
 * details a control shows go beside it (paths as normalisePath gives them), the rest ("This field
 * can't be set.", a section that "Must be an object.") are listed at the top. Model messages are
 * shown as they are, never matched on.
 */
export function listingErrorsFrom(err) {
  const fields = {};
  const other = [];
  if (err?.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return { fields, other };
  for (const [path, message] of Object.entries(fieldErrorsFrom(err))) {
    const key = normalisePath(path);
    if (key && !(key in fields)) fields[key] = message;
    else if (!key) other.push({ path, message });
  }
  return { fields, other };
}

/** A field path → the id of the control that takes focus for it ("listing-availability-weekly-0-close"). */
export function fieldDomId(path) {
  return `listing-${String(path).replace(/[^A-Za-z0-9]+/g, '-')}`;
}

const STATIC_LABELS = {
  orgUnit: 'Unit',
  title: 'Title',
  category: 'Category',
  description: 'Description',
  usageRules: 'Usage rules',
  bookingMode: 'Booking mode',
  quantity: 'Quantity',
  riskLevel: 'Risk level',
  'location.building': 'Building',
  'location.room': 'Room',
  'location.floor': 'Floor',
  images: 'Photos',
  'availability.weekly': 'Opening hours',
  'availability.blackouts': 'Closures',
  'availability.slotMinutes': 'Slot length',
  'eligibility.memberTypes': 'Member types',
  'eligibility.departments': 'Departments',
  'eligibility.badges': 'Required badges',
  'eligibility.approvalMode': 'Approval',
  checklist: 'Condition checklist',
  ...Object.fromEntries(LIMIT_FIELDS.map((field) => [`limits.${field.key}`, field.label])),
};

/** Monday's 2nd window → 2: a window's place among its day's windows, counting from 1. */
export function windowNumber(weekly, index) {
  const list = Array.isArray(weekly) ? weekly : [];
  const day = list[index]?.day;
  return list.slice(0, index + 1).filter((w) => w.day === day).length;
}

/** A field path → what the error summary calls it: "Monday hours 2: closing time", "Closure 1: end". */
export function fieldLabel(path, values) {
  if (STATIC_LABELS[path]) return STATIC_LABELS[path];
  let m = /^availability\.weekly\.(\d+)(?:\.(open|close))?$/.exec(path);
  if (m) {
    const weekly = values?.availability?.weekly ?? [];
    const index = Number(m[1]);
    const day = DAY_NAMES[weekly[index]?.day] ?? 'Opening';
    const base = `${day} hours ${windowNumber(weekly, index)}`;
    return m[2] ? `${base}: ${m[2] === 'open' ? 'opening time' : 'closing time'}` : base;
  }
  m = /^availability\.blackouts\.(\d+)(?:\.(start|end|reason))?$/.exec(path);
  if (m) return `Closure ${Number(m[1]) + 1}${m[2] ? `: ${m[2]}` : ''}`;
  m = /^checklist\.(\d+)$/.exec(path);
  if (m) return `Checklist item ${Number(m[1]) + 1}`;
  m = /^images\.(\d+)$/.exec(path);
  if (m) return `Photo ${Number(m[1]) + 1}`;
  m = /^eligibility\.(departments|badges)\.(\d+)$/.exec(path);
  if (m) return `${m[1] === 'badges' ? 'Required badge' : 'Department'} ${Number(m[2]) + 1}`;
  return path;
}

/** Every path a control can show, in the order the form shows them (for the error summary). */
export function formPathOrder(values) {
  const weekly = values?.availability?.weekly ?? [];
  const blackouts = values?.availability?.blackouts ?? [];
  const departments = values?.eligibility?.departments ?? [];
  const badges = values?.eligibility?.badges ?? [];
  const images = values?.images ?? [];
  const checklist = values?.checklist ?? [];
  return [
    'orgUnit',
    'title',
    'category',
    'description',
    'usageRules',
    'bookingMode',
    'quantity',
    'riskLevel',
    ...LOCATION_KEYS.map((key) => `location.${key}`),
    'images',
    ...images.map((_, i) => `images.${i}`),
    'availability.weekly',
    ...weekly.flatMap((_, i) => [
      `availability.weekly.${i}`,
      `availability.weekly.${i}.open`,
      `availability.weekly.${i}.close`,
    ]),
    'availability.blackouts',
    ...blackouts.flatMap((_, i) => [
      `availability.blackouts.${i}`,
      `availability.blackouts.${i}.start`,
      `availability.blackouts.${i}.end`,
      `availability.blackouts.${i}.reason`,
    ]),
    'availability.slotMinutes',
    'eligibility.memberTypes',
    'eligibility.departments',
    ...departments.map((_, i) => `eligibility.departments.${i}`),
    'eligibility.badges',
    ...badges.map((_, i) => `eligibility.badges.${i}`),
    'eligibility.approvalMode',
    ...LIMIT_KEYS.map((key) => `limits.${key}`),
    'checklist',
    ...checklist.map((_, i) => `checklist.${i}`),
  ];
}

/** { path: message } → [{ path, message, label, section }] in form order (unknown paths last). */
export function errorSummary(errors, values) {
  const order = formPathOrder(values);
  const paths = Object.keys(errors ?? {});
  const rank = (path) => {
    const at = order.indexOf(path);
    return at === -1 ? order.length : at;
  };
  return paths
    .sort((a, b) => rank(a) - rank(b))
    .map((path) => ({ path, message: errors[path], label: fieldLabel(path, values), section: sectionOf(path) }));
}

/** errors → { sectionId: count }, for "Availability · 2 problems" on each heading. */
export function errorCounts(errors) {
  const counts = {};
  for (const path of Object.keys(errors ?? {})) {
    const section = sectionOf(path);
    if (section) counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}

// ── List rows: opening hours ──────────────────────────────────────────────────

/** The windows of one day, with their index in the whole list (the index the server's paths use). */
export function windowsOfDay(weekly, day) {
  return (Array.isArray(weekly) ? weekly : [])
    .map((w, index) => ({ ...w, index }))
    .filter((w) => w.day === day);
}

/**
 * Another window for `day`, after the day's last one (so the list stays in week order and no other
 * row's index moves). The first window of a day opens 09:00–17:00; a later one starts where the
 * previous one closed.
 */
export function addWindow(weekly, day) {
  const list = Array.isArray(weekly) ? weekly : [];
  const ofDay = list.filter((w) => w.day === day);
  const last = ofDay[ofDay.length - 1];
  const next = last ? window_(day, HH_MM.test(last.close) ? last.close : '', '') : window_(day, '09:00', '17:00');
  let at = list.length;
  const lastIndex = list.lastIndexOf(last);
  if (last) at = lastIndex + 1;
  else {
    const after = list.findIndex((w) => weekIndex(w.day) > weekIndex(day));
    if (after !== -1) at = after;
  }
  return [...list.slice(0, at), next, ...list.slice(at)];
}

export function removeWindow(weekly, key) {
  return (Array.isArray(weekly) ? weekly : []).filter((w) => w.key !== key);
}

export function updateWindow(weekly, key, patch) {
  return (Array.isArray(weekly) ? weekly : []).map((w) => (w.key === key ? { ...w, ...patch } : w));
}

/** `toDays` get copies of `fromDay`'s windows (or close, when it has none), replacing theirs. */
export function copyDay(weekly, fromDay, toDays) {
  const list = Array.isArray(weekly) ? weekly : [];
  const source = list.filter((w) => w.day === fromDay);
  const targets = new Set(toDays.filter((day) => day !== fromDay));
  const kept = list.filter((w) => !targets.has(w.day));
  const copies = [...targets].flatMap((day) => source.map((w) => window_(day, w.open, w.close)));
  return sortWeekly([...kept, ...copies]);
}

/**
 * What copyDay did, to be announced: the hours copied, where to, and the days whose own (different)
 * hours were replaced, e.g. "Copied Monday's hours (09:00–17:00) to every day. The hours Saturday
 * had were replaced." `toLabel` names the target days ("Tuesday–Friday").
 */
export function copyDayNotice(weekly, fromDay, toDays, toLabel) {
  const hoursOf = (day) => windowsOfDay(weekly, day).map((w) => `${w.open}–${w.close}`).join(', ');
  const source = hoursOf(fromDay);
  const replaced = toDays
    .filter((day) => day !== fromDay && hoursOf(day) && hoursOf(day) !== source)
    .map((day) => DAY_NAMES[day]);
  const names = replaced.length <= 1 ? replaced.join('') : `${replaced.slice(0, -1).join(', ')} and ${replaced.at(-1)}`;
  return `Copied ${DAY_NAMES[fromDay]}'s hours (${source}) to ${toLabel}.${
    replaced.length ? ` The hours ${names} had were replaced.` : ''
  }`;
}

/**
 * Opening hours as the server writes them (server/src/engines/eligibility.js describeOpenHours):
 * "Mon–Fri 09:00–17:00; Sat 09:00–13:00", or "closed all week". Only well-formed windows count.
 */
export function describeOpenHours(weekly) {
  const byDay = new Map();
  const valid = (Array.isArray(weekly) ? weekly : []).filter(
    (w) => w && HH_MM.test(w.open ?? '') && HH_MM.test(w.close ?? '') && w.close > w.open
  );
  for (const w of [...valid].sort((a, b) => minutesOf(a.open) - minutesOf(b.open))) {
    byDay.set(w.day, [...(byDay.get(w.day) ?? []), `${w.open}–${w.close}`]);
  }
  const runs = [];
  WEEK_ORDER.forEach((day, i) => {
    const text = byDay.get(day)?.join(', ');
    if (!text) return;
    const last = runs.at(-1);
    if (last && last.text === text && last.lastIndex === i - 1) {
      last.to = day;
      last.lastIndex = i;
    } else {
      runs.push({ from: day, to: day, text, lastIndex: i });
    }
  });
  if (!runs.length) return 'closed all week';
  return runs
    .map((r) => `${r.from === r.to ? DAY_SHORT[r.from] : `${DAY_SHORT[r.from]}–${DAY_SHORT[r.to]}`} ${r.text}`)
    .join('; ');
}

// ── List rows: closures and checklist ─────────────────────────────────────────

export function addBlackout(blackouts) {
  return [...(Array.isArray(blackouts) ? blackouts : []), { key: rowKey('closure'), start: '', end: '', reason: '' }];
}

export function removeBlackout(blackouts, key) {
  return (Array.isArray(blackouts) ? blackouts : []).filter((b) => b.key !== key);
}

export function updateBlackout(blackouts, key, patch) {
  return (Array.isArray(blackouts) ? blackouts : []).map((b) => (b.key === key ? { ...b, ...patch } : b));
}

export function addChecklistItem(checklist, label = '') {
  const list = Array.isArray(checklist) ? checklist : [];
  if (list.length >= CHECKLIST_MAX) return list;
  return [...list, { key: rowKey('check'), label }];
}

export function removeChecklistItem(checklist, key) {
  return (Array.isArray(checklist) ? checklist : []).filter((item) => item.key !== key);
}

export function updateChecklistItem(checklist, key, label) {
  return (Array.isArray(checklist) ? checklist : []).map((item) => (item.key === key ? { ...item, label } : item));
}

/** Moves an item up (-1) or down (+1); out of range leaves the list as it is. */
export function moveChecklistItem(checklist, key, delta) {
  const list = [...(Array.isArray(checklist) ? checklist : [])];
  const from = list.findIndex((item) => item.key === key);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return list;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}

/** Adds `value` to a list or takes it out. */
export function toggleIn(list, value) {
  const current = Array.isArray(list) ? list : [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

// ── Units, editors and the preview ────────────────────────────────────────────

export function isAdmin(user) {
  return Array.isArray(user?.roles) && user.roles.includes('admin');
}

const managedIds = (user) =>
  new Set((Array.isArray(user?.managedOrgUnits) ? user.managedOrgUnits : []).map(idOf).filter(Boolean));

/**
 * The units this user may list a resource for (api.md POST /resources: "A unit you manage (admins:
 * any) that exists and is active"), by name, from GET /org-units.
 */
export function unitChoices(units, user) {
  const active = (Array.isArray(units) ? units : []).filter((unit) => unit && unit.isActive !== false);
  const mine = managedIds(user);
  return active
    .filter((unit) => isAdmin(user) || mine.has(String(unit._id)))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)));
}

/** Whether this user can list anything at all: an admin, or a manager of at least one unit. */
export function canListResources(user) {
  return isAdmin(user) || managedIds(user).size > 0;
}

/** "Design and Innovation Centre (DIC)", or the code, or "Unit". */
export function unitName(unit) {
  if (!unit || typeof unit !== 'object') return 'Unit';
  const name = str(unit.name);
  const code = str(unit.code).toUpperCase();
  if (name && code) return `${name} (${code})`;
  return name || code || 'Unit';
}

/**
 * Who may edit this listing (api.md PATCH /resources/:id: "manager*", the unit's managers or an
 * admin) and why this viewer may or may not, from the detail's canManage.
 */
export function editorsText(resource, user) {
  const unit = resource?.orgUnit && typeof resource.orgUnit === 'object' ? resource.orgUnit : null;
  const name = str(unit?.name) || 'this unit';
  const who = `Managers of ${name} and admins can edit this listing.`;
  if (!resource?.canManage) return { allowed: false, text: `${who} You are neither, so it is read-only for you.` };
  const unitId = idOf(resource.orgUnit);
  const asManager = unitId && managedIds(user).has(unitId);
  return {
    allowed: true,
    text: `${who} You can edit it as ${asManager ? `a manager of ${name}` : 'an admin'}.`,
  };
}

/**
 * The values → a Card-shaped object for the preview (what members see in Explore and on the detail
 * page), with the unit, departments and badges filled in from the lists the form loaded. Nothing
 * here is sent.
 */
export function previewResource(values, { unit = null, departments = [], badges = [] } = {}) {
  const byId = (list) => new Map((Array.isArray(list) ? list : []).filter(Boolean).map((item) => [String(item._id), item]));
  const unitsById = byId(departments);
  const badgesById = byId(badges);
  const v = values ?? formValues(emptyForm());
  return {
    title: v.title || 'Untitled resource',
    description: v.description,
    usageRules: v.usageRules,
    category: v.category,
    bookingMode: v.bookingMode,
    quantity: Number.isInteger(v.quantity) ? v.quantity : 1,
    riskLevel: v.riskLevel,
    status: 'active',
    location: presentKeys(v.location),
    images: v.images,
    orgUnit: unit,
    openHours: describeOpenHours(v.availability?.weekly),
    closures: (v.availability?.blackouts ?? []).filter((b) => b.start && b.end).length,
    slotMinutes: v.availability?.slotMinutes,
    eligibility: {
      memberTypes: v.eligibility?.memberTypes ?? [],
      departments: (v.eligibility?.departments ?? []).map((id) => unitsById.get(id) ?? { _id: id }),
      badges: (v.eligibility?.badges ?? []).map((id) => badgesById.get(id) ?? { _id: id, name: 'Unknown badge' }),
      approvalMode: v.eligibility?.approvalMode,
    },
    limits: presentKeys(
      Object.fromEntries(Object.entries(v.limits ?? {}).map(([key, n]) => [key, Number.isInteger(n) ? n : null]))
    ),
    checklist: (v.checklist ?? []).filter(Boolean),
  };
}

/** "3 problems" / "1 problem". */
export function problemsText(count) {
  return plural(count, 'problem');
}
