// /api/v1/incidents (architecture.md §6 Incidents, §7.2 "Resolve incidents"; backend.md B-16). Thin
// controllers over incidentService, which loads the incident and its booking and decides who may see,
// comment on and resolve it (borrower, reporter, the unit's managers, admins), so no scope check
// lives here.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import {
  addComment,
  createIncident,
  getIncident,
  listIncidents,
  resolveIncident,
} from "../services/incidentService.js";
import { assertValid } from "../services/params.js";
import { photoProblems } from "../services/uploadService.js";

const router = express.Router();

// { bookingId?, resourceId (unless bookingId), type, severity, description, photos? } → 201 with
// the incident as GET /incidents/:id shows it. The service only checks each photo's shape; that it
// is one of our own Cloudinary uploads (backend.md §7 "from our own Cloudinary folder") is checked
// here first, so a report can't point at an image hosted elsewhere.
router.post(
  "/",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    assertValid(photoProblems(req.body?.photos), "field");
    const incident = await createIncident(req.user.id, req.body, {
      requestId: req.id,
    });
    sendData(req, res, incident, { status: 201 });
  },
);

// ?status (one or a comma list)&type&severity&resourceId&page&limit → the viewer's scope: their own
// reports and bookings, plus a manager's units, or everything for an admin.
router.get("/", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listIncidents(req.user.id, req.query));
});

router.get("/:id", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await getIncident(req.user.id, req.params.id));
});

// { text } → 201 with the whole incident, so the thread re-renders from one answer (a manager's
// first comment also moves it to in_review).
router.post(
  "/:id/comments",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    const incident = await addComment(req.user.id, req.params.id, req.body, {
      requestId: req.id,
    });
    sendData(req, res, incident, { status: 201 });
  },
);

// { outcome, rationale } → the incident plus bookingClosed. 200, not 201: nothing new is created.
router.post(
  "/:id/resolve",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    sendData(
      req,
      res,
      await resolveIncident(req.user.id, req.params.id, req.body, {
        requestId: req.id,
      }),
    );
  },
);

export default router;
