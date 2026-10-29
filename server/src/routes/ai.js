// /api/v1/ai: what the AI features share. The features themselves live with their resources
// (POST /resources/ai-search, POST /bookings/:id/ai-compare).
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { generalLimiter, ipKey } from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import { myAiQuota } from "../services/aiService.js";

const router = express.Router();

// The "AI requests left today" meter. 503 AI_UNAVAILABLE while Redis is down (the quota fails closed).
router.get("/quota", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await myAiQuota(req.user.id, { network: ipKey(req) }));
});

export default router;
