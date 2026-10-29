// /api/v1/badge-requests (architecture.md §6 Badges, backend.md B-09): the issuing unit's managers,
// or an admin, work the queue of badge requests and open their evidence. Thin:
// services/badgeService.js validates every input (backend.md §7 badgeRequests.*), checks the unit
// scope and refuses self-review. Errors are thrown; Express 5 forwards rejected promises to
// middleware/errorHandler.js.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { fileLinkLimiter, generalLimiter } from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import {
  decideBadgeRequest,
  getEvidenceUrl,
  listBadgeRequests,
} from "../services/badgeService.js";

const router = express.Router();

// ?status (default requested), badgeId, page, limit → queue rows with { page, limit, total } in meta.
// Open requests come oldest first, decided ones newest decision first.
router.get("/", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listBadgeRequests(req.user.id, req.query));
});

// A 5-minute link to the request's evidence file for the issuing unit's managers, admins and the
// member who sent it; each one is audited. The link is a credential, so the answer must not be
// cached by the browser or a proxy (the same as the ID-card link in routes/admin.js). Each link
// costs a Cloudinary Admin API call, hence fileLinkLimiter, shared with that route.
router.get(
  "/:id/evidence",
  verifyAuth,
  generalLimiter,
  fileLinkLimiter,
  async (req, res) => {
    const link = await getEvidenceUrl(req.user.id, req.params.id, {
      requestId: req.id,
    });
    res.set("Cache-Control", "no-store");
    sendData(req, res, link);
  },
);

// { decision: "approve" | "reject", reason } (reason required to reject) → the queue row.
// architecture.md §7.1 "Suspension": a suspended manager can't decide.
router.patch(
  "/:id",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    sendData(
      req,
      res,
      await decideBadgeRequest(req.user.id, req.params.id, req.body, {
        requestId: req.id,
      }),
    );
  },
);

export default router;
