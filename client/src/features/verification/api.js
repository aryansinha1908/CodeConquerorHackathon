import http from '../../lib/http';
import { getMe } from '../auth/api';
import { useAuthStore } from '../../stores/auth';

// ID verification (architecture.md §6 "Verification", §8; backend.md B-03; frontend.md §6.2).
//
// Every request function resolves with the success envelope { success, data, meta?, requestId } and
// rejects with the normalised error of lib/http.js: { status, code, message, details, retryAfter,
// requestId }. There is no fallback to the store or to made-up data: a failed request is shown as a
// failure with its request id (frontend.md §8.3), never as a success.

// ── Query keys (frontend.md §8.2) ─────────────────────────────────────────────

export const verificationKeys = {
  status: ['verification', 'status'],
};

export const orgUnitKeys = {
  // Not ['org-units']: ExplorePage keeps mock units under that key until Phase 4 (getOrgUnits in
  // resources/api.js), and their fake ids would be refused by POST /verification/id-card.
  // Invalidating ['org-units'] covers both.
  active: ['org-units', 'active'],
};

// ── Enums and labels ──────────────────────────────────────────────────────────

// The server's MEMBER_TYPES (server/src/models/enums.js), lower case on the wire.
export const MEMBER_TYPES = ['ug', 'pg', 'rs', 'faculty', 'staff'];

const MEMBER_TYPE_LABELS = {
  ug: 'Undergraduate (UG)',
  pg: 'Postgraduate (PG)',
  rs: 'Research scholar (PhD)',
  faculty: 'Faculty',
  staff: 'Staff',
};

export const MEMBER_TYPE_OPTIONS = MEMBER_TYPES.map((value) => ({
  value,
  label: MEMBER_TYPE_LABELS[value],
}));

export function memberTypeLabel(value) {
  if (!value) return 'Not set';
  return MEMBER_TYPE_LABELS[value] ?? String(value).toUpperCase();
}

// The ID-card file rules of backend.md §7 (verification.idCard) and frontend.md §9, checked here for
// instant feedback only: the server reads the real type from the bytes.
export const ID_CARD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ID_CARD_MAX_BYTES = 5 * 1024 * 1024;

/** → an error message for the file, or null when it may be sent. */
export function checkIdCardFile(file) {
  if (!file) return 'Attach a photo or scan of your institute ID card.';
  if (!ID_CARD_TYPES.includes(file.type)) return 'Use a JPG, PNG, WEBP or PDF file.';
  if (file.size > ID_CARD_MAX_BYTES) return 'The file is larger than 5 MB.';
  return null;
}

/**
 * A picked file → { file } to send, or { error }. An image goes through `compress` first
 * (browser-image-compression on the page), and the 5 MB limit applies to what is sent, as on the
 * server: a 7 MB phone photo that compresses to 1 MB is fine. A PDF, or an image the browser can't
 * compress, is checked as it is.
 */
export async function prepareIdCardFile(picked, compress) {
  if (!picked || !ID_CARD_TYPES.includes(picked.type)) return { error: checkIdCardFile(picked) };
  let file = picked;
  if (picked.type.startsWith('image/')) {
    try {
      const compressed = await compress(picked);
      // Keep the original name and type; keep the original when compressing didn't help.
      if (compressed.size < picked.size) {
        file = new File([compressed], picked.name, { type: compressed.type || picked.type });
      }
    } catch {
      // An image the browser can't decode goes up as it is: the server reads the real type.
    }
  }
  const error = checkIdCardFile(file);
  return error ? { error } : { file };
}

// ── Email hints (architecture.md §8 "Email-pattern hints") ────────────────────

// The branch of a roll-number address → an org-unit code, from the lookup table in architecture.md
// §8. A branch that already is a unit code (ee, mme, mca, …) maps to itself; anything else leaves
// the department blank for the user to choose.
const BRANCH_TO_DEPARTMENT = {
  cs: 'cse',
  ec: 'ece',
  ee: 'ee',
  me: 'mech',
  ce: 'civil',
  mm: 'mme',
  pi: 'prod',
};

const HINT_LEVELS = ['ug', 'pg', 'rs'];

