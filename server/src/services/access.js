// Role and unit-scope checks for services that act on an org unit rather than on a booking: the
// `manager*` and `admin` auth levels in the route tables (architecture.md §6, backend.md B-07/B-08).
// Same rules as relationsOf() in engines/stateMachine.js: a manager acts only for the units in
// managedOrgUnits, an admin for every unit.
import { forbidden } from "../lib/serviceError.js";

// Populated docs and raw ids (ObjectId or string, in either case of hex) compare the same way.
const idOf = (x) => (x == null ? null : String(x._id ?? x).toLowerCase());
const hasRole = (user, role) => Boolean(user?.roles?.includes(role));

export const isAdmin = (user) => hasRole(user, "admin");

// The manager role is checked as well as the list, so a user whose role was taken away keeps no
// access through a managedOrgUnits entry that wasn't cleared.
export function managesUnit(user, orgUnitId) {
  if (isAdmin(user)) return true;
  const unit = idOf(orgUnitId);
  return (
    unit !== null &&
    hasRole(user, "manager") &&
    (user.managedOrgUnits ?? []).some((u) => idOf(u) === unit)
  );
}

// Both return the user, so a service can write `const actor = requireAdmin(await requireUser(id))`.
export function requireAdmin(user, message = "Only an admin can do that.") {
  if (!isAdmin(user)) throw forbidden(message);
  return user;
}

export function requireUnitManager(
  user,
  orgUnitId,
  message = "Only this unit's managers can do that.",
) {
  if (!managesUnit(user, orgUnitId)) throw forbidden(message);
  return user;
}
