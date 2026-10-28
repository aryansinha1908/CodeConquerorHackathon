// /api/v1/org-units (architecture.md §6 OrgUnits). Anyone signed in reads the catalogue (the
// verification form needs it for its department list); only admins create, edit or staff a unit.
// Thin: services/orgUnitService.js validates every input (backend.md §7) and checks the admin role
// from the database, not the token, so a revoked admin is refused at once. Errors are thrown;
// Express 5 forwards rejected promises to middleware/errorHandler.js.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import { isAdmin } from "../services/access.js";
import {
  createOrgUnit,
  listOrgUnits,
  setOrgUnitManagers,
  updateOrgUnit,
} from "../services/orgUnitService.js";
import { requireUser } from "../services/params.js";

const router = express.Router();

// architecture.md §7.1 "Suspension": a suspended user still reads, but every write is 403.
const read = [verifyAuth, generalLimiter];
const write = [verifyAuth, generalLimiter, blockSuspended];

// includeInactive counts only as the literal "true" (progress.md §6.5). Manager ids are for admin
// screens only (architecture.md §16 "Least data"); the role is read from the database, not the
// token, so a revoked admin stops seeing them at once.
router.get("/", ...read, async (req, res) => {
  const viewer = await requireUser(req.user.id);
  const units = await listOrgUnits({
    includeInactive: req.query.includeInactive === "true",
    includeManagers: isAdmin(viewer),
  });
  sendData(req, res, units);
});

// { name, code, type, location?, isActive? } → 201 with the unit. Managers are assigned with PUT
// /:id/managers, which also gives those users the manager role.
router.post("/", ...write, async (req, res) => {
  const unit = await createOrgUnit(req.user.id, req.body, {
    requestId: req.id,
  });
  sendData(req, res, unit, { status: 201 });
});

// Any of { name, type, location, isActive }; the code is fixed for life (progress.md §5).
router.patch("/:id", ...write, async (req, res) => {
  sendData(
    req,
    res,
    await updateOrgUnit(req.user.id, req.params.id, req.body, {
      requestId: req.id,
    }),
  );
});

// { managerIds: [userId] } replaces the list as a whole; calling it again with the same list repairs
// a sync that failed part-way (progress.md §5 "Org units").
router.put("/:id/managers", ...write, async (req, res) => {
  sendData(
    req,
    res,
    await setOrgUnitManagers(req.user.id, req.params.id, req.body?.managerIds, {
      requestId: req.id,
    }),
  );
});

export default router;