/** emailHints.level → a member type, or null. Faculty and staff addresses have no hints. */
export function memberTypeFromHints(hints) {
  const level = hints?.level;
  return HINT_LEVELS.includes(level) ? level : null;
}

/** emailHints.branch → the org-unit code it points at, or null. */
export function departmentCodeFromHints(hints) {
  const branch = typeof hints?.branch === 'string' ? hints.branch.toLowerCase() : null;
  if (!branch) return null;
  return BRANCH_TO_DEPARTMENT[branch] ?? branch;
}

/**
 * The department among `units` that the hints point at, or null: a branch that is neither in the
 * table nor a department's code (e.g. "cese") gives no hint. Use this, not the raw code, to compare
 * hints with a choice.
 */
export function departmentFromHints(hints, units) {
  const code = departmentCodeFromHints(hints);
  if (!code || !Array.isArray(units)) return null;
  return units.find((unit) => unit.code === code && unit.type === 'department') ?? null;
}

/** "UG · CS · 2024 · #999", or null when the address had no roll-number pattern. */
export function formatEmailHints(hints) {
  if (!hints || (!hints.level && hints.year == null)) return null;
  return [
    hints.level && hints.level.toUpperCase(),
    hints.branch && hints.branch.toUpperCase(),
    hints.year != null && String(hints.year),
    hints.serial && `#${hints.serial}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── Org units ─────────────────────────────────────────────────────────────────

export const UNIT_GROUPS = [
  { type: 'department', label: 'Departments' },
  { type: 'centre', label: 'Centres' },
  { type: 'central_facility', label: 'Central facilities' },
];

/** The active units among `units` (anything but an array → []). */
export function activeUnits(units) {
  return Array.isArray(units) ? units.filter((unit) => unit.isActive !== false) : [];
}

/**
 * Active units → [{ type, label, units }] in UNIT_GROUPS order, each by name, empty groups left
 * out: the <optgroup>s of every department picker. Any active unit may be a member's department
 * (staff of the Central Workshop, say), so the member form and the admin dialog list the same.
 */
export function groupUnits(units) {
  const active = activeUnits(units);
  return UNIT_GROUPS.map((group) => ({
    ...group,
    units: active
      .filter((unit) => unit.type === group.type)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.units.length > 0);
}

/** GET /org-units → data [{ _id, name, code, type, location, isActive }], active units only. */
export async function getActiveOrgUnits() {
  const res = await http.get('/org-units');
  return res.data;
}

// ── Times (frontend.md §1, principle 6: everything on screen is IST) ──────────

const istDateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** An ISO instant → "29 Oct 2026, 02:49 am IST", or null. */
export function formatIstDateTime(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${istDateTime.format(date)} IST`;
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * A VALIDATION_ERROR's details [{ path, message }] → { [path]: message } for the form fields
 * (frontend.md §8.3). The first message for a path wins. Anything else → {}.
 */
export function fieldErrorsFrom(err) {
  if (err?.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return {};
  const fields = {};
  for (const detail of err.details) {
    const path = typeof detail?.path === 'string' ? detail.path : null;
    if (path && !(path in fields)) fields[path] = String(detail.message ?? 'Invalid value.');
  }
  return fields;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * GET /verification/status → data { status, reason, submittedAt, reviewedAt, memberType,
 * department: { _id, code, name } | null, hasIdCard }.
 */
export async function getVerificationStatus() {
  const res = await http.get('/verification/status');
  return res.data;
}

/**
 * The multipart body of POST /verification/id-card. The text fields go first: a multipart parser
 * sees fields in stream order, so the server can check them before it reads the file.
 */
export function buildIdCardForm({ file, memberType, department }) {
  const form = new FormData();
  form.append('memberType', memberType);
  form.append('department', department);
  form.append('idCard', file, file?.name || 'id-card');
  return form;
}

/**
 * POST /verification/id-card (multipart: idCard, memberType, department) → 201 data = the status
 * view. No Content-Type header: the browser sets multipart/form-data with its boundary.
 */
export async function uploadIdCard(formData) {
  const res = await http.post('/verification/id-card', formData);
  return res.data;
}

/** GET /auth/me → data = user; stored so the nav, banners and guards see the new status. */
export async function refreshCurrentUser() {
  const res = await getMe();
  useAuthStore.getState().setUser(res.data);
  return res.data;
}
