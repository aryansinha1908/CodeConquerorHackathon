import mongoose from "mongoose";
import { ORG_UNIT_TYPES } from "./enums.js";
import { ref } from "./helpers.js";

const { Schema } = mongoose;

// A department, centre or central facility that owns resources, e.g. "dic" (Design and Innovation Centre).
const orgUnitSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]{2,20}$/,
    },
    type: { type: String, enum: ORG_UNIT_TYPES, required: true },
    location: {
      building: { type: String, trim: true, maxlength: 120 },
      notes: { type: String, trim: true, maxlength: 300 },
    },
    // Kept in sync with User.managedOrgUnits by the assign-managers route.
    managers: [ref("User")],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const OrgUnit = mongoose.model("OrgUnit", orgUnitSchema);
export default OrgUnit;
