import mongoose from "mongoose";
import {
  INCIDENT_OUTCOMES,
  INCIDENT_SEVERITIES,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
} from "./enums.js";
import { maxItems, photoSchema, ref } from "./helpers.js";

const { Schema } = mongoose;

const commentSchema = new Schema({
  by: ref("User", { required: true }),
  text: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 1000,
  },
  at: { type: Date, default: Date.now },
});

const incidentSchema = new Schema(
  {
    booking: ref("Booking"),
    resource: ref("Resource", { required: true }),
    orgUnit: ref("OrgUnit", { required: true }),
    // null when the system raised it, e.g. an overdue return.
    reportedBy: ref("User", { default: null }),
    source: { type: String, enum: INCIDENT_SOURCES, required: true },
    type: { type: String, enum: INCIDENT_TYPES, required: true },
    severity: { type: String, enum: INCIDENT_SEVERITIES, required: true },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 20,
      maxlength: 2000,
    },
    photos: { type: [photoSchema], validate: maxItems(3) },
    status: { type: String, enum: INCIDENT_STATUSES, default: "open" },
    comments: [commentSchema],
    resolution: {
      outcome: { type: String, enum: INCIDENT_OUTCOMES },
      rationale: { type: String, trim: true, maxlength: 1000 },
      decidedBy: ref("User"),
      at: Date,
    },
    // C-14: an AI suggestion only. The resolver still writes their own rationale.
    aiSummary: {
      text: { type: String, trim: true, maxlength: 2000 },
      generatedAt: Date,
    },
  },
  { timestamps: true },
);

// A human always decides: a resolved incident must say who decided, what and why.
incidentSchema.pre("validate", function () {
  if (this.source !== "system" && !this.reportedBy) {
    this.invalidate(
      "reportedBy",
      "reportedBy is required unless the system raised the incident",
    );
  }
  if (this.status === "resolved") {
    for (const field of ["outcome", "rationale", "decidedBy"]) {
      if (!this.resolution?.[field]) {
        this.invalidate(
          `resolution.${field}`,
          `resolution.${field} is required to resolve an incident`,
        );
      }
    }
  }
});

incidentSchema.index({ orgUnit: 1, status: 1, createdAt: -1 }); // manager and admin lists
incidentSchema.index({ booking: 1 }); // booking timeline

const Incident = mongoose.model("Incident", incidentSchema);
export default Incident;
