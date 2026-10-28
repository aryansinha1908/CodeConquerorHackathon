import mongoose from "mongoose";
import { EVENT_NAME, ref } from "./helpers.js";

const { Schema } = mongoose;

// Append-only record of every important action (architecture.md §13.2). Write entries through
// auditService.record(). Every update and delete path below throws, so no route can rewrite history.
const auditLogSchema = new Schema(
  {
    actor: {
      // null for the system (cron sweeper, waitlist promotion).
      id: ref("User", { default: null }),
      role: { type: String, required: true, trim: true }, // member | manager | admin | system
    },
    action: { type: String, required: true, match: EVENT_NAME },
    entity: {
      type: { type: String, required: true, trim: true }, // booking, resource, user, incident, …
      id: { type: Schema.Types.ObjectId, required: true },
    },
    orgUnit: ref("OrgUnit"),
    reason: { type: String, trim: true, maxlength: 1000 },
    // { field: [before, after] }
    changes: Schema.Types.Mixed,
    requestId: String,
    meta: Schema.Types.Mixed,
    // C-02 hash chain: hash = sha256(prevHash + canonicalJSON(entry)).
    prevHash: String,
    hash: String,
  },
  { timestamps: { createdAt: "at", updatedAt: false } },
);

function appendOnly() {
  throw new Error("Audit log entries are append-only");
}

for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "bulkWrite", // blocks bulk inserts too; use insertMany
]) {
  auditLogSchema.pre(op, appendOnly);
}
auditLogSchema.pre("deleteOne", { document: true, query: false }, appendOnly);
auditLogSchema.pre("updateOne", { document: true, query: false }, appendOnly);
auditLogSchema.pre("save", function () {
  if (!this.isNew) appendOnly();
});

auditLogSchema.index({ "entity.type": 1, "entity.id": 1, at: 1 }); // booking timeline
auditLogSchema.index({ orgUnit: 1, at: -1 }); // manager's audit view
auditLogSchema.index({ "actor.id": 1, at: -1 }); // a user's activity

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
