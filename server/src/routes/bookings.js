// /api/v1/bookings (architecture.md §5 and §6 "Bookings", backend.md §6.2). Thin controllers over
// services/bookingService.js, which validates its input, checks scope (borrower, the unit's managers,
// admins) and runs every status change through the state machine, with its audit entry and
// notifications. The services take `now` from the clock, so the check-in window and the lead time
// are judged at the moment of the request.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import {
  bookingCreateLimiter,
  generalLimiter,
} from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import {
  checkBooking,
  checkIn,
  checkOut,
  confirmReturn,
  createBooking,
  getBooking,
  getTimeline,
  listForManager,
  listMine,
  transition,
} from "../services/bookingService.js";
import { assertValid } from "../services/params.js";
import { photoProblems } from "../services/uploadService.js";

const router = express.Router();

// Express 5 leaves req.body undefined when a request has no JSON body (a bare "approve" button).
// The services read fields off their input, so an absent body is passed as an empty one; it then
// fails their checks (400 or 404) instead of a TypeError (500).
const bodyOf = (req) => req.body ?? {};

// Condition and incident photos must be ones /uploads/images stored in our Cloudinary account
// (backend.md §7 bookings.checkIn, "from our own Cloudinary folder"), checked before the service so
// a report can't point at an image hosted elsewhere. → 400 VALIDATION_ERROR, details photos.<i>.
const assertOwnPhotos = (body) =>
  assertValid(photoProblems(body.photos, "photos"), "photo");

const options = (req) => ({ requestId: req.id });

// ── Requests ────────────────────────────────────────────────────────────────

// Dry run of POST /bookings: { resourceId, start, end } → the 12-rule checklist and the waitlist
// position. It creates nothing, so it is not behind blockSuspended: a suspended member gets the
// checklist, whose NOT_SUSPENDED rule says why and until when (architecture.md §7.1 blocks
// mutating routes only).
router.post("/check", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await checkBooking(req.user.id, bodyOf(req)));
});

// { resourceId, start, end, purpose, joinWaitlist? } → 201 { booking, evaluation, waitlistPosition }.
// The bookingCreate tier (10 an hour) runs after the suspension check, so a refused request isn't
// counted against it (architecture.md §11).
router.post(
  "/",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  bookingCreateLimiter,
  async (req, res) => {
    const created = await createBooking(req.user.id, bodyOf(req), options(req));
    sendData(req, res, created, { status: 201 });
  },
);

// ── Lists (static paths before /:id) ──────────────────────────────────────

// ?status&page&limit → the member's own bookings, latest start first.
router.get("/mine", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listMine(req.user.id, req.query));
});

// ?status&resourceId&from&to&page&limit, own units only (admins: all). With status=pending the
// service returns { groups, meta }: each pending request with the waitlisted ones competing for its
// slot (architecture.md §6), sent as data = groups with meta beside it.
router.get("/manage", verifyAuth, generalLimiter, async (req, res) => {
  const queue = await listForManager(req.user.id, req.query);
  if (queue.groups) sendData(req, res, queue.groups, { meta: queue.meta });
  else sendList(req, res, queue);
});

// ── One booking ─────────────────────────────────────────────────────────────

// The booking with allowedActions (the buttons to show), isOverdue and waitlistPosition.
router.get("/:id", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await getBooking(req.params.id, req.user.id));
});

// Audit entries, condition reports and incidents, oldest first.
router.get("/:id/timeline", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await getTimeline(req.params.id, req.user.id));
});

// Decisions go through one function (architecture.md §5): approve { note? }, reject and waitlist
// { reason }, cancel { reason } (required unless the borrower cancels). → the updated booking.
for (const action of ["approve", "reject", "waitlist", "cancel"]) {
  router.post(
    `/:id/${action}`,
    verifyAuth,
    generalLimiter,
    blockSuspended,
    async (req, res) => {
      const updated = await transition(
        req.params.id,
        action,
        req.user.id,
        bodyOf(req),
        options(req),
      );
      sendData(req, res, updated);
    },
  );
}

// Handovers: { items[{ label, ok, note? }] (every checklist item once), photos[{ url, publicId }],
// overall, notes } → the updated booking. Check-in opens 15 minutes before the start.
const handovers = { "check-in": checkIn, "check-out": checkOut };
for (const [path, handover] of Object.entries(handovers)) {
  router.post(
    `/:id/${path}`,
    verifyAuth,
    generalLimiter,
    blockSuspended,
    async (req, res) => {
      const report = bodyOf(req);
      assertOwnPhotos(report);
      sendData(
        req,
        res,
        await handover(req.params.id, req.user.id, report, options(req)),
      );
    },
  );
}

// The manager's inspection: { outcome: "ok" | "issue", items?, photos?, note?, incident? { type,
// severity, description } } → { booking, incident }. "issue" flags the booking and opens an incident
// for a human to resolve. 200, not 201: the resource acted on is the booking; the incident comes with
// it.
router.post(
  "/:id/confirm-return",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    const input = bodyOf(req);
    assertOwnPhotos(input);
    sendData(
      req,
      res,
      await confirmReturn(req.params.id, req.user.id, input, options(req)),
    );
  },
);

export default router;
