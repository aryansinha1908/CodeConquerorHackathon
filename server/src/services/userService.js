// User administration (architecture.md §6 Admin, frontend.md §6 "/admin/users"). So far the list an
// admin searches, e.g. to pick a unit's managers for PUT /org-units/:id/managers; role and suspension
// changes come later. The admin role is read from the database, never the token, so a revoked admin
// is refused at once.
//
// Admins see each user's email, which managers and members never get (architecture.md §16 "Least
// data"); nothing about the ID card is listed. A demo admin sees demo accounts only, for the same
// reason as the verification queue (verificationService.js): anyone can be the demo admin with one
// click and no password, on the deployment where real members register.
import { ROLES, VERIFICATION_STATUSES } from "../models/enums.js";
import { User } from "../models/index.js";
import { requireAdmin } from "./access.js";
import { DEMO_EMAIL, isDemoAccount } from "./authService.js";
import {
  assertValid,
  readEnum,
  readPaging,
  readText,
  requireUser,
} from "./params.js";

const MAX_QUERY = 100;
// Only what a row shows: of the verification, just its status, so nothing about the card or its
// review is read at all.
const LIST_FIELDS =
  "name email roles memberType department verification.status managedOrgUnits suspendedUntil";

// q is matched as text, never as a pattern: "a.b" finds "a.b", and "(a+)+" can't make MongoDB backtrack.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Users created before the field existed have no status, which reads as unsubmitted.
const verificationFilter = (status) =>
  status === "unsubmitted" ? { $in: ["unsubmitted", null] } : status;

// The admin's row for one user: who they are, what they can do, and whether they are verified and
// in good standing. Ids as strings, missing values as null, the same shapes as elsewhere.
export function userRow(user) {
  const dept = user.department;
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    roles: user.roles ?? [],
    memberType: user.memberType ?? null,
    department: dept?.code
      ? { _id: String(dept._id), code: dept.code, name: dept.name }
      : null,
    verification: { status: user.verification?.status ?? "unsubmitted" },
    managedOrgUnits: (user.managedOrgUnits ?? []).map(String),
    suspendedUntil: user.suspendedUntil ?? null,
  };
}

// GET /admin/users (admins). query: { q? (name or email, case-insensitive), role?, verification?,
// page, limit } → { items: userRow[], meta: { page, limit, total } }, newest account first.
export async function listUsers(viewerId, query = {}) {
  const admin = requireAdmin(
    await requireUser(viewerId),
    "Only an admin can list users.",
  );
  const problems = [];
  const q = readText(query.q, "q", problems, { max: MAX_QUERY });
  const role = readEnum(query.role, ROLES, "role", problems);
  const verification = readEnum(
    query.verification,
    VERIFICATION_STATUSES,
    "verification",
    problems,
  );
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const pattern = q && new RegExp(escapeRegExp(q), "i");
  const filter = {
    ...(isDemoAccount(admin) && { email: DEMO_EMAIL }),
    // A separate clause, so it narrows the demo filter on email instead of replacing it.
    ...(pattern && { $or: [{ name: pattern }, { email: pattern }] }),
    ...(role && { roles: role }),
    ...(verification && {
      "verification.status": verificationFilter(verification),
    }),
  };
  const [rows, total] = await Promise.all([
    User.find(filter)
      .select(LIST_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("department", "code name")
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items: rows.map(userRow), meta: { page, limit, total } };
}
