// /api/v1/audit (architecture.md §6 "Audit, uploads, admin, health", §7.2 "View audit log", §13.2).
// Read-only: the log is append-only and no route writes to it. auditService decides the scope from
// the database, not the token: admins read everything, managers their units' entries, and members
// get 403 pointing them to each booking's timeline.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendList } from "../lib/respond.js";
import { listAudit } from "../services/auditService.js";

const router = express.Router();

// ?entityType&entityId&actorId&action&orgUnit&from&to ([from, to) on `at`)&page&limit → newest first.
router.get("/", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listAudit(req.user.id, req.query));
});

export default router;
