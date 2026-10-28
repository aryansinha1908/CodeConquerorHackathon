// Append-only audit trail (backend.md §8.1, architecture.md §13.2). Call it from services only, after
// the change has succeeded, so the log never claims something that didn't happen. Awaited on purpose:
// if the write fails, the request fails, and no action goes unrecorded.
//
// listAudit() is the reading half, for the admin and manager audit pages.
import { forbidden } from "../lib/serviceError.js";
import { EVENT_NAME } from "../models/helpers.js";
import { AuditLog } from "../models/index.js";
import { isAdmin, managesUnit } from "./access.js";
import {
  assertValid,
  readId,
  readInstant,
  readMatch,
  readPaging,
  requireUser,
} from "./params.js";

export const SYSTEM_ACTOR = Object.freeze({ id: null, role: "system" });

// actor: { id, role } where role is the capacity they acted in: member | manager | admin | system
// action: "entity.verb", e.g. "booking.approved"; entity: { type, id }
// changes: { field: [before, after] }
export function record({
  actor,
  action,
  entity,
  orgUnit,
  reason,
  changes,
  meta,
  requestId,
}) {
  return AuditLog.create({
    actor: { id: actor.id ?? null, role: actor.role },
    action,
    entity,
    orgUnit,
    reason,
    changes,
    meta,
    requestId,
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────

// The `entity.type` values the services write: booking, resource, badge, user_badge, incident, …
const ENTITY_TYPE = /^[a-z][a-z_]{1,39}$/;

// An admin reads everything; a manager the entries of their units (architecture.md §7.2 "View audit
// log"). Entries with no unit (user and verification events) are therefore admin-only.
function auditScope(viewer, orgUnit) {
  if (isAdmin(viewer)) return orgUnit ? { orgUnit } : {};
  if (!viewer.roles?.includes("manager"))
    throw forbidden(
      "Only managers and admins can read the audit log. Your bookings' history is on each booking's timeline.",
    );
  if (orgUnit) {
    if (!managesUnit(viewer, orgUnit))
      throw forbidden("You can only read your own units' audit entries.");
    return { orgUnit };
  }
  return { orgUnit: { $in: viewer.managedOrgUnits ?? [] } };
}

// GET /audit. query: { entityType, entityId, actorId, action, orgUnit, from, to, page, limit }, with
// from and to bounding `at` as [from, to) → { items, meta: { page, limit, total } }, newest first.
// Each actor comes with their name, never their email; hash-chain fields (C-02) stay out.
export async function listAudit(viewerId, query = {}) {
  const viewer = await requireUser(viewerId);
  const problems = [];
  const entityType = readMatch(
    query.entityType,
    ENTITY_TYPE,
    "entityType",
    problems,
    'Must be an entity type such as "booking".',
  );
  const entityId = readId(query.entityId, "entityId", problems);
  const actorId = readId(query.actorId, "actorId", problems);
  const action = readMatch(
    query.action,
    EVENT_NAME,
    "action",
    problems,
    'Must be an action such as "booking.approved".',
  );
  const orgUnit = readId(query.orgUnit, "orgUnit", problems);
  const from = readInstant(query.from, "from", problems);
  const to = readInstant(query.to, "to", problems);
  if (from && to && !(from < to))
    problems.push({ path: "to", message: "Must be after from." });
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const filter = {
    ...auditScope(viewer, orgUnit),
    ...(entityType && { "entity.type": entityType }),
    ...(entityId && { "entity.id": entityId }),
    ...(actorId && { "actor.id": actorId }),
    ...(action && { action }),
    ...((from || to) && {
      at: { ...(from && { $gte: from }), ...(to && { $lt: to }) },
    }),
  };
  const [rows, total] = await Promise.all([
    AuditLog.find(filter, { prevHash: 0, hash: 0, __v: 0 })
      .sort({ at: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("actor.id", "name")
      .populate("orgUnit", "name code")
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  const items = rows.map(({ actor, ...entry }) => ({
    ...entry,
    actor: {
      id: actor.id?._id ?? null,
      role: actor.role,
      name: actor.id?.name ?? null,
    },
  }));
  return { items, meta: { page, limit, total } };
}
