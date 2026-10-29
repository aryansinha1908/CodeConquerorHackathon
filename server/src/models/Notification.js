import mongoose from "mongoose";
import { EVENT_NAME, ref } from "./helpers.js";

const { Schema } = mongoose;

export const NOTIFICATION_TTL_DAYS = 60;

const notificationSchema = new Schema(
  {
    user: ref("User", { required: true }),
    // Event name in the same style as audit actions, e.g. "booking.approved".
    type: { type: String, required: true, match: EVENT_NAME },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 500 },
    // In-app path such as /bookings/:id. Absolute URLs are refused, so a notification can't link off-site.
    link: { type: String, trim: true, maxlength: 300, match: /^\/(?!\/)\S*$/ },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 }); // the feed
notificationSchema.index({ user: 1, readAt: 1 }); // the unread count, polled every 30 s
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_TTL_DAYS * 24 * 60 * 60 },
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
