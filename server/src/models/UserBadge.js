import mongoose from "mongoose";
import { USER_BADGE_STATUSES } from "./enums.js";
import { ref } from "./helpers.js";

const { Schema } = mongoose;

// A user's request for, or grant of, a badge. Valid when status is "active" and expiresAt is unset or in the future.
const userBadgeSchema = new Schema(
  {
    user: ref("User", { required: true }),
    badge: ref("Badge", { required: true }),
    status: { type: String, enum: USER_BADGE_STATUSES, default: "requested" },
    // Optional certificate upload (Cloudinary `authenticated`).
    evidence: { publicId: { type: String, trim: true } },
    // The member's note with the request.
    note: { type: String, trim: true, maxlength: 500 },
    // When the open request was made; a new request after a rejection moves it. The queue is FIFO on it.
    requestedAt: Date,
    decidedBy: ref("User"),
    decidedAt: Date,
    // Why the request was rejected or the badge revoked.
    reason: { type: String, trim: true, maxlength: 500 },
    // Set from Badge.validityDays on grant; null = never expires.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One row per user and badge: a new request after a rejection updates the existing row.
userBadgeSchema.index({ user: 1, badge: 1 }, { unique: true });
// Manager queue: requested badges issued by the manager's unit, oldest request first.
userBadgeSchema.index({ badge: 1, status: 1, requestedAt: 1 });

const UserBadge = mongoose.model("UserBadge", userBadgeSchema);
export default UserBadge;
