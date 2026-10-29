// /api/v1/admin (architecture.md §6 Verification and Admin): the ID-card verification queue and the
// user list. Each service checks the admin role itself, from the database rather than the token, so
// a revoked admin is refused at once.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { fileLinkLimiter, generalLimiter } from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import { listUsers } from "../services/userService.js";
import {
  decideVerification,
  getIdCardFile,
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
// answer must not be cached by the browser or a proxy. fileLinkLimiter: each link costs a Cloudinary
// Admin API call, and the count is shared with the badge evidence link.
router.get(
  "/verifications/:userId/id-card",
  verifyAuth,
  generalLimiter,
  fileLinkLimiter,
  async (req, res) => {
    const link = await getIdCardUrl(req.user.id, req.params.userId, {
      requestId: req.id,
    });
    res.set("Cache-Control", "no-store");
    sendData(req, res, link);
  },
);

// The card's bytes, for the admin's on-device check (FC-12); audited like the link, and counted by the
// same limiter. Not JSON: the image itself, never cached, never sniffed as anything but an image.
router.get(
  "/verifications/:userId/id-card/file",
  verifyAuth,
  generalLimiter,
  fileLinkLimiter,
  async (req, res) => {
    // Express answers HEAD with this handler too: that would download and audit with nothing shown.
    if (req.method !== "GET") {
      res.set("Allow", "GET");
      return res.status(405).end();
    }
    const { bytes, contentType } = await getIdCardFile(req.user.id, req.params.userId, {
      requestId: req.id,
    });
    res.set({
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(bytes);
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

// ── Users ───────────────────────────────────────────────────────────────────

// ?q (name or email)&role&verification&page&limit → users, newest first, for the org-unit manager
// picker. Admins only; a demo admin sees demo accounts only.
router.get("/users", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listUsers(req.user.id, req.query));
});

export default router;
