// /api/v1/resources (architecture.md §6 Resources, backend.md B-07/B-08, frontend.md §6). Thin: each
// route passes req.user.id and the request's params, body or query as they are to
// services/resourceService.js, which validates every input (backend.md §7) and checks the unit scope
// (manager* = a manager of the resource's unit, or an admin). Errors are thrown; Express 5 forwards
// rejected promises to middleware/errorHandler.js.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import {
  createResource,
  getAvailability,
  getEligibility,
  getResource,
  listResourceBookings,
  listResources,
  setResourceStatus,
  updateResource,
} from "../services/resourceService.js";

const router = express.Router();

// architecture.md §7.1 "Suspension": a suspended user still reads, but every write is 403.
const read = [verifyAuth, generalLimiter];
const write = [verifyAuth, generalLimiter, blockSuspended];

// ?q, category, orgUnit, memberType, date (IST YYYY-MM-DD), status (comma list), page, limit,
// eligibleOnly → the cards, with { page, limit, total } (and capped with eligibleOnly) in meta.
router.get("/", ...read, async (req, res) => {
  sendList(req, res, await listResources(req.user.id, req.query));
});

// The listing form plus orgUnit → 201 with the resource as GET /:id returns it.
router.post("/", ...write, async (req, res) => {
  const resource = await createResource(req.user.id, req.body, {
    requestId: req.id,
  });
  sendData(req, res, resource, { status: 201 });
});

router.get("/:id", ...read, async (req, res) => {
  sendData(req, res, await getResource(req.user.id, req.params.id));
});

// A partial listing form; status has its own route below, which asks for a reason.
router.patch("/:id", ...write, async (req, res) => {
  sendData(
    req,
    res,
    await updateResource(req.user.id, req.params.id, req.body, {
      requestId: req.id,
    }),
  );
});

// { status, reason } → { resource, affectedBookings }. Nothing is cancelled: the count lets the
// manager's screen warn about bookings that still hold a slot.
router.patch("/:id/status", ...write, async (req, res) => {
  sendData(
    req,
    res,
    await setResourceStatus(req.user.id, req.params.id, req.body, {
      requestId: req.id,
    }),
  );
});

// ?from, to (at most 14 days) → { quantity, openWindows, busy }, with no borrower data
// (architecture.md §16 "Least data").
router.get("/:id/availability", ...read, async (req, res) => {
  const { from, to } = req.query;
  sendData(req, res, await getAvailability(req.params.id, { from, to }));
});

// ?start, end (both or neither): with a slot, the same 12-rule check as POST /bookings/check;
// without one, the member rules and the quota meter.
router.get("/:id/eligibility", ...read, async (req, res) => {
  const { start, end } = req.query;
  sendData(
    req,
    res,
    await getEligibility(req.user.id, req.params.id, { start, end }),
  );
});

// ?status, from, to, page, limit → the resource's bookings for its unit's managers.
router.get("/:id/bookings", ...read, async (req, res) => {
  sendList(
    req,
    res,
    await listResourceBookings(req.user.id, req.params.id, req.query),
  );
});

export default router;
