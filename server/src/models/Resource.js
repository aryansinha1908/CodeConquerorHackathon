import mongoose from "mongoose";
import {
  APPROVAL_MODES,
  BOOKING_MODES,
  MEMBER_TYPES,
  RESOURCE_CATEGORIES,
  RESOURCE_STATUSES,
  RISK_LEVELS,
  SLOT_MINUTES,
} from "./enums.js";
import { HH_MM, int, maxItems, photoSchema, ref } from "./helpers.js";

const { Schema } = mongoose;

// One opening window in IST, e.g. { day: 1, open: "09:00", close: "17:00" }. A day can have several.
const windowSchema = new Schema(
  {
    day: int({ min: 0, max: 6, required: true }), // 0 = Sunday
    open: { type: String, required: true, match: HH_MM },
    close: { type: String, required: true, match: HH_MM },
  },
  { _id: false },
);
windowSchema.path("close").validate(
  // Zero-padded HH:mm compares correctly as text; a malformed `open` already has its own error.
  function (close) {
    return !HH_MM.test(this.open ?? "") || close > this.open;
  },
  "close must be after open",
);

const blackoutSchema = new Schema({
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  reason: { type: String, trim: true, maxlength: 200 },
});
blackoutSchema.path("end").validate(function (end) {
  return !this.start || end > this.start;
}, "end must be after start");

const slugify = (text) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);

const resourceSchema = new Schema(
  {
    orgUnit: ref("OrgUnit", { required: true }),
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
    },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 2000 },
    images: { type: [photoSchema], validate: maxItems(5) },
    category: { type: String, enum: RESOURCE_CATEGORIES, required: true },
    // slot: the whole interval inside open hours (rooms, machines).
    // loan: pickup and return inside open hours (cameras, kits).
    bookingMode: { type: String, enum: BOOKING_MODES, default: "slot" },
    // Identical units bookable in parallel.
    quantity: int({ min: 1, max: 50, default: 1 }),
    riskLevel: { type: String, enum: RISK_LEVELS, default: "low" },
    location: {
      building: { type: String, trim: true, maxlength: 120 },
      room: { type: String, trim: true, maxlength: 60 },
      floor: { type: String, trim: true, maxlength: 20 },
    },
    status: { type: String, enum: RESOURCE_STATUSES, default: "active" },
    availability: {
      weekly: [windowSchema],
      blackouts: [blackoutSchema],
      slotMinutes: { type: Number, enum: SLOT_MINUTES, default: 30 },
    },
    // Read by the eligibility engine. Empty lists mean "no restriction".
    eligibility: {
      memberTypes: [{ type: String, enum: MEMBER_TYPES }],
      departments: [ref("OrgUnit")],
      badges: [ref("Badge")],
      approvalMode: { type: String, enum: APPROVAL_MODES, default: "manual" },
    },
    limits: {
      minDurationMins: int({ min: 1 }),
      maxDurationMins: int({ min: 1 }),
      maxHoursPerWeek: int({ min: 1 }),
      maxActiveBookings: int({ min: 1 }),
      leadTimeMins: int({ min: 0 }),
      maxAdvanceDays: int({ min: 1, max: 365 }),
    },
    usageRules: { type: String, trim: true, maxlength: 2000 },
    // Condition items copied into every check-in / check-out report, e.g. "Nozzle clean".
    checklist: {
      type: [{ type: String, trim: true, minlength: 2, maxlength: 80 }],
      validate: maxItems(10),
    },
    createdBy: ref("User"),
  },
  { timestamps: true },
);

resourceSchema.pre("validate", function () {
  // The _id suffix keeps slugs unique when two units list the same title.
  if (!this.slug && this.title) {
    this.slug = `${slugify(this.title)}-${this._id.toString().slice(-6)}`;
  }
  const { minDurationMins: min, maxDurationMins: max } = this.limits ?? {};
  if (min != null && max != null && min > max) {
    this.invalidate(
      "limits.minDurationMins",
      "Minimum duration can't exceed the maximum",
    );
  }
});

resourceSchema.index(
  { title: "text", description: "text" },
  { weights: { title: 3, description: 1 }, name: "resource_text" },
);
resourceSchema.index({ orgUnit: 1, status: 1 });
resourceSchema.index({ category: 1, status: 1 });

const Resource = mongoose.model("Resource", resourceSchema);
export default Resource;
