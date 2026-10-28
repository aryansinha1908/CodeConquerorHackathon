import mongoose from "mongoose";
import { int, ref } from "./helpers.js";

const { Schema } = mongoose;

// A training or qualification a resource can require, e.g. "3D Printing Basics" issued by the DIC.
const badgeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]{2,40}$/,
    },
    // The unit that trains people and grants this badge.
    orgUnit: ref("OrgUnit", { required: true }),
    description: { type: String, trim: true, maxlength: 500 },
    // null = never expires.
    validityDays: int({ min: 1, max: 3650, default: null }),
    evidenceRequired: { type: Boolean, default: false },
    // C-13: low-risk badges a member can earn through the micro-quiz.
    selfServe: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const Badge = mongoose.model("Badge", badgeSchema);
export default Badge;
