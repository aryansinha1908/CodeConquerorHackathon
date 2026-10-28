// Append-only audit trail (backend.md §8.1, architecture.md §13.2). Call it from services only, after
// the change has succeeded, so the log never claims something that didn't happen. Awaited on purpose:
// if the write fails, the request fails, and no action goes unrecorded.
import { AuditLog } from "../models/index.js";

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
