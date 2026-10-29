// /api/v1/notifications (architecture.md §6 Notifications; frontend.md F-16, the centre and the
// header bell). Each user reads and marks only their own: notifyService scopes every query to
// req.user.id, and someone else's notification is 404, not 403 (progress.md §5). Reads aren't
// audited, so these services take no requestId.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { sendData, sendList } from "../lib/respond.js";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "../services/notifyService.js";

const router = express.Router();

// ?unread=true&page&limit → newest first; meta.unread is the bell's count whatever the filter.
router.get("/", verifyAuth, generalLimiter, async (req, res) => {
  sendList(req, res, await listNotifications(req.user.id, req.query));
});

// → { count }. Every open tab polls this every 30 s.
router.get("/unread-count", verifyAuth, generalLimiter, async (req, res) => {
  sendData(req, res, await unreadCount(req.user.id));
});

// → { updated }. Declared before /:id/read so the static path is never read as an id.
router.patch(
  "/read-all",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    sendData(req, res, await markAllRead(req.user.id));
  },
);

// → the notification, with the readAt of the first time it was read.
router.patch(
  "/:id/read",
  verifyAuth,
  generalLimiter,
  blockSuspended,
  async (req, res) => {
    sendData(req, res, await markRead(req.user.id, req.params.id));
  },
);

export default router;
