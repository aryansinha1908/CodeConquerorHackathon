import mongoose from "mongoose";
import {
  EMAIL_LEVELS,
  MEMBER_TYPES,
  ROLES,
  VERIFICATION_STATUSES,
} from "./enums.js";
import { int, ref } from "./helpers.js";

const { Schema } = mongoose;

// Never send these to a client, even when a query selected them explicitly (e.g. login).
function hideSecrets(_doc, ret) {
  delete ret.passwordHash;
  if (ret.verification) delete ret.verification.idCardPublicId;
  return ret;
}

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    // The domain rule (ALLOWED_EMAIL_DOMAINS, demo domain) lives in the Zod validator, since it depends on env.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: { type: String, required: true, select: false },
    roles: {
      type: [{ type: String, enum: ROLES }],
      default: ["member"],
      validate: {
        validator: (roles) => roles.length > 0,
        message: "A user needs at least one role",
      },
    },
    // Chosen by the user with the ID card (pre-filled from emailHints), confirmed by the admin.
    memberType: { type: String, enum: MEMBER_TYPES },
    department: ref("OrgUnit"),
    // Parsed from a roll-number email such as 2024ugcs999@nitjsr.ac.in. A hint only, never used for access.
    emailHints: {
      year: int({ min: 2000, max: 2100 }),
      level: { type: String, enum: EMAIL_LEVELS },
      branch: { type: String, lowercase: true, trim: true, maxlength: 6 },
      serial: { type: String, trim: true, maxlength: 4 },
    },
    emailVerified: { type: Boolean, default: false },
    verification: {
      status: {
        type: String,
        enum: VERIFICATION_STATUSES,
        default: "unsubmitted",
      },
      // Cloudinary `authenticated` asset; deleted after the admin decides (architecture.md §8).
      idCardPublicId: { type: String, select: false },
      submittedAt: Date,
      reviewedBy: ref("User"),
      reviewedAt: Date,
      reason: { type: String, trim: true, maxlength: 500 },
    },
    // Kept in sync with OrgUnit.managers by the assign-managers route.
    managedOrgUnits: [ref("OrgUnit")],
    strikes: int({ min: 0, default: 0 }),
    suspendedUntil: { type: Date, default: null },
    suspensionReason: { type: String, trim: true, maxlength: 500 },
    notificationPrefs: {
      email: { type: Boolean, default: true },
    },
  },
  { timestamps: true, toJSON: { versionKey: false, transform: hideSecrets } },
);

userSchema.index({ "verification.status": 1, "verification.submittedAt": 1 });

const User = mongoose.model("User", userSchema);
export default User;
