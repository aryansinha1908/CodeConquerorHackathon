import mongoose from "mongoose";
import {
  BOOKING_STATUSES,
  DECISION_ACTIONS,
  RETURN_OUTCOMES,
} from "./enums.js";
import { ref } from "./helpers.js";

const { Schema } = mongoose;

// What the eligibility engine saw at request time, kept for disputes and audits.
const snapshotSchema = new Schema(
  { rule: String, passed: Boolean, message: String },
  { _id: false },
);

const handover = () => ({
  at: Date,
  by: ref("User"),
  report: ref("ConditionReport"),
});

// A request and its whole lifecycle (engines/stateMachine.js). Waitlist entries are bookings with
// status "waitlisted"; their position is computed on read, never stored (backend.md §6.3).
const bookingSchema = new Schema(
  {
    resource: ref("Resource", { required: true }),
    // Copied from the resource so scope checks and manager queues need no join.
    orgUnit: ref("OrgUnit", { required: true }),
    borrower: ref("User", { required: true }),
    // Stored in UTC, shown in IST.
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    purpose: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 300,
    },
    status: { type: String, enum: BOOKING_STATUSES, default: "pending" },
    eligibilitySnapshot: [snapshotSchema],
    decision: {
      action: { type: String, enum: DECISION_ACTIONS },
      by: ref("User"),
      at: Date,
      reason: { type: String, trim: true, maxlength: 500 },
    },
    cancellation: {
      by: ref("User"),
      at: Date,
      reason: { type: String, trim: true, maxlength: 500 },
    },
    checkIn: handover(),
    checkOut: handover(),
    returnConfirmation: {
      ...handover(),
      outcome: { type: String, enum: RETURN_OUTCOMES },
    },
    incidents: [ref("Incident")],
    // Sweeper bookkeeping (architecture.md §14). Overdue is a flag, not a status.
    flags: {
      startReminderAt: Date,
      endReminderAt: Date,
      overdue: { type: Boolean, default: false },
      overdueAt: Date,
    },
  },
  { timestamps: true },
);

bookingSchema.path("end").validate(function (end) {
  return !this.start || end > this.start;
}, "end must be after start");

bookingSchema.index({ resource: 1, status: 1, start: 1, end: 1 }); // overlap checks
bookingSchema.index({ borrower: 1, status: 1, start: -1 }); // "my bookings" and quotas
bookingSchema.index({ orgUnit: 1, status: 1, createdAt: 1 }); // manager queue
bookingSchema.index({ status: 1, start: 1 }); // sweeper: reminders, no-shows, waitlist expiry
bookingSchema.index({ status: 1, end: 1 }); // sweeper: overdue

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;
