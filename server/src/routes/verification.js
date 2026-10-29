// /api/v1/verification (architecture.md §6 Verification, §8): the member's own ID-card upload and
// status. The admin's queue and decisions are in routes/admin.js.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter, uploadLimiter } from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import {
  assertUploadsConfigured,
  receiveFiles,
} from "../services/uploadService.js";
import {
  getVerificationStatus,
  submitIdCard,
} from "../services/verificationService.js";

const router = express.Router();

// 503 before multer reads a body that couldn't be stored anyway.
const uploadsReady = (_req, _res, next) => {
  assertUploadsConfigured();
  next();
};

// multipart: file "idCard" (JPG / PNG / WebP / PDF, at most 5 MB) and the fields memberType and
// department → 201 with the status view.
router.post(
  "/id-card",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  uploadsReady,
  uploadLimiter,
  receiveFiles("idCard", { maxCount: 1 }),
  async (req, res) => {
    const status = await submitIdCard(req.user.id, req.body, req.files, {
      requestId: req.id,
    });
    sendData(req, res, status, { status: 201 });
  },
);

router.get("/status", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await getVerificationStatus(req.user.id));
});

export default router;
