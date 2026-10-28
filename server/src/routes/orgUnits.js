// /api/v1/org-units (architecture.md §6 OrgUnits). Only the catalogue for now, which the verification
// form needs for its department list; the admin routes come in Phase 3.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import { isAdmin } from "../services/access.js";
import { listOrgUnits } from "../services/orgUnitService.js";
import { requireUser } from "../services/params.js";

const router = express.Router();

// includeInactive counts only as the literal "true" (progress.md §6.5). Manager ids are for admin
// screens only (architecture.md §16 "Least data"); the role is read from the database, not the
// token, so a revoked admin stops seeing them at once.
router.get("/", verifyAuth, generalLimiter, async (req, res) => {
  const viewer = await requireUser(req.user.id);
  const units = await listOrgUnits({
    includeInactive: req.query.includeInactive === "true",
    includeManagers: isAdmin(viewer),
  });
  sendData(req, res, units);
});

export default router;
