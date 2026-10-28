/**
 * emailPattern.js
 * Mirrors the server-side pattern used in B-02.
 * Roll number format at NIT JSR: YYYYLLBBBNNN
 *   YYYY = joining year (4 digits)
 *   LL   = level code  (ug | pg | rs | mca | …)
 *   BBB  = branch code (cs, ec, ee, me, ce, mt, pi, ch, ph, ma, hm)
 *   NNN  = serial (digits)
 * Examples:
 *   2024ugcs001@nitjsr.ac.in  → UG · CSE · 2024
 *   2022pgec012@nitjsr.ac.in  → PG · ECE · 2022
 *   faculty@nitjsr.ac.in      → Faculty/staff email
 */

const LEVEL_MAP = {
  ug: 'UG',
  pg: 'PG',
  rs: 'Research Scholar',
  mca: 'MCA',
  mdes: 'M.Des',
};

const BRANCH_MAP = {
  cs: 'CSE',
  cse: 'CSE',
  ec: 'ECE',
  ece: 'ECE',
  ee: 'Electrical',
  me: 'Mechanical',
  mech: 'Mechanical',
  ce: 'Civil',
  civil: 'Civil',
  mt: 'Metallurgical',
  mme: 'Metallurgical',
  pi: 'Production',
  prod: 'Production',
  ch: 'Chemistry',
  chem: 'Chemistry',
  ph: 'Physics',
  phys: 'Physics',
  ma: 'Mathematics',
  maths: 'Mathematics',
  hm: 'HSSM',
  hssm: 'HSSM',
  ca: 'MCA',
  mca: 'MCA',
};

// Regex: (year)(level)(branch)(serial)@nitjsr.ac.in
const STUDENT_RE = /^(\d{4})(ug|pg|rs|mca|mdes)([a-z]{1,5})(\d+)@nitjsr\.ac\.in$/i;

/**
 * @param {string} email
 * @returns {{ type: 'student'|'faculty'|'unknown'|null, year?: string, level?: string, branch?: string } | null}
 */
export function parseEmailHints(email) {
  if (!email || !email.includes('@')) return null;

  const lower = email.toLowerCase().trim();

  if (!lower.endsWith('@nitjsr.ac.in')) return { type: 'unknown' };

  const match = lower.match(STUDENT_RE);
  if (!match) {
    // Could be faculty/staff — no numeric roll prefix
    return { type: 'faculty' };
  }

  const [, year, rawLevel, rawBranch] = match;
  const level = LEVEL_MAP[rawLevel.toLowerCase()] ?? rawLevel.toUpperCase();
  const branch = BRANCH_MAP[rawBranch.toLowerCase()] ?? rawBranch.toUpperCase();

  return { type: 'student', year, level, branch };
}

/**
 * Returns the friendly chip text, e.g. "Detected: UG · CSE · 2024"
 * Returns null if the pattern is not recognisable.
 */
export function getEmailChip(email) {
  const hints = parseEmailHints(email);
  if (!hints) return null;
  if (hints.type === 'student') {
    return `Detected: ${hints.level} · ${hints.branch} · ${hints.year}`;
  }
  if (hints.type === 'faculty') {
    return 'Faculty/staff email — you\'ll upload a faculty ID card';
  }
  return null;
}

