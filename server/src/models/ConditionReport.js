import mongoose from "mongoose";
import { CONDITION_OVERALL, REPORT_PHASES } from "./enums.js";
import { maxItems, photoSchema, ref } from "./helpers.js";

const { Schema } = mongoose;

// Labels are copied from resource.checklist, so a later checklist edit doesn't change old reports.
const itemSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    ok: { type: Boolean, required: true },
    note: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const conditionReportSchema = new Schema(
  {
    booking: ref("Booking", { required: true }),
    resource: ref("Resource", { required: true }),
    phase: { type: String, enum: REPORT_PHASES, required: true },
    items: [itemSchema],
    photos: { type: [photoSchema], validate: maxItems(3) },
    overall: { type: String, enum: CONDITION_OVERALL, required: true },
    notes: { type: String, trim: true, maxlength: 1000 },
    submittedBy: ref("User", { required: true }),
  },
  { timestamps: { createdAt: "at" } },
);

// One report per phase: a retried check-in can't create a second report.
conditionReportSchema.index({ booking: 1, phase: 1 }, { unique: true });

const ConditionReport = mongoose.model(
  "ConditionReport",
  conditionReportSchema,
);
export default ConditionReport;
