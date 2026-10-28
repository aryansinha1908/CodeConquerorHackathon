// /api/v1/admin (architecture.md §6 Verification; the user routes come in Phase 3). Each service
// checks the admin role itself, from the database rather than the token, so a revoked admin is
// refused at once.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import {
  decideVerification,
  getIdCardUrl,
  listVerifications,
} from "../services/verificationService.js";

const router = express.Router();

// ── Verification queue ──────────────────────────────────────────────────────

// ?status=pending|approved|rejected (default pending)&page&limit
router.get("/verifications", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listVerifications(req.user.id, req.query));
});

// A 5-minute signed link to the ID card; each call is audited. The link is a credential, so the
// answer must not be cached by the browser or a proxy.
router.get(
  "/verifications/:userId/id-card",
  verifyAuth,
  generalLimiter,
  async (req, res) => {
    const link = await getIdCardUrl(req.user.id, req.params.userId, {
      requestId: req.id,
    });
    res.set("Cache-Control", "no-store");
    sendData(req, res, link);
  },
);

// { decision: "approve" | "reject", submittedAt (the queue item's), reason, memberType?,
// department? } → the queue item; a card sent since that submittedAt is 409.
router.patch(
  "/verifications/:userId",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    sendData(
      req,
      res,
      await decideVerification(req.user.id, req.params.userId, req.body, {
        requestId: req.id,
      }),
    );
  },
);

export default router;
