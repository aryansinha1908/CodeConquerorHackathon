// /api/v1/uploads (architecture.md §6 "Audit, uploads", backend.md §8.4). Photos for condition reports
// and incidents, for verified members; ID cards go through /verification/id-card instead.
//
// Everything that can refuse the request runs before multer reads the body, so a refused upload
// costs no memory: auth, the general tier, suspension, "uploads aren't configured" (503), the verified
// check (403), then the upload tier, which counts only uploads that are actually read.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter, uploadLimiter } from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import {
  MAX_FILES,
  assertUploadsConfigured,
  receiveFiles,
  requireVerifiedUploader,
  uploadImages,
} from "../services/uploadService.js";

const router = express.Router();

const uploadsReady = (_req, _res, next) => {
  assertUploadsConfigured();
  next();
};

const verifiedOnly = async (req, _res, next) => {
  await requireVerifiedUploader(req.user.id);
  next();
};

// multipart "images", 1 to 3 JPG / PNG / WebP files of at most 5 MB → 201 [{ url, publicId }].
router.post(
  "/images",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  uploadsReady,
  verifiedOnly,
  uploadLimiter,
  receiveFiles("images", { maxCount: MAX_FILES }),
  async (req, res) => {
    sendData(req, res, await uploadImages(req.user.id, req.files), {
      status: 201,
    });
  },
);

export default router;
